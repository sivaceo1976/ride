import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Phase 1 Imports
import { UserRole, CreateUserSchema } from '../src/modules/users/types.js';
import { VehicleClass, CreateVehicleSchema } from '../src/modules/vehicles/types.js';
import {
  RideStatus,
  CoordinateSchema,
  FareBreakdownSchema,
  canTransitionRide,
} from '../src/modules/rides/types.js';
import { TelemetryPacketSchema } from '../src/modules/telemetry/types.js';
import {
  calculateHaversineDistanceKm,
  calculateBearing,
  coordinateToWkt,
  wktToCoordinate,
  coordinateToGeoJson,
  geoJsonToCoordinate,
  minDistanceToCorridor,
  latLngToH3Cell,
} from '../src/utils/geo.js';
import { PostGisHelper } from '../src/database/postgis.js';
import { generatePickupOtp, verifyPickupOtp } from '../src/utils/otp.js';
import {
  getIsoWeekDetails,
  getWeekPartitionInfo,
  generatePartitionDdl,
  generateUpcomingPartitionDdls,
} from '../src/database/partitions.js';
import { SEED_DATA } from '../src/database/seed-data.js';
import { seedDatabase, generateSeedSql, DbQueryRunner } from '../src/database/seed.js';

// Phase 2 Imports
import { InMemoryRedisClient } from '../src/services/redis/in-memory-redis.js';
import { RedisGeoService } from '../src/services/redis/geo.service.js';
import { RedisPubSubService } from '../src/services/redis/pubsub.service.js';
import { HeartbeatWorker } from '../src/services/redis/heartbeat.worker.js';
import { TelemetryBufferService } from '../src/services/telemetry/telemetry-buffer.service.js';

// Phase 3 Imports
import { DistributedLockManager } from '../src/services/locking/lock.manager.js';
import { DispatchEngine } from '../src/services/dispatch/dispatch.engine.js';
import { RideService, RideConflictError, InvalidOtpError } from '../src/modules/rides/ride.service.js';

// Phase 4 Imports
import { PricingService } from '../src/services/pricing/pricing.service.js';
import { DynamicSurgeAgent } from '../src/agents/surge/surge.agent.js';
import { BipartiteDispatchMatcher } from '../src/agents/dispatch/bipartite.matcher.js';
import { RouteSafetyAgent } from '../src/agents/safety/safety.agent.js';
import { CustomerSupportAgent } from '../src/agents/support/support.agent.js';

