import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryRedisClient } from '../src/services/redis/in-memory-redis.js';
import { RedisGeoService } from '../src/services/redis/geo.service.js';
import { DistributedLockManager } from '../src/services/locking/lock.manager.js';
import { RedisPubSubService } from '../src/services/redis/pubsub.service.js';
import { DispatchEngine } from '../src/services/dispatch/dispatch.engine.js';
import { RideService, RideConflictError } from '../src/modules/rides/ride.service.js';
import { RideStatus } from '../src/modules/rides/types.js';
import { VehicleClass } from '../src/modules/vehicles/types.js';

describe('Phase 3 - Concurrency Race: Double Acceptance Prevention', () => {
  let redis: InMemoryRedisClient;
  let geoService: RedisGeoService;
  let lockManager: DistributedLockManager;
  let pubSubService: RedisPubSubService;
  let dispatchEngine: DispatchEngine;
  let rideService: RideService;

  const driver1 = 'd0000000-0000-4000-8000-000000000001';
  const driver2 = 'd0000000-0000-4000-8000-000000000002';
  const riderId = 'a0000000-0000-4000-8000-000000000001';

  beforeEach(async () => {
    redis = new InMemoryRedisClient();
    geoService = new RedisGeoService(redis);
    lockManager = new DistributedLockManager(redis);
    pubSubService = new RedisPubSubService(redis);
    dispatchEngine = new DispatchEngine(redis, geoService, lockManager, pubSubService);
    rideService = new RideService(lockManager, geoService, pubSubService, dispatchEngine);

    // Seed drivers in Redis
    await geoService.updateDriverLocation(driver1, 37.775, -122.419, VehicleClass.SEDAN);
    await geoService.updateDriverLocation(driver2, 37.776, -122.418, VehicleClass.SEDAN);
  });

  it('should prevent double acceptance: exactly one driver wins, the other receives 409 Conflict', async () => {
    // 1. Rider requests a ride
    const ride = await rideService.requestRide({
      riderId,
      pickupAddress: 'Civic Center, San Francisco, CA',
      pickupLocation: { lat: 37.7749, lng: -122.4194 },
      dropoffAddress: 'Embarcadero, San Francisco, CA',
      dropoffLocation: { lat: 37.7925, lng: -122.4042 },
      vehicleClass: 'SEDAN',
    });

    expect(ride.status).toBe(RideStatus.SEARCHING_DRIVER);

    // Current offer was dispatched to driver1
    const activeOfferDriver = await dispatchEngine.getCurrentOffer(ride.id);
    expect(activeOfferDriver).toBe(driver1);

    // 2. Simulate race condition: Driver 1 (genuine offer holder) and Driver 2 (rogue/stale racer)
    // both invoke acceptRide simultaneously
    const results = await Promise.allSettled([
      rideService.acceptRide(ride.id, driver1),
      rideService.acceptRide(ride.id, driver2),
    ]);

    const accepted = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // Exactly one succeeds!
    expect(accepted.length).toBe(1);
    expect(rejected.length).toBe(1);

    // The winner is driver1
    const winningRide = (accepted[0] as PromiseFulfilledResult<any>).value;
    expect(winningRide.status).toBe(RideStatus.ACCEPTED);
    expect(winningRide.driverId).toBe(driver1);

    // The loser received a RideConflictError
    const conflictError = (rejected[0] as PromiseRejectedResult).reason;
    expect(conflictError).toBeInstanceOf(RideConflictError);
    expect(conflictError.message).toMatch(/Offer mismatch|status is/);

    // Verify ride state in repository remains cleanly accepted by driver1
    const savedRide = await rideService.getRideById(ride.id);
    expect(savedRide?.driverId).toBe(driver1);
    expect(savedRide?.status).toBe(RideStatus.ACCEPTED);
  });

  it('should reject second accept attempt if driver attempts to accept an already ACCEPTED ride', async () => {
    const ride = await rideService.requestRide({
      riderId,
      pickupAddress: 'Civic Center, SF',
      pickupLocation: { lat: 37.7749, lng: -122.4194 },
      dropoffAddress: 'Embarcadero, SF',
      dropoffLocation: { lat: 37.7925, lng: -122.4042 },
      vehicleClass: 'SEDAN',
    });

    // Driver 1 accepts
    await rideService.acceptRide(ride.id, driver1);

    // Driver 1 attempts to accept again
    await expect(rideService.acceptRide(ride.id, driver1)).rejects.toThrow(RideConflictError);
  });
});
