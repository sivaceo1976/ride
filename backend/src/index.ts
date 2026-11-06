import http from 'node:http';
import express, { Request, Response } from 'express';
import cors from 'cors';
import { getRedisClient } from './services/redis/redis.client.js';
import { RedisGeoService } from './services/redis/geo.service.js';
import { RedisPubSubService } from './services/redis/pubsub.service.js';
import { TelemetryBufferService } from './services/telemetry/telemetry-buffer.service.js';
import { DistributedLockManager } from './services/locking/lock.manager.js';
import { DispatchEngine } from './services/dispatch/dispatch.engine.js';
import { RideService } from './modules/rides/ride.service.js';
import { createRideRouter } from './modules/rides/ride.controller.js';
import { PricingService } from './services/pricing/pricing.service.js';
import { DynamicSurgeAgent } from './agents/surge/surge.agent.js';
import { RouteSafetyAgent } from './agents/safety/safety.agent.js';
import { CustomerSupportAgent } from './agents/support/support.agent.js';
import { HeartbeatWorker } from './services/redis/heartbeat.worker.js';
import { RealtimeGateway } from './realtime/ws.gateway.js';
import { calculateHaversineDistanceKm, latLngToH3Cell } from './utils/geo.js';
import { VehicleClass } from './modules/vehicles/types.js';

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Request logger
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      if (process.env.NODE_ENV !== 'test') {
        console.log(`[HTTP] ${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms`);
      }
    });
    next();
  });

  // Redis & Infrastructure
  const redis = getRedisClient();
  const geoService = new RedisGeoService(redis);
  const pubSubService = new RedisPubSubService(redis);
  const telemetryBuffer = new TelemetryBufferService();
  const lockManager = new DistributedLockManager(redis);
  const dispatchEngine = new DispatchEngine(redis, geoService, lockManager, pubSubService);
  const rideService = new RideService(lockManager, geoService, pubSubService, dispatchEngine);
  const pricingService = new PricingService(redis);
  const surgeAgent = new DynamicSurgeAgent(pricingService);
  const safetyAgent = new RouteSafetyAgent(pubSubService);
  const supportAgent = new CustomerSupportAgent(rideService, safetyAgent);

  // Health endpoint
  app.get('/health', async (_req: Request, res: Response) => {
    try {
      const pong = await redis.ping();
      return res.status(200).json({
        status: 'UP',
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.floor(process.uptime()),
        redis: pong === 'PONG' ? 'HEALTHY' : 'DEGRADED',
      });
    } catch (err: any) {
      return res.status(503).json({
        status: 'DOWN',
        error: err.message,
      });
    }
  });

  // Mount Rides REST Router
  app.use('/rides', createRideRouter(rideService));
  app.use('/api/v1/rides', createRideRouter(rideService));

  // Dynamic Fare & Surge Preview
  app.post('/api/v1/pricing/estimate', async (req: Request, res: Response) => {
    try {
      const { pickupLat, pickupLng, destLat, destLng, vehicleClass, weather } = req.body;
      if (
        pickupLat === undefined ||
        pickupLng === undefined ||
        destLat === undefined ||
        destLng === undefined
      ) {
        return res.status(400).json({ error: 'pickupLat, pickupLng, destLat, and destLng are required' });
      }

      const vClass = (vehicleClass as VehicleClass) || VehicleClass.SEDAN;
      const distanceKm = calculateHaversineDistanceKm(
        { lat: pickupLat, lng: pickupLng },
        { lat: destLat, lng: destLng }
      );
      const estDurationMins = Math.max(3, Math.round((distanceKm / 30) * 60)); // assume avg 30km/h in city

      const h3Cell = latLngToH3Cell(pickupLat, pickupLng, 8);
      const demand = await pricingService.getCellDemand(h3Cell);
      const nearbyDrivers = await geoService.getNearbyDrivers(pickupLat, pickupLng, 3, vClass);
      const supply = nearbyDrivers.length;

      const surgeRec = await surgeAgent.evaluateSurge(
        h3Cell,
        demand,
        supply,
        weather || 'CLEAR'
      );

      // Base fare rates per vehicle class
      const rates = {
        [VehicleClass.BIKE]: { base: 2.0, perKm: 0.8, perMin: 0.15 },
        [VehicleClass.SEDAN]: { base: 4.0, perKm: 1.5, perMin: 0.25 },
        [VehicleClass.SUV]: { base: 7.0, perKm: 2.5, perMin: 0.4 },
      }[vClass] || { base: 4.0, perKm: 1.5, perMin: 0.25 };

      const rawFare = rates.base + rates.perKm * distanceKm + rates.perMin * estDurationMins;
      const finalFare = Math.round(rawFare * surgeRec.surgeMultiplier * 100) / 100;

      return res.status(200).json({
        distanceKm: Math.round(distanceKm * 100) / 100,
        estimatedDurationMinutes: estDurationMins,
        vehicleClass: vClass,
        baseFare: rates.base,
        distanceFare: Math.round(rates.perKm * distanceKm * 100) / 100,
        timeFare: Math.round(rates.perMin * estDurationMins * 100) / 100,
        surgeMultiplier: surgeRec.surgeMultiplier,
        isSurgeActive: surgeRec.surgeMultiplier > 1.0,
        surgeJustification: surgeRec.justification,
        finalFare,
        currency: 'USD',
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Pricing estimation failed' });
    }
  });

  // Nearby drivers query endpoint
  app.get('/api/v1/drivers/nearby', async (req: Request, res: Response) => {
    try {
      const lat = parseFloat(req.query.lat as string);
      const lng = parseFloat(req.query.lng as string);
      const radiusKm = parseFloat((req.query.radiusKm as string) || '3');
      const vehicleClass = req.query.vehicleClass as VehicleClass | undefined;

      if (isNaN(lat) || isNaN(lng)) {
        return res.status(400).json({ error: 'lat and lng must be valid numbers' });
      }

      const drivers = await geoService.getNearbyDrivers(lat, lng, radiusKm, vehicleClass);
      return res.status(200).json({
        count: drivers.length,
        drivers,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Failed to query nearby drivers' });
    }
  });

  // Driver duty status endpoint
  app.post('/api/v1/driver/duty', async (req: Request, res: Response) => {
    try {
      const { driverId, status } = req.body;
      if (!driverId || (status !== 'ONLINE' && status !== 'OFFLINE')) {
        return res.status(400).json({ error: "driverId and status ('ONLINE' | 'OFFLINE') are required" });
      }

      await geoService.setDriverDutyStatus(driverId, status);
      return res.status(200).json({ driverId, status });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Failed to update driver status' });
    }
  });

  // Customer Support Agent chat endpoint
  app.post('/api/v1/support/chat', async (req: Request, res: Response) => {
    try {
      const { userId, message, rideId } = req.body;
      if (!userId || !message) {
        return res.status(400).json({ error: 'userId and message are required' });
      }

      const ticket = await supportAgent.handleComplaint(userId, message, rideId);
      return res.status(200).json(ticket);
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Support chat processing failed' });
    }
  });

  return {
    app,
    redis,
    geoService,
    pubSubService,
    telemetryBuffer,
    lockManager,
    dispatchEngine,
    rideService,
    pricingService,
    surgeAgent,
    safetyAgent,
    supportAgent,
  };
}

export async function bootstrapServer(port = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000) {
  const context = createApp();
  const server = http.createServer(context.app);

  // Initialize Realtime WebSocket Gateway
  const wsGateway = new RealtimeGateway(
    server,
    context.geoService,
    context.pubSubService,
    context.telemetryBuffer
  );

  // Initialize Heartbeat Worker
  const heartbeatWorker = new HeartbeatWorker(
    context.redis,
    context.geoService,
    context.pubSubService
  );
  heartbeatWorker.start();

  // Listen
  await new Promise<void>((resolve) => {
    server.listen(port, () => {
      console.log(`[RideHailing API] Server running on port ${port}`);
      console.log(`[WebSocket] Driver Channel: ws://localhost:${port}/ws/driver`);
      console.log(`[WebSocket] Rider Channel: ws://localhost:${port}/ws/rider`);
      resolve();
    });
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('[System] Initiating graceful shutdown...');
    heartbeatWorker.stop();
    await context.telemetryBuffer.flush();
    await wsGateway.close();
    server.close();
    await context.redis.quit();
    console.log('[System] Graceful shutdown completed.');
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  return { server, context, wsGateway, heartbeatWorker };
}

// Auto-run if executed directly
if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}`) {
  bootstrapServer().catch((err) => {
    console.error('[Fatal] Server failed to start:', err);
    process.exit(1);
  });
}
