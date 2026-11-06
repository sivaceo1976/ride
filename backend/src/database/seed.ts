import { SEED_DATA } from './seed-data.js';
import { PostGisHelper } from './postgis.js';
import { getWeekPartitionInfo, generatePartitionDdl } from './partitions.js';

export interface DbQueryRunner {
  query(sql: string, params?: unknown[]): Promise<unknown>;
}

/**
 * Seeds PostgreSQL + PostGIS database with seed data.
 */
export async function seedDatabase(client: DbQueryRunner): Promise<{
  usersInserted: number;
  vehiclesInserted: number;
  ridesInserted: number;
  telemetryInserted: number;
}> {
  // 1. Insert Users
  let usersInserted = 0;
  for (const user of SEED_DATA.users) {
    await client.query(
      `
      INSERT INTO users (id, phone, name, role, rating, wallet_balance, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (id) DO UPDATE SET
        phone = EXCLUDED.phone,
        name = EXCLUDED.name,
        role = EXCLUDED.role,
        rating = EXCLUDED.rating,
        wallet_balance = EXCLUDED.wallet_balance,
        is_active = EXCLUDED.is_active;
      `,
      [user.id, user.phone, user.name, user.role, user.rating, user.walletBalance, user.isActive]
    );
    usersInserted++;
  }

  // 2. Insert Vehicles
  let vehiclesInserted = 0;
  for (const vehicle of SEED_DATA.vehicles) {
    await client.query(
      `
      INSERT INTO vehicles (id, driver_id, make, model, year, license_plate, class, color, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (id) DO UPDATE SET
        driver_id = EXCLUDED.driver_id,
        make = EXCLUDED.make,
        model = EXCLUDED.model,
        year = EXCLUDED.year,
        license_plate = EXCLUDED.license_plate,
        class = EXCLUDED.class,
        color = EXCLUDED.color,
        is_active = EXCLUDED.is_active;
      `,
      [
        vehicle.id,
        vehicle.driverId,
        vehicle.make,
        vehicle.model,
        vehicle.year,
        vehicle.licensePlate,
        vehicle.class,
        vehicle.color,
        vehicle.isActive,
      ]
    );
    vehiclesInserted++;
  }

  // 3. Insert Rides (with PostGIS Geometry Points)
  let ridesInserted = 0;
  for (const ride of SEED_DATA.rides) {
    await client.query(
      `
      INSERT INTO rides (
        id, rider_id, driver_id, status, pickup_address, pickup_geom,
        dropoff_address, dropoff_geom, fare_breakdown, otp, surge_multiplier,
        estimated_distance_km, estimated_duration_min, cancellation_reason,
        created_at, accepted_at, arrived_at, started_at, completed_at
      )
      VALUES (
        $1, $2, $3, $4, $5,
        ST_SetSRID(ST_MakePoint($6, $7), 4326),
        $8,
        ST_SetSRID(ST_MakePoint($9, $10), 4326),
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21
      )
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        driver_id = EXCLUDED.driver_id,
        fare_breakdown = EXCLUDED.fare_breakdown,
        updated_at = NOW();
      `,
      [
        ride.id,
        ride.riderId,
        ride.driverId,
        ride.status,
        ride.pickupAddress,
        ride.pickupLocation.lng, // X coordinate
        ride.pickupLocation.lat, // Y coordinate
        ride.dropoffAddress,
        ride.dropoffLocation.lng, // X coordinate
        ride.dropoffLocation.lat, // Y coordinate
        JSON.stringify(ride.fareBreakdown),
        ride.otp,
        ride.surgeMultiplier,
        ride.estimatedDistanceKm,
        ride.estimatedDurationMin,
        ride.cancellationReason || null,
        ride.createdAt,
        ride.acceptedAt || null,
        ride.arrivedAt || null,
        ride.startedAt || null,
        ride.completedAt || null,
      ]
    );
    ridesInserted++;
  }

  // 4. Ensure partitions exist and insert Telemetry records
  let telemetryInserted = 0;
  for (const t of SEED_DATA.telemetry) {
    const partInfo = getWeekPartitionInfo(t.recordedAt);
    const ddl = generatePartitionDdl(partInfo);
    await client.query(ddl);

    await client.query(
      `
      INSERT INTO driver_telemetry (driver_id, location, bearing, speed, h3_index, recorded_at)
      VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326), $4, $5, $6, $7);
      `,
      [t.driverId, t.lng, t.lat, t.bearing, t.speed, t.h3Index, t.recordedAt]
    );
    telemetryInserted++;
  }

  return {
    usersInserted,
    vehiclesInserted,
    ridesInserted,
    telemetryInserted,
  };
}

