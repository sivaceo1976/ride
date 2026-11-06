import { z } from 'zod';

export enum UserRole {
  RIDER = 'RIDER',
  DRIVER = 'DRIVER',
  ADMIN = 'ADMIN',
}

export const UserRoleSchema = z.nativeEnum(UserRole);

export const CreateUserSchema = z.object({
  phone: z
    .string()
    .min(10, 'Phone number must be at least 10 characters')
    .max(20, 'Phone number must not exceed 20 characters')
    .regex(/^\+?[1-9]\d{7,14}$/, 'Invalid E.164 phone number format'),
  name: z.string().min(2, 'Name must have at least 2 characters').max(100),
  role: UserRoleSchema.default(UserRole.RIDER),
  rating: z.number().min(1.0).max(5.0).default(5.0),
  walletBalance: z.number().min(0.0).default(0.0),
});

export const UserSchema = CreateUserSchema.extend({
  id: z.string().uuid(),
  isActive: z.boolean().default(true),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const UpdateUserSchema = CreateUserSchema.partial();

export type UserRoleType = z.infer<typeof UserRoleSchema>;
export type CreateUserDto = z.infer<typeof CreateUserSchema>;
export type User = z.infer<typeof UserSchema>;
export type UpdateUserDto = z.infer<typeof UpdateUserSchema>;
