import { describe, it, expect } from 'vitest';
import { UserRole, CreateUserSchema, UserSchema } from '../src/modules/users/types.js';
import { VehicleClass, CreateVehicleSchema, VehicleSchema } from '../src/modules/vehicles/types.js';
import {
  RideStatus,
  CoordinateSchema,
  FareBreakdownSchema,
  CreateRideRequestSchema,
  RideSchema,
} from '../src/modules/rides/types.js';
import { TelemetryPacketSchema } from '../src/modules/telemetry/types.js';

describe('Phase 1 Schema Validations', () => {
  describe('User Validation', () => {
    it('should validate a valid rider and driver', () => {
      const validRider = {
        phone: '+14155551234',
        name: 'Sarah Connor',
        role: UserRole.RIDER,
        rating: 4.9,
        walletBalance: 120.5,
      };
      const parsed = CreateUserSchema.parse(validRider);
      expect(parsed.name).toBe('Sarah Connor');
      expect(parsed.role).toBe(UserRole.RIDER);
    });

    it('should reject invalid phone numbers', () => {
      const invalidUser = {
        phone: '123', // too short, no country code
        name: 'John Doe',
      };
      expect(() => CreateUserSchema.parse(invalidUser)).toThrow();
    });

    it('should reject ratings out of [1.0, 5.0] range', () => {
      const invalidRating = {
        phone: '+14155551234',
        name: 'John Doe',
        rating: 5.5,
      };
      expect(() => CreateUserSchema.parse(invalidRating)).toThrow();
    });
  });

  describe('Vehicle Validation', () => {
    it('should validate valid vehicle attributes and uppercase license plate', () => {
      const vehicleDto = {
        driverId: 'd0000000-0000-4000-8000-000000000001',
        make: 'Toyota',
        model: 'Prius Prime',
        year: 2023,
        licensePlate: '  7abc123  ',
        class: VehicleClass.SEDAN,
        color: 'Silver',
      };
      const parsed = CreateVehicleSchema.parse(vehicleDto);
      expect(parsed.licensePlate).toBe('7ABC123');
      expect(parsed.class).toBe(VehicleClass.SEDAN);
    });

    it('should reject invalid driver UUIDs', () => {
      const invalid = {
        driverId: 'not-a-uuid',
        make: 'Honda',
        model: 'Civic',
        year: 2022,
        licensePlate: 'ABC1234',
        color: 'Black',
      };
      expect(() => CreateVehicleSchema.parse(invalid)).toThrow();
    });
  });

  describe('Ride & Coordinate Validation', () => {
    it('should validate standard WGS-84 coordinates', () => {
      const validCoord = { lat: 37.7749, lng: -122.4194 };
      const parsed = CoordinateSchema.parse(validCoord);
      expect(parsed.lat).toBe(37.7749);
      expect(parsed.lng).toBe(-122.4194);
    });

    it('should reject out-of-range coordinates', () => {
      expect(() => CoordinateSchema.parse({ lat: 95.0, lng: 0 })).toThrow();
      expect(() => CoordinateSchema.parse({ lat: 0, lng: 185.0 })).toThrow();
    });

    it('should validate complete fare breakdown calculations', () => {
      const fare = {
        baseFare: 4.0,
        perKmRate: 1.5,
        distanceKm: 10.0,
        distanceFare: 15.0,
        perMinRate: 0.3,
        durationMin: 20.0,
        timeFare: 6.0,
        surgeMultiplier: 1.25,
        totalFare: 31.25,
        currency: 'USD',
      };
      const parsed = FareBreakdownSchema.parse(fare);
      expect(parsed.totalFare).toBe(31.25);
      expect(parsed.surgeMultiplier).toBe(1.25);
    });
  });

  describe('Telemetry Packet Validation', () => {
    it('should validate a high-frequency driver telemetry packet', () => {
      const packet = {
        driverId: 'd0000000-0000-4000-8000-000000000001',
        lat: 37.7749,
        lng: -122.4194,
        bearing: 182.5,
        speed: 45.2,
        timestamp: Date.now(),
      };
      const parsed = TelemetryPacketSchema.parse(packet);
      expect(parsed.bearing).toBe(182.5);
      expect(parsed.speed).toBe(45.2);
    });
  });
});