/**
 * Generates plain SQL migration seed script for direct psql or docker entrypoint execution.
 */
export function generateSeedSql(): string {
  const statements: string[] = ['-- Auto-generated PostGIS Seed Script', 'BEGIN;'];

  // Users
  for (const u of SEED_DATA.users) {
    statements.push(`
INSERT INTO users (id, phone, name, role, rating, wallet_balance, is_active)
VALUES ('${u.id}', '${u.phone}', '${u.name.replace("'", "''")}', '${u.role}', ${u.rating}, ${u.walletBalance}, ${u.isActive})
ON CONFLICT (id) DO NOTHING;`);
  }

  // Vehicles
  for (const v of SEED_DATA.vehicles) {
    statements.push(`
INSERT INTO vehicles (id, driver_id, make, model, year, license_plate, class, color, is_active)
VALUES ('${v.id}', '${v.driverId}', '${v.make}', '${v.model}', ${v.year}, '${v.licensePlate}', '${v.class}', '${v.color}', ${v.isActive})
ON CONFLICT (id) DO NOTHING;`);
  }

  // Rides
  for (const r of SEED_DATA.rides) {
    const driverVal = r.driverId ? `'${r.driverId}'` : 'NULL';
    const cancelVal = r.cancellationReason ? `'${r.cancellationReason.replace("'", "''")}'` : 'NULL';
    const acceptedVal = r.acceptedAt ? `'${r.acceptedAt.toISOString()}'` : 'NULL';
    const arrivedVal = r.arrivedAt ? `'${r.arrivedAt.toISOString()}'` : 'NULL';
    const startedVal = r.startedAt ? `'${r.startedAt.toISOString()}'` : 'NULL';
    const completedVal = r.completedAt ? `'${r.completedAt.toISOString()}'` : 'NULL';

    statements.push(`
INSERT INTO rides (
  id, rider_id, driver_id, status, pickup_address, pickup_geom,
  dropoff_address, dropoff_geom, fare_breakdown, otp, surge_multiplier,
  estimated_distance_km, estimated_duration_min, cancellation_reason,
  created_at, accepted_at, arrived_at, started_at, completed_at
)
VALUES (
  '${r.id}', '${r.riderId}', ${driverVal}, '${r.status}', '${r.pickupAddress.replace("'", "''")}',
  ST_SetSRID(ST_MakePoint(${r.pickupLocation.lng}, ${r.pickupLocation.lat}), 4326),
  '${r.dropoffAddress.replace("'", "''")}',
  ST_SetSRID(ST_MakePoint(${r.dropoffLocation.lng}, ${r.dropoffLocation.lat}), 4326),
  '${JSON.stringify(r.fareBreakdown)}'::jsonb, '${r.otp}', ${r.surgeMultiplier},
  ${r.estimatedDistanceKm}, ${r.estimatedDurationMin}, ${cancelVal},
  '${r.createdAt.toISOString()}', ${acceptedVal}, ${arrivedVal}, ${startedVal}, ${completedVal}
)
ON CONFLICT (id) DO NOTHING;`);
  }

  // Telemetry
  for (const t of SEED_DATA.telemetry) {
    const partInfo = getWeekPartitionInfo(t.recordedAt);
    statements.push(generatePartitionDdl(partInfo));
    statements.push(`
INSERT INTO driver_telemetry (driver_id, location, bearing, speed, h3_index, recorded_at)
VALUES (
  '${t.driverId}',
  ST_SetSRID(ST_MakePoint(${t.lng}, ${t.lat}), 4326),
  ${t.bearing}, ${t.speed}, '${t.h3Index}', '${t.recordedAt.toISOString()}'
);`);
  }

  statements.push('COMMIT;');
  return statements.join('\n');
}
