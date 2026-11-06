import { describe, it, expect } from 'vitest';
import { SEED_DATA } from '../src/database/seed-data.js';
import { seedDatabase, generateSeedSql, DbQueryRunner } from '../src/database/seed.js';
import { CreateUserSchema } from '../src/modules/users/types.js';
import { CreateVehicleSchema } from '../src/modules/vehicles/types.js';
import { FareBreakdownSchema, CoordinateSchema } from '../src/modules/rides/types.js';

describe('Seed Data Integrity and Execution', () => {
  it('should validate all seed users against CreateUserSchema', () => {
    for (const user of SEED_DATA.users) {
      const parsed = CreateUserSchema.parse(user);
      expect(parsed.name).toBe(user.name);
      expect(parsed.phone).toBe(user.phone);
    }
  });

  it('should validate all seed vehicles and verify driver relationship integrity', () => {
    const driverIds = new Set(
      SEED_DATA.users.filter((u) => u.role === 'DRIVER').map((u) => u.id)
    );

    for (const vehicle of SEED_DATA.vehicles) {
      const parsed = CreateVehicleSchema.parse(vehicle);
      expect(driverIds.has(parsed.driverId)).toBe(true);
      expect(parsed.licensePlate).toBe(vehicle.licensePlate.toUpperCase());
    }
  });

  it('should validate all seed rides and verify rider and driver relations', () => {
    const userIds = new Set(SEED_DATA.users.map((u) => u.id));
    const driverIds = new Set(
      SEED_DATA.users.filter((u) => u.role === 'DRIVER').map((u) => u.id)
    );

    for (const ride of SEED_DATA.rides) {
      expect(userIds.has(ride.riderId)).toBe(true);
      if (ride.driverId) {
        expect(driverIds.has(ride.driverId)).toBe(true);
      }
      expect(ride.otp).toMatch(/^\d{4}$/);

      // Coordinates
      CoordinateSchema.parse(ride.pickupLocation);
      CoordinateSchema.parse(ride.dropoffLocation);

      // Fare Breakdown
      const fare = FareBreakdownSchema.parse(ride.fareBreakdown);
      expect(fare.totalFare).toBeGreaterThan(0);
    }
  });

  it('should generate complete executable SQL seed script', () => {
    const sql = generateSeedSql();
    expect(sql).toContain('BEGIN;');
    expect(sql).toContain('COMMIT;');
    expect(sql).toContain('INSERT INTO users');
    expect(sql).toContain('INSERT INTO vehicles');
    expect(sql).toContain('INSERT INTO rides');
    expect(sql).toContain('INSERT INTO driver_telemetry');
    expect(sql).toContain('ST_SetSRID(ST_MakePoint');
  });

  it('should execute seedDatabase against a query runner without errors', async () => {
    const executedQueries: Array<{ sql: string; params?: unknown[] }> = [];

    const mockClient: DbQueryRunner = {
      async query(sql: string, params?: unknown[]) {
        executedQueries.push({ sql, params });
        return { rowCount: 1, rows: [] };
      },
    };

    const result = await seedDatabase(mockClient);

    expect(result.usersInserted).toBe(SEED_DATA.users.length);
    expect(result.vehiclesInserted).toBe(SEED_DATA.vehicles.length);
    expect(result.ridesInserted).toBe(SEED_DATA.rides.length);
    expect(result.telemetryInserted).toBe(SEED_DATA.telemetry.length);
    expect(executedQueries.length).toBeGreaterThanOrEqual(
      result.usersInserted + result.vehiclesInserted + result.ridesInserted + result.telemetryInserted
    );
  });
});
