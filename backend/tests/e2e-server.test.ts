import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { WebSocket } from 'ws';
import { createApp } from '../src/index.js';
import { RealtimeGateway } from '../src/realtime/ws.gateway.js';
import { HeartbeatWorker } from '../src/services/redis/heartbeat.worker.js';

describe('End-to-End Integrated Ride-Hailing Server', () => {
  let server: http.Server;
  let context: ReturnType<typeof createApp>;
  let wsGateway: RealtimeGateway;
  let heartbeatWorker: HeartbeatWorker;
  const port = 52345;
  const baseUrl = `http://127.0.0.1:${port}`;
  const driverId = 'b0000000-0000-0000-0000-000000000001';
  const riderId = 'a0000000-0000-0000-0000-000000000001';
  const wsDriverUrl = `ws://127.0.0.1:${port}/ws/driver?driverId=${driverId}`;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    context = createApp();
    server = http.createServer(context.app);

    wsGateway = new RealtimeGateway(
      server,
      context.geoService,
      context.pubSubService,
      context.telemetryBuffer
    );

    heartbeatWorker = new HeartbeatWorker(
      context.redis,
      context.geoService,
      context.pubSubService
    );
    heartbeatWorker.start();

    await new Promise<void>((resolve) => {
      server.listen(port, '127.0.0.1', () => resolve());
    });
  });

  afterAll(async () => {
    heartbeatWorker.stop();
    await context.telemetryBuffer.flush();
    await wsGateway.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await context.redis.quit();
  });

  it('1. should respond to GET /health with HEALTHY status', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.status).toBe('UP');
    expect(body.redis).toBe('HEALTHY');
  });

  it('2. should set driver duty status to ONLINE and ingest live telemetry via WebSocket', async () => {
    // Connect WebSocket
    const ws = new WebSocket(wsDriverUrl);
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', reject);
    });

    const ackPromise = new Promise<any>((resolve) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'TELEMETRY_ACK') {
          resolve(msg);
        }
      });
    });

    // Send Telemetry
    ws.send(
      JSON.stringify({
        type: 'TELEMETRY',
        driverId,
        lat: 37.7749,
        lng: -122.4194,
        bearing: 90,
        speed: 25,
        timestamp: Date.now(),
      })
    );

    const ack = await ackPromise;
    expect(ack.type).toBe('TELEMETRY_ACK');

    ws.close();
  });

  it('3. should find the online driver in GET /api/v1/drivers/nearby', async () => {
    const res = await fetch(
      `${baseUrl}/api/v1/drivers/nearby?lat=37.7749&lng=-122.4194&radiusKm=5&vehicleClass=SEDAN`
    );
    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(data.count).toBeGreaterThanOrEqual(1);
    expect(data.drivers[0].driverId).toBe(driverId);
  });

  it('4. should estimate upfront pricing and dynamic surge via POST /api/v1/pricing/estimate', async () => {
    const res = await fetch(`${baseUrl}/api/v1/pricing/estimate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pickupLat: 37.7749,
        pickupLng: -122.4194,
        destLat: 37.7849,
        destLng: -122.4094,
        vehicleClass: 'SEDAN',
      }),
    });

    expect(res.status).toBe(200);
    const estimate: any = await res.json();
    expect(estimate.vehicleClass).toBe('SEDAN');
    expect(estimate.surgeMultiplier).toBeGreaterThanOrEqual(1.0);
    expect(estimate.finalFare).toBeGreaterThan(0);
    expect(estimate.currency).toBe('USD');
  });

  it('5. should execute the complete ride lifecycle: Request -> Accept -> Arrived -> Start -> Complete', async () => {
    // Step A: Request ride
    const reqRes = await fetch(`${baseUrl}/api/v1/rides/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        riderId,
        pickupAddress: '100 Market St, SF',
        pickupLocation: { lat: 37.7749, lng: -122.4194 },
        dropoffAddress: '500 Howard St, SF',
        dropoffLocation: { lat: 37.7849, lng: -122.4094 },
        vehicleClass: 'SEDAN',
      }),
    });

    expect(reqRes.status).toBe(201);
    const ride: any = await reqRes.json();
    expect(ride.status).toBe('SEARCHING_DRIVER');
    expect(ride.otp).toBeDefined();

    // Step B: Accept ride
    const acceptRes = await fetch(`${baseUrl}/api/v1/rides/${ride.id}/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ driverId }),
    });
    expect(acceptRes.status).toBe(200);
    const acceptedRide: any = await acceptRes.json();
    expect(acceptedRide.status).toBe('ACCEPTED');
    expect(acceptedRide.driverId).toBe(driverId);

    // Step C: Arrive at pickup
    const arriveRes = await fetch(`${baseUrl}/api/v1/rides/${ride.id}/arrived`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ driverId }),
    });
    expect(arriveRes.status).toBe(200);
    const arrivedRide: any = await arriveRes.json();
    expect(arrivedRide.status).toBe('ARRIVED_AT_PICKUP');

    // Step D: Start trip with OTP
    const startRes = await fetch(`${baseUrl}/api/v1/rides/${ride.id}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ driverId, otp: ride.otp }),
    });
    expect(startRes.status).toBe(200);
    const startedRide: any = await startRes.json();
    expect(startedRide.status).toBe('IN_TRANSIT');

    // Step E: Complete trip
    const completeRes = await fetch(`${baseUrl}/api/v1/rides/${ride.id}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ driverId }),
    });
    expect(completeRes.status).toBe(200);
    const completedRide: any = await completeRes.json();
    expect(completedRide.status).toBe('COMPLETED');
    expect(completedRide.completedAt).toBeDefined();
  });

  it('6. should allow autonomous support agent to triage complaint and issue refund via POST /api/v1/support/chat', async () => {
    // Create a ride to refund
    const ride = await context.rideService.requestRide({
      riderId,
      pickupAddress: '100 Market St',
      pickupLocation: { lat: 37.7749, lng: -122.4194 },
      dropoffAddress: '500 Howard St',
      dropoffLocation: { lat: 37.7849, lng: -122.4094 },
      vehicleClass: 'SEDAN' as any,
    });

    // Simulate route monitoring with verified corridor deviation
    context.safetyAgent.registerTripCorridor(ride.id, driverId, [
      { lat: 37.7749, lng: -122.4194 },
      { lat: 37.7849, lng: -122.4094 },
    ]);
    await context.safetyAgent.evaluateTelemetry({
      rideId: ride.id,
      driverId,
      lat: 37.8000,
      lng: -122.3900,
      speed: 35,
      timestamp: Date.now(),
    });

    const res = await fetch(`${baseUrl}/api/v1/support/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: riderId,
        rideId: ride.id,
        message: 'The driver took a major detour and deviated from the route. I request a refund.',
      }),
    });

    expect(res.status).toBe(200);
    const ticket: any = await res.json();
    expect(ticket.status).toBe('REFUNDED');
    expect(ticket.refundIssued).toBeGreaterThan(0);
    expect(ticket.resolutionNotes).toContain('credited to your wallet');
  });
});
