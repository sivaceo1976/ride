import { z } from 'zod';
import { VehicleClassSchema } from '../modules/vehicles/types.js';

// Driver Incoming WebSocket Messages
export const DriverTelemetryMessageSchema = z.object({
  type: z.literal('TELEMETRY'),
  driverId: z.string().uuid('Invalid driverId UUID'),
  lat: z.number().min(-90.0).max(90.0),
  lng: z.number().min(-180.0).max(180.0),
  bearing: z.number().min(0.0).max(360.0).default(0.0),
  speed: z.number().min(0.0).default(0.0),
  timestamp: z.number().int().positive(),
  rideId: z.string().uuid().optional(),
});

export const DriverDutyMessageSchema = z.object({
  type: z.literal('DUTY_STATUS'),
  driverId: z.string().uuid(),
  status: z.enum(['ONLINE', 'OFFLINE']),
  vehicleClass: VehicleClassSchema.default(VehicleClassSchema.enum.SEDAN),
});

export const DriverPingMessageSchema = z.object({
  type: z.literal('PING'),
});

export const DriverWsMessageSchema = z.discriminatedUnion('type', [
  DriverTelemetryMessageSchema,
  DriverDutyMessageSchema,
  DriverPingMessageSchema,
]);

// Rider Incoming WebSocket Messages
export const RiderSubscribeNearbySchema = z.object({
  type: z.literal('SUBSCRIBE_NEARBY'),
  lat: z.number().min(-90.0).max(90.0),
  lng: z.number().min(-180.0).max(180.0),
  radiusKm: z.number().min(0.1).max(50.0).default(5.0),
  vehicleClass: VehicleClassSchema.optional(),
});

export const RiderTrackTripSchema = z.object({
  type: z.literal('TRACK_TRIP'),
  rideId: z.string().uuid(),
  driverId: z.string().uuid().optional(),
});

export const RiderUntrackTripSchema = z.object({
  type: z.literal('UNTRACK_TRIP'),
  rideId: z.string().uuid(),
});

export const RiderUnsubscribeNearbySchema = z.object({
  type: z.literal('UNSUBSCRIBE_NEARBY'),
});

export const RiderPingMessageSchema = z.object({
  type: z.literal('PING'),
});

export const RiderWsMessageSchema = z.discriminatedUnion('type', [
  RiderSubscribeNearbySchema,
  RiderTrackTripSchema,
  RiderUntrackTripSchema,
  RiderUnsubscribeNearbySchema,
  RiderPingMessageSchema,
]);

export type DriverWsMessage = z.infer<typeof DriverWsMessageSchema>;
export type RiderWsMessage = z.infer<typeof RiderWsMessageSchema>;