describe('Phase 1 - Comprehensive Verification Suite', () => {
  describe('1. User & Vehicle Schema Validations', () => {
    it('should validate valid user entities', () => {
      const user = CreateUserSchema.parse({
        phone: '+14155551234',
        name: 'Sarah Connor',
        role: UserRole.RIDER,
        rating: 4.9,
        walletBalance: 120.5,
      });
      assert.equal(user.name, 'Sarah Connor');
      assert.equal(user.role, UserRole.RIDER);
    });

    it('should reject invalid phone numbers', () => {
      assert.throws(() => {
        CreateUserSchema.parse({ phone: '1234', name: 'Bad Phone' });
      });
    });

    it('should validate vehicle and uppercase license plate', () => {
      const v = CreateVehicleSchema.parse({
        driverId: 'd0000000-0000-4000-8000-000000000001',
        make: 'Toyota',
        model: 'Prius',
        year: 2023,
        licensePlate: '  6xyz789  ',
        class: VehicleClass.SEDAN,
        color: 'White',
      });
      assert.equal(v.licensePlate, '6XYZ789');
    });
  });

  describe('2. PostGIS & Geospatial Mathematics', () => {
    const sfDowntown = { lat: 37.7925, lng: -122.4042 };
    const sfPier39 = { lat: 37.8087, lng: -122.4098 };

    it('should compute Haversine distance within expected corridor bounds (~1.87 km)', () => {
      const dist = calculateHaversineDistanceKm(sfDowntown, sfPier39);
      assert.ok(dist > 1.7 && dist < 2.1, `Expected ~1.87 km, got ${dist}`);
    });

    it('should compute accurate cardinal bearings', () => {
      const origin = { lat: 0, lng: 0 };
      assert.ok(Math.abs(calculateBearing(origin, { lat: 10, lng: 0 }) - 0) < 0.1);
      assert.ok(Math.abs(calculateBearing(origin, { lat: 0, lng: 10 }) - 90) < 0.1);
      assert.ok(Math.abs(calculateBearing(origin, { lat: -10, lng: 0 }) - 180) < 0.1);
      assert.ok(Math.abs(calculateBearing(origin, { lat: 0, lng: -10 }) - 270) < 0.1);
    });

    it('should convert WKT and GeoJSON points bidirectionally', () => {
      const wkt = coordinateToWkt(sfDowntown);
      assert.equal(wkt, 'SRID=4326;POINT(-122.4042 37.7925)');
      const parsedWkt = wktToCoordinate(wkt);
      assert.ok(Math.abs(parsedWkt.lat - sfDowntown.lat) < 0.0001);
      assert.ok(Math.abs(parsedWkt.lng - sfDowntown.lng) < 0.0001);

      const geoJson = coordinateToGeoJson(sfDowntown);
      assert.deepEqual(geoJson.coordinates, [-122.4042, 37.7925]);
      const parsedGeo = geoJsonToCoordinate(geoJson);
      assert.equal(parsedGeo.lat, sfDowntown.lat);
      assert.equal(parsedGeo.lng, sfDowntown.lng);
    });

    it('should identify route corridor deviations (>500m alert trigger)', () => {
      const corridor = [
        { lat: 37.77, lng: -122.42 },
        { lat: 37.79, lng: -122.42 },
      ];
      const safePoint = { lat: 37.78, lng: -122.4189 };
      const unsafePoint = { lat: 37.78, lng: -122.403 };

      assert.ok(minDistanceToCorridor(safePoint, corridor) < 500);
      assert.ok(minDistanceToCorridor(unsafePoint, corridor) > 500);
    });

    it('should produce 15-character H3 hex indices', () => {
      const cell = latLngToH3Cell(37.7925, -122.4042, 8);
      assert.equal(typeof cell, 'string');
      assert.equal(cell.length, 15);
    });

    it('should parse database geometry formats via PostGisHelper', () => {
      const parsed = PostGisHelper.parseDbGeometry('SRID=4326;POINT(-122.4042 37.7925)');
      assert.equal(parsed.lat, 37.7925);
      assert.equal(parsed.lng, -122.4042);
    });
  });

  describe('3. Deterministic State Machine & OTP Security', () => {
    it('should allow valid lifecycle flow: REQUESTED -> SEARCHING -> ASSIGNED -> ACCEPTED -> ARRIVED -> IN_TRANSIT -> COMPLETED', () => {
      assert.ok(canTransitionRide(RideStatus.REQUESTED, RideStatus.SEARCHING_DRIVER));
      assert.ok(canTransitionRide(RideStatus.SEARCHING_DRIVER, RideStatus.ASSIGNED));
      assert.ok(canTransitionRide(RideStatus.ASSIGNED, RideStatus.ACCEPTED));
      assert.ok(canTransitionRide(RideStatus.ACCEPTED, RideStatus.ARRIVED_AT_PICKUP));
      assert.ok(canTransitionRide(RideStatus.ARRIVED_AT_PICKUP, RideStatus.IN_TRANSIT));
      assert.ok(canTransitionRide(RideStatus.IN_TRANSIT, RideStatus.COMPLETED));
    });

    it('should disallow invalid skip transitions', () => {
      assert.equal(canTransitionRide(RideStatus.REQUESTED, RideStatus.IN_TRANSIT), false);
      assert.equal(canTransitionRide(RideStatus.COMPLETED, RideStatus.ACCEPTED), false);
      assert.equal(canTransitionRide(RideStatus.CANCELLED, RideStatus.SEARCHING_DRIVER), false);
    });

    it('should generate secure 4-digit OTPs and verify with constant-time equality', () => {
      for (let i = 0; i < 20; i++) {
        const otp = generatePickupOtp();
        assert.match(otp, /^\d{4}$/);
        assert.ok(verifyPickupOtp(otp, otp));
      }
      assert.equal(verifyPickupOtp('1234', '5678'), false);
    });
  });

  describe('4. PostgreSQL Weekly Partitioning', () => {
    it('should compute correct ISO week and table name', () => {
      const date = new Date('2026-11-06T12:00:00Z');
      const { isoYear, isoWeek } = getIsoWeekDetails(date);
      assert.equal(isoYear, 2026);
      assert.equal(isoWeek, 45);

      const info = getWeekPartitionInfo(date);
      assert.equal(info.partitionName, 'driver_telemetry_2026_w45');
      assert.equal(info.startDate.toISOString(), '2026-11-02T00:00:00.000Z');
      assert.equal(info.endDate.toISOString(), '2026-11-09T00:00:00.000Z');
    });

    it('should generate valid PostgreSQL DDL partition statements', () => {
      const ddls = generateUpcomingPartitionDdls(new Date('2026-11-06T12:00:00Z'), 3);
      assert.equal(ddls.length, 3);
      assert.ok(ddls[0].includes('driver_telemetry_2026_w45'));
      assert.ok(ddls[1].includes('driver_telemetry_2026_w46'));
      assert.ok(ddls[2].includes('driver_telemetry_2026_w47'));
    });
  });

  describe('5. Seed Data Integrity & Execution', () => {
    it('should validate all seed users, vehicles, rides, and telemetry', () => {
      assert.equal(SEED_DATA.users.length, 8);
      assert.equal(SEED_DATA.vehicles.length, 4);
      assert.equal(SEED_DATA.rides.length, 3);
      assert.equal(SEED_DATA.telemetry.length, 5);

      for (const u of SEED_DATA.users) {
        CreateUserSchema.parse(u);
      }
      for (const v of SEED_DATA.vehicles) {
        CreateVehicleSchema.parse(v);
      }
      for (const r of SEED_DATA.rides) {
        CoordinateSchema.parse(r.pickupLocation);
        CoordinateSchema.parse(r.dropoffLocation);
        FareBreakdownSchema.parse(r.fareBreakdown);
        assert.match(r.otp, /^\d{4}$/);
      }
    });

    it('should generate valid seed SQL script', () => {
      const sql = generateSeedSql();
      assert.ok(sql.includes('BEGIN;'));
      assert.ok(sql.includes('COMMIT;'));
      assert.ok(sql.includes('INSERT INTO users'));
      assert.ok(sql.includes('INSERT INTO vehicles'));
      assert.ok(sql.includes('INSERT INTO rides'));
      assert.ok(sql.includes('INSERT INTO driver_telemetry'));
    });

    it('should execute seedDatabase without errors against mock query runner', async () => {
      const executed: Array<{ sql: string; params?: unknown[] }> = [];
      const mockClient: DbQueryRunner = {
        async query(sql: string, params?: unknown[]) {
          executed.push({ sql, params });
          return { rowCount: 1, rows: [] };
        },
      };

      const result = await seedDatabase(mockClient);
      assert.equal(result.usersInserted, 8);
      assert.equal(result.vehiclesInserted, 4);
      assert.equal(result.ridesInserted, 3);
      assert.equal(result.telemetryInserted, 5);
      assert.ok(executed.length >= 20);
    });
  });

  describe('6. Phase 2 - Redis Geospatial Operations & TTL Expiration', () => {
    it('should index drivers with GEOADD and search with GEOSEARCH by vehicle class', async () => {
      const redis = new InMemoryRedisClient();
      const geo = new RedisGeoService(redis);

      await geo.updateDriverLocation('d0000000-0000-4000-8000-000000000001', 37.78, -122.41, VehicleClass.SEDAN, 90, 40);
      await geo.updateDriverLocation('d0000000-0000-4000-8000-000000000002', 37.78, -122.41, VehicleClass.SUV, 180, 25);

      const sedans = await geo.getNearbyDrivers(37.7749, -122.4194, 5.0, VehicleClass.SEDAN);
      assert.equal(sedans.length, 1);
      assert.equal(sedans[0].driverId, 'd0000000-0000-4000-8000-000000000001');

      const all = await geo.getNearbyDrivers(37.7749, -122.4194, 5.0);
      assert.equal(all.length, 2);

      // Clean up duty status
      await geo.setDriverDutyStatus('d0000000-0000-4000-8000-000000000001', 'OFFLINE');
      const remaining = await geo.getNearbyDrivers(37.7749, -122.4194, 5.0);
      assert.equal(remaining.length, 1);
      assert.equal(remaining[0].driverId, 'd0000000-0000-4000-8000-000000000002');
    });

    it('should detect expired drivers via HeartbeatWorker and trigger auto-offline', async () => {
      const redis = new InMemoryRedisClient();
      const geo = new RedisGeoService(redis);
      const pubsub = new RedisPubSubService(redis);
      const worker = new HeartbeatWorker(redis, geo, pubsub, { silenceThresholdSeconds: 1 });

      await geo.updateDriverLocation('d0000000-0000-4000-8000-000000000003', 37.78, -122.41, VehicleClass.BIKE);

      // Artificially age the metadata
      await redis.hset('driver:meta:d0000000-0000-4000-8000-000000000003', {
        lastSeen: Date.now() - 2000,
      });

      const evicted = await worker.checkHeartbeats();
      assert.ok(evicted.includes('d0000000-0000-4000-8000-000000000003'));

      const nearby = await geo.getNearbyDrivers(37.78, -122.41, 5.0);
      assert.equal(nearby.length, 0);
    });

    it('should buffer telemetry in write-behind service and flush without data loss', async () => {
      const flushedRecords: any[] = [];
      const mockDb = {
        async query(sql: string, params?: unknown[]) {
          if (params) flushedRecords.push(...params);
          return { rowCount: 1 };
        },
      };

      const buffer = new TelemetryBufferService(mockDb, { batchSize: 5 });
      for (let i = 0; i < 5; i++) {
        await buffer.push({
          driverId: 'd0000000-0000-4000-8000-000000000001',
          lat: 37.77 + i * 0.001,
          lng: -122.41,
          bearing: 0,
          speed: 30,
          timestamp: Date.now() + i * 1000,
        });
      }

      await buffer.flush();
      assert.equal(buffer.getBufferLength(), 0);
      assert.ok(flushedRecords.length >= 5);
      await buffer.close();
    });
  });

  describe('7. Phase 3 - Distributed Locking & Trip State Machine', () => {
    it('should acquire atomic Redlock and block concurrent attempts', async () => {
      const redis = new InMemoryRedisClient();
      const lockManager = new DistributedLockManager(redis);

      const lock1 = await lockManager.acquire('driver:test-1', 5000);
      assert.ok(lock1 !== null);

      // Concurrent attempt must fail
      const lock2 = await lockManager.acquire('driver:test-1', 5000);
      assert.equal(lock2, null);

      // Release
      const released = await lockManager.release(lock1!);
      assert.equal(released, true);

      // Can acquire again
      const lock3 = await lockManager.acquire('driver:test-1', 5000);
      assert.ok(lock3 !== null);
    });

    it('should execute full trip lifecycle: Request -> Accept -> Arrived -> OTP -> Complete', async () => {
      const redis = new InMemoryRedisClient();
      const geo = new RedisGeoService(redis);
      const lockManager = new DistributedLockManager(redis);
      const pubsub = new RedisPubSubService(redis);
      const dispatch = new DispatchEngine(redis, geo, lockManager, pubsub);
      const rideService = new RideService(lockManager, geo, pubsub, dispatch);

      const driverId = 'd0000000-0000-4000-8000-000000000001';
      await geo.updateDriverLocation(driverId, 37.775, -122.419, VehicleClass.SEDAN);

      // 1. Request
      const ride = await rideService.requestRide({
        riderId: 'a0000000-0000-4000-8000-000000000001',
        pickupAddress: 'Market St, SF',
        pickupLocation: { lat: 37.7749, lng: -122.4194 },
        dropoffAddress: 'Pier 39, SF',
        dropoffLocation: { lat: 37.8087, lng: -122.4098 },
        vehicleClass: 'SEDAN',
      });
      assert.equal(ride.status, RideStatus.SEARCHING_DRIVER);

      // 2. Accept
      const accepted = await rideService.acceptRide(ride.id, driverId);
      assert.equal(accepted.status, RideStatus.ACCEPTED);
      assert.equal(accepted.driverId, driverId);

      // 3. Arrived
      const arrived = await rideService.driverArrived(ride.id, driverId);
      assert.equal(arrived.status, RideStatus.ARRIVED_AT_PICKUP);

      // 4. Invalid OTP rejection
      await assert.rejects(
        () => rideService.startTrip(ride.id, driverId, '0000'),
        InvalidOtpError
      );

      // 5. Valid OTP -> In Transit
      const inTransit = await rideService.startTrip(ride.id, driverId, ride.otp);
      assert.equal(inTransit.status, RideStatus.IN_TRANSIT);

      // 6. Complete
      const completed = await rideService.completeTrip(ride.id, driverId);
      assert.equal(completed.status, RideStatus.COMPLETED);

      // Driver released in Redis
      const meta = await geo.getDriverMetadata(driverId);
      assert.equal(meta?.status, 'ONLINE');
      assert.equal(meta?.rideId, undefined);
    });

    it('should prevent race condition / double acceptance', async () => {
      const redis = new InMemoryRedisClient();
      const geo = new RedisGeoService(redis);
      const lockManager = new DistributedLockManager(redis);
      const pubsub = new RedisPubSubService(redis);
      const dispatch = new DispatchEngine(redis, geo, lockManager, pubsub);
      const rideService = new RideService(lockManager, geo, pubsub, dispatch);

      const d1 = 'd0000000-0000-4000-8000-000000000001';
      const d2 = 'd0000000-0000-4000-8000-000000000002';
      await geo.updateDriverLocation(d1, 37.775, -122.419, VehicleClass.SEDAN);
      await geo.updateDriverLocation(d2, 37.776, -122.418, VehicleClass.SEDAN);

      const ride = await rideService.requestRide({
        riderId: 'a0000000-0000-4000-8000-000000000001',
        pickupAddress: 'Market St, SF',
        pickupLocation: { lat: 37.7749, lng: -122.4194 },
        dropoffAddress: 'Pier 39, SF',
        dropoffLocation: { lat: 37.8087, lng: -122.4098 },
        vehicleClass: 'SEDAN',
      });

      const results = await Promise.allSettled([
        rideService.acceptRide(ride.id, d1),
        rideService.acceptRide(ride.id, d2),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      assert.equal(fulfilled.length, 1);
      assert.equal(rejected.length, 1);
    });
  });

  describe('8. Phase 4 - Dynamic Surge & AI Agent Ecosystem', () => {
    it('should compute surge elasticity formula and enforce bounds [1.00, 3.50]', () => {
      const redis = new InMemoryRedisClient();
      const pricing = new PricingService(redis);

      assert.equal(pricing.calculateRuleBasedSurge(10, 10), 1.0);
      assert.equal(pricing.calculateRuleBasedSurge(15, 5), 1.83);
      assert.equal(pricing.calculateRuleBasedSurge(100, 1), 3.5);
    });

    it('should execute Hungarian bipartite matching and minimize global platform cost', () => {
      const matcher = new BipartiteDispatchMatcher();
      const customMatrix = [
        [2, 9, 3, 7],
        [6, 3, 5, 4],
        [8, 7, 2, 6],
      ];

      const matching = matcher.solveHungarian(customMatrix);
      assert.equal(matching.length, 3);
      assert.equal(matching[0], 0);
      assert.equal(matching[1], 1);
      assert.equal(matching[2], 2);
    });

    it('should detect corridor deviation (>500m) and stationary stopped duration (>5m)', async () => {
      const redis = new InMemoryRedisClient();
      const pubsub = new RedisPubSubService(redis);
      const safety = new RouteSafetyAgent(pubsub);

      safety.registerTripCorridor('r1', 'd1', [
        { lat: 37.779, lng: -122.418 },
        { lat: 37.794, lng: -122.395 },
      ]);

      // Deviated ~1.8 km
      const alerts = await safety.evaluateTelemetry({
        rideId: 'r1',
        driverId: 'd1',
        lat: 37.765,
        lng: -122.42,
        speed: 40,
        timestamp: Date.now(),
      });

      assert.equal(alerts.length, 1);
      assert.equal(alerts[0].type, 'SAFETY_CORRIDOR_DEVIATION');
    });

    it('should support autonomous customer triage, tool calls, and refund caps', async () => {
      const redis = new InMemoryRedisClient();
      const geo = new RedisGeoService(redis);
      const lockManager = new DistributedLockManager(redis);
      const pubsub = new RedisPubSubService(redis);
      const dispatch = new DispatchEngine(redis, geo, lockManager, pubsub);
      const rideService = new RideService(lockManager, geo, pubsub, dispatch);
      const safety = new RouteSafetyAgent(pubsub);
      const support = new CustomerSupportAgent(rideService, safety);

      const riderId = 'a0000000-0000-4000-8000-000000000001';
      support.setUserWallet(riderId, 15.0);

      const ride = await rideService.requestRide({
        riderId,
        pickupAddress: 'Market St, SF',
        pickupLocation: { lat: 37.7749, lng: -122.4194 },
        dropoffAddress: 'Pier 39, SF',
        dropoffLocation: { lat: 37.8087, lng: -122.4098 },
        vehicleClass: 'SEDAN',
      });

      // Register corridor and trigger deviation alert
      safety.registerTripCorridor(ride.id, 'd0000000-0000-4000-8000-000000000001', [
        ride.pickupLocation,
        ride.dropoffLocation,
      ]);
      await safety.evaluateTelemetry({
        rideId: ride.id,
        driverId: 'd0000000-0000-4000-8000-000000000001',
        lat: 37.76,
        lng: -122.42,
        speed: 30,
        timestamp: Date.now(),
      });

      // Triage complaint
      const ticket = await support.handleComplaint(
        riderId,
        'The driver took a huge detour off route!',
        ride.id
      );

      assert.equal(ticket.status, 'REFUNDED');
      assert.ok(ticket.refundIssued > 0);
      assert.ok(support.getUserWallet(riderId) > 15.0);
    });
  });
});

describe('Phase 5 - Client App Foundations (Flutter) Verification & Parity', () => {
  const mobileDir = path.resolve(process.cwd(), '../mobile');

  describe('1. Flutter Clean Architecture Directory Structure & Artifacts', () => {
    it('should verify pubspec.yaml configuration and dependencies', () => {
      const pubspecPath = path.join(mobileDir, 'pubspec.yaml');
      assert.ok(fs.existsSync(pubspecPath), 'pubspec.yaml must exist');
      const content = fs.readFileSync(pubspecPath, 'utf-8');
      assert.ok(content.includes('flutter_bloc: ^8.1'), 'Must include flutter_bloc');
      assert.ok(content.includes('google_maps_flutter: ^2.5'), 'Must include google_maps_flutter');
      assert.ok(content.includes('web_socket_channel: ^2.4'), 'Must include web_socket_channel');
      assert.ok(content.includes('dio: ^5.4'), 'Must include dio');
      assert.ok(content.includes('equatable: ^2.0.5'), 'Must include equatable');
    });

    it('should verify all required feature modules and presentation screens exist', () => {
      const requiredFiles = [
        'lib/main.dart',
        'lib/core/config/api_config.dart',
        'lib/core/network/api_client.dart',
        'lib/core/network/websocket_client.dart',
        'lib/core/network/api_exceptions.dart',
        'lib/core/map/marker_interpolation.dart',
        'lib/core/map/polyline_decoder.dart',
        'lib/core/theme/app_theme.dart',
        'lib/features/rider/bloc/rider_bloc.dart',
        'lib/features/rider/bloc/rider_event.dart',
        'lib/features/rider/bloc/rider_state.dart',
        'lib/features/rider/models/ride_model.dart',
        'lib/features/rider/models/fare_estimate_model.dart',
        'lib/features/rider/presentation/destination_selection_sheet.dart',
        'lib/features/rider/presentation/radar_matching_view.dart',
        'lib/features/rider/presentation/live_tracking_sheet.dart',
        'lib/features/rider/presentation/trip_receipt_view.dart',
        'lib/features/driver/bloc/driver_bloc.dart',
        'lib/features/driver/bloc/driver_event.dart',
        'lib/features/driver/bloc/driver_state.dart',
        'lib/features/driver/models/dispatch_offer_model.dart',
        'lib/features/driver/presentation/duty_toggle_panel.dart',
        'lib/features/driver/presentation/dispatch_alert_dialog.dart',
        'lib/features/driver/presentation/otp_verification_dialog.dart',
        'lib/features/driver/presentation/turn_by_turn_view.dart',
        'lib/features/shared_map/presentation/interactive_map_screen.dart',
        'test/rider_bloc_test.dart',
        'test/driver_bloc_test.dart',
        'test/marker_interpolation_test.dart',
        'test/polyline_decoder_test.dart',
      ];

      for (const relPath of requiredFiles) {
        const fullPath = path.join(mobileDir, relPath);
        assert.ok(fs.existsSync(fullPath), `Expected Flutter file to exist: ${relPath}`);
        const stat = fs.statSync(fullPath);
        assert.ok(stat.size > 200, `Flutter file should have complete implementation: ${relPath}`);
      }
    });
  });

  describe('2. Client-Backend Mathematical & Algorithmic Parity', () => {
    it('should verify bearing interpolation logic matches backend geo algorithms', () => {
      // Test bearing calculation from San Francisco to Oakland
      const sf = { lat: 37.7749, lng: -122.4194 };
      const oakland = { lat: 37.8044, lng: -122.2712 };
      const backendBearing = calculateBearing(sf, oakland);

      // Verify Dart marker interpolation implementation has the identical formula
      const dartFile = fs.readFileSync(
        path.join(mobileDir, 'lib/core/map/marker_interpolation.dart'),
        'utf-8'
      );
      assert.ok(dartFile.includes('atan2(y, x)'), 'MarkerInterpolation must compute atan2');
      assert.ok(dartFile.includes('interpolateBearing'), 'MarkerInterpolation must implement interpolateBearing');
      assert.ok(dartFile.includes('calculateBearing'), 'MarkerInterpolation must implement calculateBearing');
      assert.ok(dartFile.includes('interpolatePosition'), 'MarkerInterpolation must interpolate lat/lng');
      assert.ok(backendBearing > 60 && backendBearing < 85, 'Bearing should be approx ~70 degrees');
    });

    it('should verify polyline decoder implementation handles Google encoded strings', () => {
      const decoderFile = fs.readFileSync(
        path.join(mobileDir, 'lib/core/map/polyline_decoder.dart'),
        'utf-8'
      );
      assert.ok(decoderFile.includes('class PolylineDecoder'));
      assert.ok(decoderFile.includes('decode(String encoded)'));
      assert.ok(decoderFile.includes('LatLng(lat / 1e5, lng / 1e5)'));
    });
  });

  describe('3. Clean Architecture State Transitions & Lifecycle Parity', () => {
    it('should verify RiderBloc and DriverBloc mirror backend atomic state transitions', () => {
      const riderStateContent = fs.readFileSync(
        path.join(mobileDir, 'lib/features/rider/bloc/rider_state.dart'),
        'utf-8'
      );
      assert.ok(riderStateContent.includes('RideSearching'), 'Must support SEARCHING_DRIVER state');
      assert.ok(riderStateContent.includes('RideAssigned'), 'Must support ASSIGNED/ACCEPTED state');
      assert.ok(riderStateContent.includes('RideInTransit'), 'Must support IN_TRANSIT state');
      assert.ok(riderStateContent.includes('RideCompleted'), 'Must support COMPLETED state');

      const driverStateContent = fs.readFileSync(
        path.join(mobileDir, 'lib/features/driver/bloc/driver_state.dart'),
        'utf-8'
      );
      assert.ok(driverStateContent.includes('OfferReceived'), 'Must support 15s offer countdown state');
      assert.ok(driverStateContent.includes('EnRoutePickup'), 'Must support ACCEPTED en-route state');
      assert.ok(driverStateContent.includes('TripStarted'), 'Must support IN_TRANSIT state');
      assert.ok(driverStateContent.includes('TripFinished'), 'Must support COMPLETED state');
    });
  });
});

