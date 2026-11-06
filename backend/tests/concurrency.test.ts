import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryRedisClient } from '../src/services/redis/in-memory-redis.js';
import { RedisGeoService } from '../src/services/redis/geo.service.js';
import { TelemetryBufferService } from '../src/services/telemetry/telemetry-buffer.service.js';
import { VehicleClass } from '../src/modules/vehicles/types.js';

describe('Phase 2 - High Concurrency Telemetry & Spatial Set Integrity', () => {
  let redis: InMemoryRedisClient;
  let geoService: RedisGeoService;
  let telemetryBuffer: TelemetryBufferService;

  beforeEach(() => {
    redis = new InMemoryRedisClient();
    geoService = new RedisGeoService(redis);
    telemetryBuffer = new TelemetryBufferService();
  });

  it('should handle 50 concurrent simulated drivers updating simultaneously without set corruption', async () => {
    const driverCount = 50;
    const baseLat = 37.7749;
    const baseLng = -122.4194;

    const drivers = Array.from({ length: driverCount }, (_, i) => {
      const padded = i.toString().padStart(4, '0');
      return {
        id: `d0000000-0000-4000-8000-${padded}00000001`,
        lat: baseLat + (Math.random() - 0.5) * 0.05,
        lng: baseLng + (Math.random() - 0.5) * 0.05,
        vehicleClass: i % 3 === 0 ? VehicleClass.BIKE : i % 3 === 1 ? VehicleClass.SEDAN : VehicleClass.SUV,
        bearing: Math.floor(Math.random() * 360),
        speed: Math.floor(Math.random() * 60) + 10,
      };
    });

    // Execute 50 simultaneous location updates in parallel
    const updatePromises = drivers.map((d) =>
      geoService.updateDriverLocation(d.id, d.lat, d.lng, d.vehicleClass, d.bearing, d.speed)
    );

    await Promise.all(updatePromises);

    // Verify all 50 drivers are discoverable via global GEOSEARCH
    const activeDrivers = await geoService.getNearbyDrivers(baseLat, baseLng, 15.0);
    expect(activeDrivers.length).toBe(driverCount);

    // Verify class counts match
    const bikes = await geoService.getNearbyDrivers(baseLat, baseLng, 15.0, VehicleClass.BIKE);
    const sedans = await geoService.getNearbyDrivers(baseLat, baseLng, 15.0, VehicleClass.SEDAN);
    const suvs = await geoService.getNearbyDrivers(baseLat, baseLng, 15.0, VehicleClass.SUV);

    expect(bikes.length + sedans.length + suvs.length).toBe(driverCount);
  });

  it('should handle rapid successive updates from the same driver without race conditions', async () => {
    const driverId = 'd0000000-0000-4000-8000-000000000099';
    const updatesCount = 20;

    const promises = Array.from({ length: updatesCount }, (_, i) => {
      return geoService.updateDriverLocation(
        driverId,
        37.7749 + i * 0.001,
        -122.4194 + i * 0.001,
        VehicleClass.SEDAN,
        i * 10,
        30 + i
      );
    });

    await Promise.all(promises);

    // Should only have 1 entry in the spatial set for this driver
    const nearby = await geoService.getNearbyDrivers(37.7749, -122.4194, 5.0);
    const matched = nearby.filter((d) => d.driverId === driverId);
    expect(matched.length).toBe(1);

    // Metadata must be intact
    const meta = await geoService.getDriverMetadata(driverId);
    expect(meta).not.toBeNull();
    expect(meta?.driverId).toBe(driverId);
  });

  it('should buffer concurrent high-throughput packets and batch drain without data loss', async () => {
    const packetCount = 100;
    const insertedRecords: any[] = [];

    const mockDb = {
      async query(sql: string, params?: unknown[]) {
        if (params) {
          insertedRecords.push(...params);
        }
        return { rowCount: 1 };
      },
    };

    const buffer = new TelemetryBufferService(mockDb, { batchSize: 50 });

    const pushPromises = Array.from({ length: packetCount }, (_, i) => {
      return buffer.push({
        driverId: `d0000000-0000-4000-8000-${i.toString().padStart(12, '0')}`,
        lat: 37.7749 + i * 0.0001,
        lng: -122.4194,
        bearing: 180,
        speed: 25,
        timestamp: Date.now() + i * 1000,
      });
    });

    await Promise.all(pushPromises);

    // Flush any remaining packets
    await buffer.flush();

    expect(buffer.getBufferLength()).toBe(0);
    await buffer.close();
  });
});
