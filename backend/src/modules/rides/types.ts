import { z } from 'zod';

export enum RideStatus {
  REQUESTED = 'REQUESTED',
  SEARCHING_DRIVER = 'SEARCHING_DRIVER',
  ASSIGNED = 'ASSIGNED',
  ACCEPTED = 'ACCEPTED',
  ARRIVED_AT_PICKUP = 'ARRIVED_AT_PICKUP',
  IN_TRANSIT = 'IN_TRANSIT',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export const RideStatusSchema = z.nativeEnum(RideStatus);

export const CoordinateSchema = z.object({
  lat: z.number().min(-90.0).max(90.0, 'Latitude must be between -90 and 90'),
  lng: z.number().min(-180.0).max(180.0, 'Longitude must be between -180 and 180'),
});

export const GeoPointSchema = z.object({
  type: z.literal('Point'),
  coordinates: z.tuple([
    z.number().min(-180.0).max(180.0), // longitude first in GeoJSON standard
    z.number().min(-90.0).max(90.0),   // latitude second
  ]),
});

export const FareBreakdownSchema = z.object({
  baseFare: z.number().min(0),
  perKmRate: z.number().min(0),
  distanceKm: z.number().min(0),
  distanceFare: z.number().min(0),
  perMinRate: z.number().min(0),
  durationMin: z.number().min(0),
  timeFare: z.number().min(0),
  surgeMultiplier: z.number().min(1.0).max(5.0).default(1.0),
  totalFare: z.number().min(0),
  currency: z.string().length(3).default('USD'),
});

export const CreateRideRequestSchema = z.object({
  riderId: z.string().uuid('Invalid rider UUID'),
  pickupAddress: z.string().min(3).max(500),
  pickupLocation: CoordinateSchema,
  dropoffAddress: z.string().min(3).max(500),
  dropoffLocation: CoordinateSchema,
  vehicleClass: z.enum(['BIKE', 'SEDAN', 'SUV']).default('SEDAN'),
});

export const RideSchema = z.object({
  id: z.string().uuid(),
  riderId: z.string().uuid(),
  driverId: z.string().uuid().nullable().optional(),
  status: RideStatusSchema.default(RideStatus.REQUESTED),
  pickupAddress: z.string(),
  pickupLocation: CoordinateSchema,
  dropoffAddress: z.string(),
  dropoffLocation: CoordinateSchema,
  fareBreakdown: FareBreakdownSchema,
  otp: z.string().regex(/^\d{4}$/, 'OTP must be exactly 4 numeric digits'),
  surgeMultiplier: z.number().min(1.0).max(5.0).default(1.0),
  estimatedDistanceKm: z.number().min(0),
  estimatedDurationMin: z.number().min(0),
  cancellationReason: z.string().nullable().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
  acceptedAt: z.date().nullable().optional(),
  arrivedAt: z.date().nullable().optional(),
  startedAt: z.date().nullable().optional(),
  completedAt: z.date().nullable().optional(),
});

// Allowed deterministic state transitions
export const ALLOWED_STATE_TRANSITIONS: Record<RideStatus, RideStatus[]> = {
  [RideStatus.REQUESTED]: [RideStatus.SEARCHING_DRIVER, RideStatus.CANCELLED],
  [RideStatus.SEARCHING_DRIVER]: [RideStatus.ASSIGNED, RideStatus.CANCELLED],
  [RideStatus.ASSIGNED]: [RideStatus.ACCEPTED, RideStatus.SEARCHING_DRIVER, RideStatus.CANCELLED],
  [RideStatus.ACCEPTED]: [RideStatus.ARRIVED_AT_PICKUP, RideStatus.CANCELLED],
  [RideStatus.ARRIVED_AT_PICKUP]: [RideStatus.IN_TRANSIT, RideStatus.CANCELLED],
  [RideStatus.IN_TRANSIT]: [RideStatus.COMPLETED, RideStatus.CANCELLED],
  [RideStatus.COMPLETED]: [],
  [RideStatus.CANCELLED]: [],
};

export function canTransitionRide(from: RideStatus, to: RideStatus): boolean {
  const allowed = ALLOWED_STATE_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

export type Coordinate = z.infer<typeof CoordinateSchema>;
export type GeoPoint = z.infer<typeof GeoPointSchema>;
export type FareBreakdown = z.infer<typeof FareBreakdownSchema>;
export type CreateRideRequestDto = z.infer<typeof CreateRideRequestSchema>;
export type Ride = z.infer<typeof RideSchema>;
