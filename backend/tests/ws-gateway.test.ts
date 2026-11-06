import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { WebSocket } from 'ws';
import { InMemoryRedisClient } from '../src/services/redis/in-memory-redis.js';
import { RedisGeoService } from '../src/services/redis/geo.service.js';
import { RedisPubSubService } from '../src/services/redis/pubsub.service.js';
import { TelemetryBufferService } from '../src/services/telemetry/telemetry-buffer.service.js';
import { RealtimeGateway } from '../src/realtime/ws.gateway.js';
import { VehicleClass } from '../src/modules/vehicles/types.js';

describe('Phase 2 - WebSocket Gateway Lifecycle & Ingestion', () => {
  let server: http.Server;
  let gateway: RealtimeGateway;
  let redis: InMemoryRedisClient;
  let geoService: RedisGeoService;
  let pubSubService: RedisPubSubService;
  let telemetryBuffer: TelemetryBufferService;
  let port: number;

  beforeEach(async () => {
    redis = new InMemoryRedisClient();
    geoService = new RedisGeoService(redis);
    pubSubService = new RedisPubSubService(redis);
    telemetryBuffer = new TelemetryBufferService();

    server = http.createServer();
    gateway = new RealtimeGateway(server, geoService, pubSubService, telemetryBuffer);

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as any;
        port = addr.port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await gateway.close();
    await telemetryBuffer.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function createClient(path: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
      ws.on('open', () => resolve(ws));
      ws.on('error', reject);
    });
  }

  function waitForMessage(ws: WebSocket): Promise<any> {
    return new Promise((resolve) => {
      ws.once('message', (data) => {
        resolve(JSON.parse(data.toString()));
      });
    });
  }

  it('should reject invalid telemetry packets with Zod error format', async () => {
    const driverWs = await createClient('/ws/driver?driverId=d0000000-0000-4000-8000-000000000001');

    // Missing lat/lng and invalid driverId
    driverWs.send(JSON.stringify({
      type: 'TELEMETRY',
      driverId: 'invalid-uuid',
    }));

    const response = await waitForMessage(driverWs);
    expect(response.type).toBe('ERROR');
    expect(response.message).toBe('Invalid payload format');
    expect(response.details).toBeDefined();

    driverWs.close();
  });

  it('should accept valid telemetry, acknowledge, update Redis, and buffer for persistence', async () => {
    const driverId = 'd0000000-0000-4000-8000-000000000001';
    const driverWs = await createClient(`/ws/driver?driverId=${driverId}`);

    const packet = {
      type: 'TELEMETRY',
      driverId,
      lat: 37.7749,
      lng: -122.4194,
      bearing: 120.5,
      speed: 42.0,
      timestamp: Date.now(),
    };

    driverWs.send(JSON.stringify(packet));

    const ack = await waitForMessage(driverWs);
    expect(ack.type).toBe('TELEMETRY_ACK');

    // Verify Redis spatial index was updated
    const nearby = await geoService.getNearbyDrivers(37.7749, -122.4194, 1.0);
    expect(nearby.length).toBe(1);
    expect(nearby[0].driverId).toBe(driverId);
    expect(nearby[0].speed).toBe(42.0);

    // Verify buffered in write-behind queue
    expect(telemetryBuffer.getBufferLength()).toBe(1);

    driverWs.close();
  });

  it('should support Rider area subscription and live driver streaming', async () => {
    const riderWs = await createClient('/ws/rider?riderId=r0000000-0000-4000-8000-000000000001');

    // 1. Rider subscribes to nearby drivers
    riderWs.send(JSON.stringify({
      type: 'SUBSCRIBE_NEARBY',
      lat: 37.7749,
      lng: -122.4194,
      radiusKm: 5.0,
    }));

    const snapshot = await waitForMessage(riderWs);
    expect(snapshot.type).toBe('NEARBY_DRIVERS');
    expect(Array.isArray(snapshot.drivers)).toBe(true);

    // 2. Driver connects and emits telemetry in the same area
    const driverId = 'd0000000-0000-4000-8000-000000000002';
    const driverWs = await createClient(`/ws/driver?driverId=${driverId}`);

    const broadcastPromise = waitForMessage(riderWs);

    driverWs.send(JSON.stringify({
      type: 'TELEMETRY',
      driverId,
      lat: 37.775,
      lng: -122.419,
      bearing: 45.0,
      speed: 30.0,
      timestamp: Date.now(),
    }));

    // Rider receives real-time area telemetry broadcast
    const broadcast = await broadcastPromise;
    expect(broadcast.type).toBe('AREA_TELEMETRY');
    expect(broadcast.driverId).toBe(driverId);
    expect(broadcast.lat).toBe(37.75 < broadcast.lat && broadcast.lat < 37.8 ? broadcast.lat : 37.775);

    riderWs.close();
    driverWs.close();
  });

  it('should support Rider active trip tracking channel (/ws/rider TRACK_TRIP)', async () => {
    const rideId = 'b0000000-0000-4000-8000-000000000099';
    const driverId = 'd0000000-0000-4000-8000-000000000003';

    const riderWs = await createClient('/ws/rider?riderId=r0000000-0000-4000-8000-000000000001');

    // 1. Rider tracks active trip
    riderWs.send(JSON.stringify({
      type: 'TRACK_TRIP',
      rideId,
      driverId,
    }));

    const startAck = await waitForMessage(riderWs);
    expect(startAck.type).toBe('TRACKING_STARTED');
    expect(startAck.rideId).toBe(rideId);

    // 2. Driver emits in-transit trip telemetry
    const driverWs = await createClient(`/ws/driver?driverId=${driverId}`);

    const tripPromise = waitForMessage(riderWs);

    driverWs.send(JSON.stringify({
      type: 'TELEMETRY',
      driverId,
      lat: 37.7812,
      lng: -122.4111,
      bearing: 88.0,
      speed: 55.4,
      timestamp: Date.now(),
      rideId, // In-transit ride ID
    }));

    // Rider receives trip telemetry broadcast
    const tripTelemetry = await tripPromise;
    expect(tripTelemetry.type).toBe('TRIP_TELEMETRY');
    expect(tripTelemetry.rideId).toBe(rideId);
    expect(tripTelemetry.driverId).toBe(driverId);
    expect(tripTelemetry.speed).toBe(55.4);

    riderWs.close();
    driverWs.close();
  });
});
