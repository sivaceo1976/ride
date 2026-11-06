import { RideService } from '../../modules/rides/ride.service.js';
import { RouteSafetyAgent } from '../safety/safety.agent.js';
import {
  LookupRideDetailsArgsSchema,
  LookupTelemetryAuditArgsSchema,
  IssueRefundArgsSchema,
  EscalateToHumanArgsSchema,
  SupportTicket,
} from './support.types.js';

export const MAX_AUTOMATED_REFUND_CEILING = 50.0;

export interface ToolCallExecution {
  toolName: string;
  args: any;
  result: any;
}

export class CustomerSupportAgent {
  private userWallets = new Map<string, number>();
  private escalationTickets: Array<{ ticketId: string; reason: string; timestamp: number }> = [];
  private refundAuditLogs: Array<{ rideId: string; amount: number; reason: string; timestamp: number }> = [];

  constructor(
    private rideService: RideService,
    private safetyAgent: RouteSafetyAgent
  ) {}

  setUserWallet(userId: string, balance: number): void {
    this.userWallets.set(userId, balance);
  }

  getUserWallet(userId: string): number {
    return this.userWallets.get(userId) || 0;
  }

  getEscalations(): Array<{ ticketId: string; reason: string; timestamp: number }> {
    return this.escalationTickets;
  }

  getRefundAuditLogs(): Array<{ rideId: string; amount: number; reason: string; timestamp: number }> {
    return this.refundAuditLogs;
  }

  /**
   * Tool 1: lookupRideDetails
   */
  async toolLookupRideDetails(args: unknown): Promise<any> {
    const parsed = LookupRideDetailsArgsSchema.parse(args);
    const ride = await this.rideService.getRideById(parsed.rideId);
    if (!ride) {
      return { error: 'Ride not found' };
    }

    return {
      rideId: ride.id,
      riderId: ride.riderId,
      driverId: ride.driverId,
      status: ride.status,
      fare: ride.fareBreakdown,
      pickup: ride.pickupAddress,
      dropoff: ride.dropoffAddress,
      timestamps: {
        created: ride.createdAt,
        accepted: ride.acceptedAt,
        arrived: ride.arrivedAt,
        started: ride.startedAt,
        completed: ride.completedAt,
      },
    };
  }

  /**
   * Tool 2: lookupTelemetryAudit
   */
  async toolLookupTelemetryAudit(args: unknown): Promise<any> {
    const parsed = LookupTelemetryAuditArgsSchema.parse(args);
    const alerts = this.safetyAgent.getAlertsForRide(parsed.rideId);

    return {
      rideId: parsed.rideId,
      totalSafetyAlerts: alerts.length,
      alerts: alerts.map((a) => ({
        type: a.type,
        severity: a.severity,
        details: a.details,
        timestamp: a.timestamp,
      })),
    };
  }

  /**
   * Tool 3: issueRefund
   * Enforces policy bounds:
   * 1. Refund <= trip total fare
   * 2. Refund <= MAX_AUTOMATED_REFUND_CEILING ($50.00)
   * 3. Records immutable audit record
   */
  async toolIssueRefund(args: unknown): Promise<any> {
    const parsed = IssueRefundArgsSchema.parse(args);
    const ride = await this.rideService.getRideById(parsed.rideId);
    if (!ride) {
      return { success: false, error: 'Cannot refund non-existent ride' };
    }

    const maxFare = ride.fareBreakdown.totalFare;

    // Guardrail 1: Cannot refund more than the ride's total fare
    if (parsed.amount > maxFare) {
      return {
        success: false,
        error: `Requested refund of $${parsed.amount} exceeds trip fare of $${maxFare}`,
      };
    }

    // Guardrail 2: Cannot exceed automated agent ceiling ($50.00)
    if (parsed.amount > MAX_AUTOMATED_REFUND_CEILING) {
      return {
        success: false,
        error: `Requested refund of $${parsed.amount} exceeds automated support ceiling ($${MAX_AUTOMATED_REFUND_CEILING}). Must escalate to human.`,
      };
    }

    // Update rider's wallet balance
    const currentBalance = this.getUserWallet(ride.riderId);
    const newBalance = Math.round((currentBalance + parsed.amount) * 100) / 100;
    this.setUserWallet(ride.riderId, newBalance);

    // Record immutable audit entry
    this.refundAuditLogs.push({
      rideId: parsed.rideId,
      amount: parsed.amount,
      reason: parsed.reason,
      timestamp: Date.now(),
    });

    return {
      success: true,
      refundedAmount: parsed.amount,
      riderId: ride.riderId,
      newWalletBalance: newBalance,
      reason: parsed.reason,
    };
  }

  /**
   * Tool 4: escalateToHuman
   */
  async toolEscalateToHuman(args: unknown): Promise<any> {
    const parsed = EscalateToHumanArgsSchema.parse(args);
    this.escalationTickets.push({
      ticketId: parsed.ticketId,
      reason: parsed.reason,
      timestamp: Date.now(),
    });

    return {
      success: true,
      ticketId: parsed.ticketId,
      message: 'Escalated to Tier-2 Human Support Specialist with high priority',
    };
  }

