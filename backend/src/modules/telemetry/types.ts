import { z } from 'zod';

export const TelemetryPacketSchema = z.object({
  driverId: z.string().uuid('Invalid driver UUID'),
  lat: z.number().min(-90.0).max(90.0, 'Latitude must be between -90 and 90'),
  lng: z.number().min(-180.0).max(180.0, 'Longitude must be between -180 and 180'),
  bearing: z.number().min(0.0).max(360.0).default(0.0),
  speed: z.number().min(0.0).default(0.0), // in km/h or m/s
  timestamp: z.number().int().positive('Timestamp must be positive milliseconds epoch'),
});

export const DriverTelemetryRecordSchema = z.object({
  id: z.string().or(z.bigint()),
  driverId: z.string().uuid(),
  lat: z.number().min(-90.0).max(90.0),
  lng: z.number().min(-180.0).max(180.0),
  bearing: z.number().min(0.0).max(360.0),
  speed: z.number().min(0.0),
  h3Index: z.string().regex(/^[0-9a-f]{15}$/i, 'Invalid 15-character H3 cell index'),
  recordedAt: z.date(),
});

export const DriverStatusSchema = z.enum(['AVAILABLE', 'BUSY', 'OFFLINE']);

export const DriverStateSchema = z.object({
  driverId: z.string().uuid(),
  status: DriverStatusSchema,
  lat: z.number(),
  lng: z.number(),
  bearing: z.number(),
  speed: z.number(),
  vehicleClass: z.enum(['BIKE', 'SEDAN', 'SUV']).default('SEDAN'),
  lastHeartbeat: z.number(),
});

export type TelemetryPacket = z.infer<typeof TelemetryPacketSchema>;
export type DriverTelemetryRecord = z.infer<typeof DriverTelemetryRecordSchema>;
export type DriverStatus = z.infer<typeof DriverStatusSchema>;
export type DriverState = z.infer<typeof DriverStateSchema>;
