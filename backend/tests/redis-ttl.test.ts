import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { InMemoryRedisClient } from '../src/services/redis/in-memory-redis.js';
import { RedisGeoService, DRIVER_HEARTBEAT_TTL_SECONDS } from '../src/services/redis/geo.service.js';
import { RedisPubSubService } from '../src/services/redis/pubsub.service.js';
import { HeartbeatWorker } from '../src/services/redis/heartbeat.worker.js';
import { VehicleClass } from '../src/modules/vehicles/types.js';

describe('Phase 2 - TTL Expiration & Auto-Offline Background Worker', () => {
  let redis: InMemoryRedisClient;
  let geoService: RedisGeoService;
  let pubSubService: RedisPubSubService;
  let heartbeatWorker: HeartbeatWorker;

  beforeEach(() => {
    vi.useFakeTimers();
    redis = new InMemoryRedisClient();
    geoService = new RedisGeoService(redis);
    pubSubService = new RedisPubSubService(redis);
    heartbeatWorker = new HeartbeatWorker(redis, geoService, pubSubService, {
      checkIntervalMs: 1000,
      silenceThresholdSeconds: 15,
    });
  });

  afterEach(() => {
    heartbeatWorker.stop();
    vi.useRealTimers();
  });

  it('should set an automated sliding TTL of 15 seconds on driver metadata', async () => {
    const driverId = 'd-ttl-001';
    await geoService.updateDriverLocation(driverId, 37.7749, -122.4194, VehicleClass.SEDAN);

    const ttl = await redis.ttl(`driver:meta:${driverId}`);
    expect(ttl).toBeGreaterThan(10);
    expect(ttl).toBeLessThanOrEqual(DRIVER_HEARTBEAT_TTL_SECONDS);
  });

  it('should refresh the 15-second TTL on subsequent telemetry updates (sliding window)', async () => {
    const driverId = 'd-ttl-002';
    await geoService.updateDriverLocation(driverId, 37.7749, -122.4194, VehicleClass.SEDAN);

    // Advance time by 10 seconds
    vi.advanceTimersByTime(10000);

    let ttl = await redis.ttl(`driver:meta:${driverId}`);
    expect(ttl).toBeLessThanOrEqual(5);

    // Heartbeat arrives at second 10
    await geoService.updateDriverLocation(driverId, 37.775, -122.419, VehicleClass.SEDAN);

    // TTL must be refreshed back to 15 seconds
    ttl = await redis.ttl(`driver:meta:${driverId}`);
    expect(ttl).toBeGreaterThan(10);
    expect(ttl).toBeLessThanOrEqual(DRIVER_HEARTBEAT_TTL_SECONDS);
  });

  it('should make driver non-queryable and lazily clean spatial sets once TTL expires (>15s)', async () => {
    const driverId = 'd-ttl-003';
    await geoService.updateDriverLocation(driverId, 37.7749, -122.4194, VehicleClass.SEDAN);

    // Advance time past the 15s threshold (16 seconds)
    vi.advanceTimersByTime(16000);

    // Nearby drivers query should drop expired driver
    const nearby = await geoService.getNearbyDrivers(37.7749, -122.4194, 5.0);
    expect(nearby.length).toBe(0);

    // Metadata hash should be purged
    const meta = await geoService.getDriverMetadata(driverId);
    expect(meta).toBeNull();
  });

  it('should proactively detect expired drivers via HeartbeatWorker and trigger auto-offline events', async () => {
    const activeDriver = 'd-worker-active';
    const silentDriver = 'd-worker-silent';

    await geoService.updateDriverLocation(activeDriver, 37.7749, -122.4194, VehicleClass.SEDAN);
    await geoService.updateDriverLocation(silentDriver, 37.775, -122.419, VehicleClass.SEDAN);

    // Capture expired event
    const expiredEvents: any[] = [];
    heartbeatWorker.on('driver:expired', (event) => {
      expiredEvents.push(event);
    });

    // Advance time by 8 seconds: keep activeDriver alive
    vi.advanceTimersByTime(8000);
    await geoService.updateDriverLocation(activeDriver, 37.7751, -122.4192, VehicleClass.SEDAN);

    // Advance time by another 8 seconds (silentDriver is now at 16 seconds silence!)
    vi.advanceTimersByTime(8000);

    // Trigger heartbeat sweep
    const evicted = await heartbeatWorker.checkHeartbeats();

    expect(evicted).toContain(silentDriver);
    expect(evicted).not.toContain(activeDriver);
    expect(expiredEvents.length).toBe(1);
    expect(expiredEvents[0].driverId).toBe(silentDriver);

    // Verify silentDriver is removed from active spatial set
    const remaining = await geoService.getNearbyDrivers(37.7749, -122.4194, 5.0);
    expect(remaining.map((d) => d.driverId)).toEqual([activeDriver]);
  });
});
