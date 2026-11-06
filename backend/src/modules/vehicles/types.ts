import { z } from 'zod';

export enum VehicleClass {
  BIKE = 'BIKE',
  SEDAN = 'SEDAN',
  SUV = 'SUV',
}

export const VehicleClassSchema = z.nativeEnum(VehicleClass);

export const CreateVehicleSchema = z.object({
  driverId: z.string().uuid('Invalid driver UUID format'),
  make: z.string().min(1, 'Vehicle make is required').max(50),
  model: z.string().min(1, 'Vehicle model is required').max(50),
  year: z.number().int().min(2000).max(new Date().getFullYear() + 1),
  licensePlate: z
    .string()
    .min(3, 'License plate must be at least 3 characters')
    .max(20, 'License plate cannot exceed 20 characters')
    .transform((val) => val.trim().toUpperCase()),
  class: VehicleClassSchema.default(VehicleClass.SEDAN),
  color: z.string().min(2).max(30),
});

export const VehicleSchema = CreateVehicleSchema.extend({
  id: z.string().uuid(),
  isActive: z.boolean().default(true),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const UpdateVehicleSchema = CreateVehicleSchema.partial();

export type VehicleClassType = z.infer<typeof VehicleClassSchema>;
export type CreateVehicleDto = z.infer<typeof CreateVehicleSchema>;
export type Vehicle = z.infer<typeof VehicleSchema>;
export type UpdateVehicleDto = z.infer<typeof UpdateVehicleSchema>;
