import { z } from 'zod';

export const LookupRideDetailsArgsSchema = z.object({
  rideId: z.string().uuid('Invalid ride UUID'),
});

export const LookupTelemetryAuditArgsSchema = z.object({
  rideId: z.string().uuid('Invalid ride UUID'),
});

export const IssueRefundArgsSchema = z.object({
  rideId: z.string().uuid('Invalid ride UUID'),
  amount: z.number().positive('Refund amount must be positive'),
  reason: z.string().min(5, 'Reason must have at least 5 characters'),
});

export const EscalateToHumanArgsSchema = z.object({
  ticketId: z.string().min(3),
  reason: z.string().min(5),
});

export const SupportTicketSchema = z.object({
  id: z.string(),
  userId: z.string().uuid(),
  rideId: z.string().uuid().optional(),
  complaintText: z.string(),
  status: z.enum(['RESOLVED', 'REFUNDED', 'ESCALATED', 'REJECTED']),
  resolutionNotes: z.string(),
  refundIssued: z.number().default(0),
  auditLog: z.array(z.string()),
  createdAt: z.number(),
});

export type LookupRideDetailsArgs = z.infer<typeof LookupRideDetailsArgsSchema>;
export type LookupTelemetryAuditArgs = z.infer<typeof LookupTelemetryAuditArgsSchema>;
export type IssueRefundArgs = z.infer<typeof IssueRefundArgsSchema>;
export type EscalateToHumanArgs = z.infer<typeof EscalateToHumanArgsSchema>;
export type SupportTicket = z.infer<typeof SupportTicketSchema>;
