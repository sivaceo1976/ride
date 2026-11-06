import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryRedisClient } from '../src/services/redis/in-memory-redis.js';
import { RedisGeoService } from '../src/services/redis/geo.service.js';
import { VehicleClass } from '../src/modules/vehicles/types.js';

describe('Phase 2 - Redis Geospatial Operations & Class Filtering', () => {
  let redis: InMemoryRedisClient;
  let geoService: RedisGeoService;

  beforeEach(() => {
    redis = new InMemoryRedisClient();
    geoService = new RedisGeoService(redis);
  });

  const sfCenter = { lat: 37.7749, lng: -122.4194 }; // Market St SF
  const nearPoint = { lat: 37.7833, lng: -122.4167 }; // ~1.0 km away (Civic Center)
  const midPoint = { lat: 37.8087, lng: -122.4098 };  // ~3.8 km away (Pier 39)
  const farPoint = { lat: 37.6213, lng: -122.3790 };  // ~18.5 km away (SFO Airport)

  it('should index drivers across vehicle classes and global active sets', async () => {
    const driverId = 'd0000000-0000-4000-8000-000000000001';
    await geoService.updateDriverLocation(
      driverId,
      nearPoint.lat,
      nearPoint.lng,
      VehicleClass.SEDAN,
      90.0,
      35.0
    );

    const sedanDrivers = await geoService.getNearbyDrivers(sfCenter.lat, sfCenter.lng, 5.0, VehicleClass.SEDAN);
    expect(sedanDrivers.length).toBe(1);
    expect(sedanDrivers[0].driverId).toBe(driverId);
    expect(sedanDrivers[0].vehicleClass).toBe(VehicleClass.SEDAN);
    expect(sedanDrivers[0].distanceKm).toBeGreaterThan(0.8);
    expect(sedanDrivers[0].distanceKm).toBeLessThan(1.5);

    // Should also appear in global active search
    const allDrivers = await geoService.getNearbyDrivers(sfCenter.lat, sfCenter.lng, 5.0);
    expect(allDrivers.length).toBe(1);
    expect(allDrivers[0].driverId).toBe(driverId);
  });

  it('should filter correctly by radius bounds', async () => {
    const driverNear = 'd0000000-0000-4000-8000-000000000001';
    const driverMid = 'd0000000-0000-4000-8000-000000000002';
    const driverFar = 'd0000000-0000-4000-8000-000000000003';

    await geoService.updateDriverLocation(driverNear, nearPoint.lat, nearPoint.lng, VehicleClass.SEDAN);
    await geoService.updateDriverLocation(driverMid, midPoint.lat, midPoint.lng, VehicleClass.SEDAN);
    await geoService.updateDriverLocation(driverFar, farPoint.lat, farPoint.lng, VehicleClass.SEDAN);

    // 2km radius should only find driverNear
    const radius2km = await geoService.getNearbyDrivers(sfCenter.lat, sfCenter.lng, 2.0);
    expect(radius2km.map((d) => d.driverId)).toEqual([driverNear]);

    // 5km radius should find driverNear and driverMid, ordered by distance ascending
    const radius5km = await geoService.getNearbyDrivers(sfCenter.lat, sfCenter.lng, 5.0);
    expect(radius5km.map((d) => d.driverId)).toEqual([driverNear, driverMid]);
    expect(radius5km[0].distanceKm).toBeLessThan(radius5km[1].distanceKm);

    // 25km radius should find all three
    const radius25km = await geoService.getNearbyDrivers(sfCenter.lat, sfCenter.lng, 25.0);
    expect(radius25km.length).toBe(3);
  });

  it('should filter strictly by vehicle class', async () => {
    const bikeDriver = 'd-bike-001';
    const sedanDriver = 'd-sedan-001';
    const suvDriver = 'd-suv-001';

    await geoService.updateDriverLocation(bikeDriver, nearPoint.lat, nearPoint.lng, VehicleClass.BIKE);
    await geoService.updateDriverLocation(sedanDriver, nearPoint.lat, nearPoint.lng, VehicleClass.SEDAN);
    await geoService.updateDriverLocation(suvDriver, nearPoint.lat, nearPoint.lng, VehicleClass.SUV);

    // Query BIKE only
    const bikes = await geoService.getNearbyDrivers(sfCenter.lat, sfCenter.lng, 5.0, VehicleClass.BIKE);
    expect(bikes.length).toBe(1);
    expect(bikes[0].driverId).toBe(bikeDriver);

    // Query SUV only
    const suvs = await geoService.getNearbyDrivers(sfCenter.lat, sfCenter.lng, 5.0, VehicleClass.SUV);
    expect(suvs.length).toBe(1);
    expect(suvs[0].driverId).toBe(suvDriver);

    // Query all classes
    const all = await geoService.getNearbyDrivers(sfCenter.lat, sfCenter.lng, 5.0);
    expect(all.length).toBe(3);
  });

  it('should handle duty status toggle: clean up spatial index when transitioning to OFFLINE', async () => {
    const driverId = 'd-toggle-001';
    await geoService.updateDriverLocation(driverId, nearPoint.lat, nearPoint.lng, VehicleClass.SEDAN);

    // Verify online
    let nearby = await geoService.getNearbyDrivers(sfCenter.lat, sfCenter.lng, 5.0);
    expect(nearby.length).toBe(1);

    // Transition to OFFLINE
    await geoService.setDriverDutyStatus(driverId, 'OFFLINE');

    // Verify immediately unqueryable
    nearby = await geoService.getNearbyDrivers(sfCenter.lat, sfCenter.lng, 5.0);
    expect(nearby.length).toBe(0);

    const meta = await geoService.getDriverMetadata(driverId);
    expect(meta).toBeNull();
  });
});
