import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InMemoryRedisClient } from '../src/services/redis/in-memory-redis.js';
import { RedisGeoService } from '../src/services/redis/geo.service.js';
import { DistributedLockManager } from '../src/services/locking/lock.manager.js';
import { RedisPubSubService } from '../src/services/redis/pubsub.service.js';
import { DispatchEngine, DispatchRequest } from '../src/services/dispatch/dispatch.engine.js';
import { VehicleClass } from '../src/modules/vehicles/types.js';

describe('Phase 3 - Offer Dispatch & 15-Second Timeout Lifecycle', () => {
  let redis: InMemoryRedisClient;
  let geoService: RedisGeoService;
  let lockManager: DistributedLockManager;
  let pubSubService: RedisPubSubService;
  let dispatchEngine: DispatchEngine;

  const driverA = 'd0000000-0000-4000-8000-000000000001'; // Closer (~0.5 km away)
  const driverB = 'd0000000-0000-4000-8000-000000000002'; // Further (~1.8 km away)
  const driverC = 'd0000000-0000-4000-8000-000000000003'; // Further still (~3.0 km away)

  const pickupLocation = { lat: 37.7749, lng: -122.4194 };
  const dropoffLocation = { lat: 37.7925, lng: -122.4042 };

  beforeEach(async () => {
    redis = new InMemoryRedisClient();
    geoService = new RedisGeoService(redis);
    lockManager = new DistributedLockManager(redis);
    pubSubService = new RedisPubSubService(redis);
    dispatchEngine = new DispatchEngine(redis, geoService, lockManager, pubSubService);

    // Register drivers in Redis
    await geoService.updateDriverLocation(driverA, 37.778, -122.419, VehicleClass.SEDAN, 90, 30);
    await geoService.updateDriverLocation(driverB, 37.785, -122.415, VehicleClass.SEDAN, 120, 30);
    await geoService.updateDriverLocation(driverC, 37.795, -122.41, VehicleClass.SEDAN, 180, 30);
  });

  afterEach(() => {
    dispatchEngine.clearAllTimers();
  });

  it('should rank candidates multi-factorially and send offer to top candidate #1 first', async () => {
    const rideId = 'r0000000-0000-4000-8000-000000000001';
    const request: DispatchRequest = {
      rideId,
      pickupLocation,
      pickupAddress: 'Civic Center, San Francisco, CA',
      dropoffLocation,
      dropoffAddress: 'Financial District, San Francisco, CA',
      estimatedFare: 15.5,
      estimatedDistanceKm: 2.8,
      estimatedDurationMin: 9.0,
      vehicleClass: VehicleClass.SEDAN,
    };

    // Track offers published via Pub/Sub
    const publishedOffers: any[] = [];
    await redis.subscribe(`driver:offer:${driverA}`, (_, msg) => {
      publishedOffers.push(JSON.parse(msg));
    });

    const result = await dispatchEngine.dispatchRide(request);
    expect(result.dispatched).toBe(true);
    expect(result.candidateId).toBe(driverA);

    // Current offer in Redis belongs to driverA
    const currentOffer = await dispatchEngine.getCurrentOffer(rideId);
    expect(currentOffer).toBe(driverA);

    // Driver A must have an active distributed lock
    const lockOnDriverA = await lockManager.acquireDriverLock(driverA, 1000);
    expect(lockOnDriverA).toBeNull(); // Locked!
  });

  it('should timeout offer after 15s, blacklist candidate #1, and sequentially dispatch to candidate #2', async () => {
    const rideId = 'r0000000-0000-4000-8000-000000000002';
    const request: DispatchRequest = {
      rideId,
      pickupLocation,
      pickupAddress: 'Civic Center, San Francisco, CA',
      dropoffLocation,
      dropoffAddress: 'Financial District, San Francisco, CA',
      estimatedFare: 15.5,
      estimatedDistanceKm: 2.8,
      estimatedDurationMin: 9.0,
      vehicleClass: VehicleClass.SEDAN,
    };

    // 1. Dispatch to Candidate #1 (Driver A)
    await dispatchEngine.dispatchRide(request);
    expect(await dispatchEngine.getCurrentOffer(rideId)).toBe(driverA);

    // 2. Simulate 15s timeout
    await dispatchEngine.handleOfferTimeout(request, driverA);

    // Driver A is blacklisted for this ride
    const blacklist = await dispatchEngine.getBlacklistedDrivers(rideId);
    expect(blacklist.has(driverA)).toBe(true);

    // Driver A's lock is freed
    const lockOnDriverA = await lockManager.acquireDriverLock(driverA, 1000);
    expect(lockOnDriverA).not.toBeNull();
    await lockManager.release(lockOnDriverA!);

    // Next offer is automatically dispatched to Candidate #2 (Driver B)
    const newOffer = await dispatchEngine.getCurrentOffer(rideId);
    expect(newOffer).toBe(driverB);

    // Driver B is now locked
    expect(await lockManager.acquireDriverLock(driverB, 1000)).toBeNull();
  });

  it('should immediately re-dispatch to candidate #3 when candidate #2 manually rejects without waiting 15s', async () => {
    const rideId = 'r0000000-0000-4000-8000-000000000003';
    const request: DispatchRequest = {
      rideId,
      pickupLocation,
      pickupAddress: 'Civic Center, San Francisco, CA',
      dropoffLocation,
      dropoffAddress: 'Financial District, San Francisco, CA',
      estimatedFare: 15.5,
      estimatedDistanceKm: 2.8,
      estimatedDurationMin: 9.0,
      vehicleClass: VehicleClass.SEDAN,
    };

    // 1. Initial offer goes to Driver A
    await dispatchEngine.dispatchRide(request);
    expect(await dispatchEngine.getCurrentOffer(rideId)).toBe(driverA);

    // Driver A times out -> goes to Driver B
    await dispatchEngine.handleOfferTimeout(request, driverA);
    expect(await dispatchEngine.getCurrentOffer(rideId)).toBe(driverB);

    // Driver B explicitly rejects the offer
    await dispatchEngine.handleDriverReject(request, driverB);

    // Driver B is blacklisted
    const blacklist = await dispatchEngine.getBlacklistedDrivers(rideId);
    expect(blacklist.has(driverB)).toBe(true);

    // Driver B's lock is released immediately
    const lockOnDriverB = await lockManager.acquireDriverLock(driverB, 1000);
    expect(lockOnDriverB).not.toBeNull();
    await lockManager.release(lockOnDriverB!);

    // Offer immediately advanced to Driver C
    expect(await dispatchEngine.getCurrentOffer(rideId)).toBe(driverC);
  });
});
