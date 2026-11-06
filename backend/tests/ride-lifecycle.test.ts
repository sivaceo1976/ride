import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryRedisClient } from '../src/services/redis/in-memory-redis.js';
import { RedisGeoService } from '../src/services/redis/geo.service.js';
import { DistributedLockManager } from '../src/services/locking/lock.manager.js';
import { RedisPubSubService } from '../src/services/redis/pubsub.service.js';
import { DispatchEngine } from '../src/services/dispatch/dispatch.engine.js';
import { RideService, InvalidOtpError } from '../src/modules/rides/ride.service.js';
import { RideStatus } from '../src/modules/rides/types.js';
import { VehicleClass } from '../src/modules/vehicles/types.js';

describe('Phase 3 - End-to-End Deterministic Trip Lifecycle', () => {
  let redis: InMemoryRedisClient;
  let geoService: RedisGeoService;
  let lockManager: DistributedLockManager;
  let pubSubService: RedisPubSubService;
  let dispatchEngine: DispatchEngine;
  let rideService: RideService;

  const driverId = 'd0000000-0000-4000-8000-000000000001';
  const riderId = 'a0000000-0000-4000-8000-000000000001';

  beforeEach(async () => {
    redis = new InMemoryRedisClient();
    geoService = new RedisGeoService(redis);
    lockManager = new DistributedLockManager(redis);
    pubSubService = new RedisPubSubService(redis);
    dispatchEngine = new DispatchEngine(redis, geoService, lockManager, pubSubService);
    rideService = new RideService(lockManager, geoService, pubSubService, dispatchEngine);

    // Seed Driver in Redis as ONLINE
    await geoService.updateDriverLocation(driverId, 37.775, -122.419, VehicleClass.SEDAN);
  });

  it('should execute full lifecycle: Request -> Accept -> Arrived -> OTP Verification -> Start -> Complete', async () => {
    // 1. Rider requests ride
    const ride = await rideService.requestRide({
      riderId,
      pickupAddress: '555 California St, SF',
      pickupLocation: { lat: 37.7925, lng: -122.4042 },
      dropoffAddress: 'Pier 39, SF',
      dropoffLocation: { lat: 37.8087, lng: -122.4098 },
      vehicleClass: 'SEDAN',
    });

    expect(ride.status).toBe(RideStatus.SEARCHING_DRIVER);
    expect(ride.otp).toMatch(/^\d{4}$/);
    expect(ride.fareBreakdown.totalFare).toBeGreaterThan(0);

    // 2. Driver accepts ride offer
    const acceptedRide = await rideService.acceptRide(ride.id, driverId);
    expect(acceptedRide.status).toBe(RideStatus.ACCEPTED);
    expect(acceptedRide.driverId).toBe(driverId);
    expect(acceptedRide.acceptedAt).toBeDefined();

    // Driver is marked BUSY in Redis and associated with rideId
    const driverMetaDuringTrip = await geoService.getDriverMetadata(driverId);
    expect(driverMetaDuringTrip?.status).toBe('BUSY');
    expect(driverMetaDuringTrip?.rideId).toBe(ride.id);

    // Driver is omitted from candidate queries for other riders while busy
    const nearbyWhileBusy = await geoService.getNearbyDrivers(37.775, -122.419, 5.0);
    expect(nearbyWhileBusy.length).toBe(0);

    // 3. Driver arrives at pickup
    const arrivedRide = await rideService.driverArrived(ride.id, driverId);
    expect(arrivedRide.status).toBe(RideStatus.ARRIVED_AT_PICKUP);
    expect(arrivedRide.arrivedAt).toBeDefined();

    // 4. Driver enters invalid OTP -> must be rejected without changing state
    await expect(rideService.startTrip(ride.id, driverId, '0000')).rejects.toThrow(InvalidOtpError);
    const rideAfterFailedOtp = await rideService.getRideById(ride.id);
    expect(rideAfterFailedOtp?.status).toBe(RideStatus.ARRIVED_AT_PICKUP);

    // 5. Driver enters correct OTP -> trip starts (IN_TRANSIT)
    const inTransitRide = await rideService.startTrip(ride.id, driverId, ride.otp);
    expect(inTransitRide.status).toBe(RideStatus.IN_TRANSIT);
    expect(inTransitRide.startedAt).toBeDefined();

    // 6. Driver completes trip
    const completedRide = await rideService.completeTrip(ride.id, driverId);
    expect(completedRide.status).toBe(RideStatus.COMPLETED);
    expect(completedRide.completedAt).toBeDefined();

    // Driver is released in Redis: status becomes ONLINE and rideId cleared
    const driverMetaAfterTrip = await geoService.getDriverMetadata(driverId);
    expect(driverMetaAfterTrip?.status).toBe('ONLINE');
    expect(driverMetaAfterTrip?.rideId).toBeUndefined();

    // Driver is once again queryable for new ride requests
    const nearbyAfterTrip = await geoService.getNearbyDrivers(37.775, -122.419, 5.0);
    expect(nearbyAfterTrip.length).toBe(1);
    expect(nearbyAfterTrip[0].driverId).toBe(driverId);
  });

  it('should handle cancellation branch, record reason, and free driver in Redis', async () => {
    const ride = await rideService.requestRide({
      riderId,
      pickupAddress: '555 California St, SF',
      pickupLocation: { lat: 37.7925, lng: -122.4042 },
      dropoffAddress: 'Pier 39, SF',
      dropoffLocation: { lat: 37.8087, lng: -122.4098 },
      vehicleClass: 'SEDAN',
    });

    await rideService.acceptRide(ride.id, driverId);

    // Cancel ride
    const cancelledRide = await rideService.cancelRide(ride.id, 'RIDER', 'Change of plans');
    expect(cancelledRide.status).toBe(RideStatus.CANCELLED);
    expect(cancelledRide.cancellationReason).toContain('Change of plans');

    // Driver must be freed in Redis
    const driverMeta = await geoService.getDriverMetadata(driverId);
    expect(driverMeta?.status).toBe('ONLINE');
    expect(driverMeta?.rideId).toBeUndefined();
  });
});
