-- ====================================================================
-- Migration: 20261106000000_init_postgis
-- Description: Core schema with PostGIS spatial types & weekly partitioning
-- ====================================================================

-- 1. Enable required PostgreSQL extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";

-- 2. Create Enums
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('RIDER', 'DRIVER', 'ADMIN');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE vehicle_class AS ENUM ('BIKE', 'SEDAN', 'SUV');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE ride_status AS ENUM (
        'REQUESTED',
        'SEARCHING_DRIVER',
        'ASSIGNED',
        'ACCEPTED',
        'ARRIVED_AT_PICKUP',
        'IN_TRANSIT',
        'COMPLETED',
        'CANCELLED'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 3. Users Table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone VARCHAR(20) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    role user_role NOT NULL DEFAULT 'RIDER',
    rating NUMERIC(3, 2) NOT NULL DEFAULT 5.00 CHECK (rating >= 1.00 AND rating <= 5.00),
    wallet_balance NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- 4. Vehicles Table
CREATE TABLE IF NOT EXISTS vehicles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    make VARCHAR(50) NOT NULL,
    model VARCHAR(50) NOT NULL,
    year INT NOT NULL DEFAULT 2023,
    license_plate VARCHAR(20) NOT NULL UNIQUE,
    class vehicle_class NOT NULL DEFAULT 'SEDAN',
    color VARCHAR(30) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vehicles_driver_id ON vehicles(driver_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_class ON vehicles(class);

-- 5. Rides Table
CREATE TABLE IF NOT EXISTS rides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rider_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    driver_id UUID REFERENCES users(id) ON DELETE SET NULL,
    status ride_status NOT NULL DEFAULT 'REQUESTED',
    pickup_address TEXT NOT NULL,
    pickup_geom geometry(Point, 4326) NOT NULL,
    dropoff_address TEXT NOT NULL,
    dropoff_geom geometry(Point, 4326) NOT NULL,
    fare_breakdown JSONB NOT NULL,
    otp VARCHAR(4) NOT NULL,
    surge_multiplier NUMERIC(3, 2) NOT NULL DEFAULT 1.00 CHECK (surge_multiplier >= 1.00 AND surge_multiplier <= 5.00),
    estimated_distance_km NUMERIC(6, 2) NOT NULL CHECK (estimated_distance_km >= 0),
    estimated_duration_min NUMERIC(6, 2) NOT NULL CHECK (estimated_duration_min >= 0),
    cancellation_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    accepted_at TIMESTAMPTZ,
    arrived_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);

-- Spatial and relational indexes for Rides
CREATE INDEX IF NOT EXISTS idx_rides_rider_id ON rides(rider_id);
CREATE INDEX IF NOT EXISTS idx_rides_driver_id ON rides(driver_id);
CREATE INDEX IF NOT EXISTS idx_rides_status ON rides(status);
CREATE INDEX IF NOT EXISTS idx_rides_created_at ON rides(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rides_pickup_geom ON rides USING GIST (pickup_geom);
CREATE INDEX IF NOT EXISTS idx_rides_dropoff_geom ON rides USING GIST (dropoff_geom);

-- 6. Driver Telemetry Table (Partitioned by Week on recorded_at)
CREATE TABLE IF NOT EXISTS driver_telemetry (
    id BIGSERIAL NOT NULL,
    driver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    location geometry(Point, 4326) NOT NULL,
    bearing NUMERIC(5, 2) NOT NULL DEFAULT 0.00 CHECK (bearing >= 0 AND bearing <= 360),
    speed NUMERIC(5, 2) NOT NULL DEFAULT 0.00 CHECK (speed >= 0),
    h3_index VARCHAR(15) NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_driver_telemetry PRIMARY KEY (recorded_at, id)
) PARTITION BY RANGE (recorded_at);

-- Spatial and audit indexes on telemetry
CREATE INDEX IF NOT EXISTS idx_telemetry_driver_recorded ON driver_telemetry(driver_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_location ON driver_telemetry USING GIST (location);
CREATE INDEX IF NOT EXISTS idx_telemetry_h3 ON driver_telemetry(h3_index);

-- 7. Pre-seed weekly partitions for 2026 (Weeks 44-52 + Default Partition)
CREATE TABLE IF NOT EXISTS driver_telemetry_default PARTITION OF driver_telemetry DEFAULT;

CREATE TABLE IF NOT EXISTS driver_telemetry_2026_w44 PARTITION OF driver_telemetry
    FOR VALUES FROM ('2026-10-26 00:00:00+00') TO ('2026-11-02 00:00:00+00');

CREATE TABLE IF NOT EXISTS driver_telemetry_2026_w45 PARTITION OF driver_telemetry
    FOR VALUES FROM ('2026-11-02 00:00:00+00') TO ('2026-11-09 00:00:00+00');

CREATE TABLE IF NOT EXISTS driver_telemetry_2026_w46 PARTITION OF driver_telemetry
    FOR VALUES FROM ('2026-11-09 00:00:00+00') TO ('2026-11-16 00:00:00+00');

CREATE TABLE IF NOT EXISTS driver_telemetry_2026_w47 PARTITION OF driver_telemetry
    FOR VALUES FROM ('2026-11-16 00:00:00+00') TO ('2026-11-23 00:00:00+00');

CREATE TABLE IF NOT EXISTS driver_telemetry_2026_w48 PARTITION OF driver_telemetry
    FOR VALUES FROM ('2026-11-23 00:00:00+00') TO ('2026-11-30 00:00:00+00');

-- 8. Stored Procedure for dynamic weekly partition creation
CREATE OR REPLACE FUNCTION create_weekly_telemetry_partition(target_date TIMESTAMPTZ)
RETURNS TEXT AS $$
DECLARE
    start_of_week TIMESTAMPTZ;
    end_of_week TIMESTAMPTZ;
    partition_name TEXT;
    sql_query TEXT;
BEGIN
    start_of_week := date_trunc('week', target_date);
    end_of_week := start_of_week + INTERVAL '7 days';
    partition_name := 'driver_telemetry_' || to_char(start_of_week, 'YYYY_') || 'w' || to_char(start_of_week, 'IW');

    IF NOT EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = partition_name
    ) THEN
        sql_query := format(
            'CREATE TABLE IF NOT EXISTS %I PARTITION OF driver_telemetry FOR VALUES FROM (%L) TO (%L);',
            partition_name, start_of_week, end_of_week
        );
        EXECUTE sql_query;
        RETURN 'Created partition: ' || partition_name;
    ELSE
        RETURN 'Partition already exists: ' || partition_name;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- 9. Trigger for automatic updated_at timestamp update
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

DROP TRIGGER IF EXISTS trg_vehicles_updated_at ON vehicles;
CREATE TRIGGER trg_vehicles_updated_at BEFORE UPDATE ON vehicles FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

DROP TRIGGER IF EXISTS trg_rides_updated_at ON rides;
CREATE TRIGGER trg_rides_updated_at BEFORE UPDATE ON rides FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
