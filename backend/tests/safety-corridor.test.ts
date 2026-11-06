import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryRedisClient } from '../src/services/redis/in-memory-redis.js';
import { RedisPubSubService } from '../src/services/redis/pubsub.service.js';
import { RouteSafetyAgent } from '../src/agents/safety/safety.agent.js';
import { Coordinate } from '../src/modules/rides/types.js';

describe('Phase 4 - Route Corridor & Telemetry Safety Agent', () => {
  let redis: InMemoryRedisClient;
  let pubSubService: RedisPubSubService;
  let safetyAgent: RouteSafetyAgent;

  const rideId = 'r0000000-0000-4000-8000-000000000001';
  const driverId = 'd0000000-0000-4000-8000-000000000001';

  // Planned corridor: Market Street from Civic Center (37.779, -122.418) to Embarcadero (37.794, -122.395)
  const plannedCorridor: Coordinate[] = [
    { lat: 37.779, lng: -122.418 },
    { lat: 37.785, lng: -122.408 },
    { lat: 37.794, lng: -122.395 },
  ];

  beforeEach(() => {
    redis = new InMemoryRedisClient();
    pubSubService = new RedisPubSubService(redis);
    safetyAgent = new RouteSafetyAgent(pubSubService);

    // Register active trip
    safetyAgent.registerTripCorridor(rideId, driverId, plannedCorridor);
  });

  it('should trigger zero alerts when driver coordinates stay within the 500m corridor', async () => {
    // Coordinate ~50 meters off the line segment
    const onRouteCoord = { lat: 37.7853, lng: -122.4082 };

    const alerts = await safetyAgent.evaluateTelemetry({
      rideId,
      driverId,
      lat: onRouteCoord.lat,
      lng: onRouteCoord.lng,
      speed: 35.0,
      timestamp: Date.now(),
    });

    expect(alerts.length).toBe(0);
    expect(safetyAgent.getAlertsForRide(rideId).length).toBe(0);
  });

  it('should detect orthogonal corridor deviation > 500m and emit SAFETY_CORRIDOR_DEVIATION', async () => {
    // Telemetry location deviated ~1.8 km south into Mission District
    const offCorridorCoord = { lat: 37.765, lng: -122.42 };

    const broadcastedAlerts: any[] = [];
    await redis.subscribe(`trip:${rideId}`, (_, msg) => {
      broadcastedAlerts.push(JSON.parse(msg));
    });

    const alerts = await safetyAgent.evaluateTelemetry({
      rideId,
      driverId,
      lat: offCorridorCoord.lat,
      lng: offCorridorCoord.lng,
      speed: 40.0,
      timestamp: Date.now(),
    });

    expect(alerts.length).toBe(1);
    expect(alerts[0].type).toBe('SAFETY_CORRIDOR_DEVIATION');
    expect(alerts[0].details.deviationMeters).toBeGreaterThan(500);

    // Verify persisted in safety audit trail
    const audit = safetyAgent.getAlertsForRide(rideId);
    expect(audit.length).toBe(1);
    expect(audit[0].id).toBe(alerts[0].id);

    // Verify broadcast to rider
    expect(broadcastedAlerts.length).toBe(1);
    expect(broadcastedAlerts[0].type).toBe('TRIP_TELEMETRY');
  });

  it('should detect unauthorized stoppage (>5 minutes with speed <= 2 km/h) and emit SAFETY_UNSCHEDULED_STOP', async () => {
    const baseTime = Date.now();
    const stationaryCoord = { lat: 37.785, lng: -122.408 };

    // Packet 1: Vehicle comes to a stop (speed = 0) at t = 0
    await safetyAgent.evaluateTelemetry({
      rideId,
      driverId,
      lat: stationaryCoord.lat,
      lng: stationaryCoord.lng,
      speed: 0.0,
      timestamp: baseTime,
    });

    // Packet 2: Still stopped at t = 3 minutes (180,000ms) -> No alert yet (below 5 min threshold)
    const midAlerts = await safetyAgent.evaluateTelemetry({
      rideId,
      driverId,
      lat: stationaryCoord.lat,
      lng: stationaryCoord.lng,
      speed: 0.0,
      timestamp: baseTime + 180000,
    });
    expect(midAlerts.length).toBe(0);

    // Packet 3: Still stopped at t = 5.5 minutes (330,000ms) -> Triggers alert!
    const triggerAlerts = await safetyAgent.evaluateTelemetry({
      rideId,
      driverId,
      lat: stationaryCoord.lat,
      lng: stationaryCoord.lng,
      speed: 1.0, // speed <= 2 km/h
      timestamp: baseTime + 330000,
    });

    expect(triggerAlerts.length).toBe(1);
    expect(triggerAlerts[0].type).toBe('SAFETY_UNSCHEDULED_STOP');
    expect(triggerAlerts[0].severity).toBe('CRITICAL');
    expect(triggerAlerts[0].details.stoppedDurationSeconds).toBeGreaterThanOrEqual(300);
  });
});