  /**
   * Autonomous Triage Loop:
   * Consumes user complaint, checks prompt injection guardrails, invokes tools, and provides resolution.
   */
  async handleComplaint(
    userId: string,
    complaintText: string,
    rideId?: string
  ): Promise<SupportTicket> {
    const ticketId = `ticket-${crypto.randomUUID().slice(0, 8)}`;
    const auditLog: string[] = [`Complaint received from user ${userId}: "${complaintText}"`];

    // Guardrail: Detect basic prompt injection attacks
    const injectionPatterns = [
      /ignore (all|previous|prior) instructions/i,
      /you are now an admin/i,
      /refund \$\s*[0-9]{3,}/i, // Unreasonable refund demands ($100+)
      /override (policy|security|guardrail)/i,
    ];

    for (const pattern of injectionPatterns) {
      if (pattern.test(complaintText)) {
        auditLog.push(`SECURITY ALERT: Prompt injection attempt detected matching ${pattern}`);
        await this.toolEscalateToHuman({
          ticketId,
          reason: `Security flag: Potential prompt injection attempt from user ${userId}`,
        });

        return {
          id: ticketId,
          userId,
          rideId,
          complaintText,
          status: 'ESCALATED',
          resolutionNotes: 'Security policy flag: Your inquiry has been routed to human management for manual review.',
          refundIssued: 0,
          auditLog,
          createdAt: Date.now(),
        };
      }
    }

    if (!rideId) {
      return {
        id: ticketId,
        userId,
        complaintText,
        status: 'RESOLVED',
        resolutionNotes: 'Please specify the trip ID associated with your concern so we can look up telemetry.',
        refundIssued: 0,
        auditLog,
        createdAt: Date.now(),
      };
    }

    // Step 1: Tool Call -> lookupRideDetails
    auditLog.push(`Calling tool lookupRideDetails for ride ${rideId}`);
    const rideDetails = await this.toolLookupRideDetails({ rideId });

    if (rideDetails.error) {
      return {
        id: ticketId,
        userId,
        rideId,
        complaintText,
        status: 'REJECTED',
        resolutionNotes: 'No trip found matching the provided identifier.',
        refundIssued: 0,
        auditLog,
        createdAt: Date.now(),
      };
    }

    // Step 2: Tool Call -> lookupTelemetryAudit
    auditLog.push(`Calling tool lookupTelemetryAudit for ride ${rideId}`);
    const telemetryAudit = await this.toolLookupTelemetryAudit({ rideId });

    // Step 3: Automated Evaluation based on findings
    const hasCorridorDeviation = telemetryAudit.alerts?.some(
      (a: any) => a.type === 'SAFETY_CORRIDOR_DEVIATION'
    );
    const hasUnscheduledStop = telemetryAudit.alerts?.some(
      (a: any) => a.type === 'SAFETY_UNSCHEDULED_STOP'
    );

    // Complaint involves safety / detour / driver went off route
    const complaintLower = complaintText.toLowerCase();
    const isDetourComplaint =
      complaintLower.includes('detour') ||
      complaintLower.includes('route') ||
      complaintLower.includes('deviation') ||
      complaintLower.includes('wrong way');

    if (isDetourComplaint && hasCorridorDeviation) {
      // Valid detour with verified corridor deviation -> Issue automatic 50% fare refund
      const refundAmount = Math.min(
        Math.round((rideDetails.fare.totalFare * 0.5) * 100) / 100,
        MAX_AUTOMATED_REFUND_CEILING
      );

      auditLog.push(`Verified safety corridor deviation. Issuing refund of $${refundAmount}`);
      const refundResult = await this.toolIssueRefund({
        rideId,
        amount: refundAmount,
        reason: 'Verified significant route corridor deviation',
      });

      if (refundResult.success) {
        return {
          id: ticketId,
          userId,
          rideId,
          complaintText,
          status: 'REFUNDED',
          resolutionNotes: `We confirmed your vehicle deviated from the route corridor. A refund of $${refundAmount} has been credited to your wallet.`,
          refundIssued: refundAmount,
          auditLog,
          createdAt: Date.now(),
        };
      }
    }

    // Severe safety complaints (unscheduled long stops)
    if (hasUnscheduledStop || complaintLower.includes('danger') || complaintLower.includes('threat')) {
      auditLog.push(`Critical safety issue flagged. Escalating to human supervisor.`);
      await this.toolEscalateToHuman({
        ticketId,
        reason: `Critical safety inquiry for trip ${rideId}: ${complaintText}`,
      });

      return {
        id: ticketId,
        userId,
        rideId,
        complaintText,
        status: 'ESCALATED',
        resolutionNotes: 'Your safety concern has been elevated to our Emergency Safety Response Team.',
        refundIssued: 0,
        auditLog,
        createdAt: Date.now(),
      };
    }

    // Default resolution
    return {
      id: ticketId,
      userId,
      rideId,
      complaintText,
      status: 'RESOLVED',
      resolutionNotes: 'Thank you for your feedback. We have documented your notes regarding trip ' + rideId,
      refundIssued: 0,
      auditLog,
      createdAt: Date.now(),
    };
  }
}
