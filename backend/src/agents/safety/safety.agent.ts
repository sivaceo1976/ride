import { Coordinate } from '../../modules/rides/types.js';
import { minDistanceToCorridor } from '../../utils/geo.js';
import { RedisPubSubService } from '../../services/redis/pubsub.service.js';
import { DbQueryRunner } from '../../database/seed.js';

export type SafetyAlertType = 'SAFETY_CORRIDOR_DEVIATION' | 'SAFETY_UNSCHEDULED_STOP';

export interface SafetyAlert {
  id: string;
  rideId: string;
  driverId: string;
  type: SafetyAlertType;
  severity: 'MEDIUM' | 'HIGH' | 'CRITICAL';
  details: {
    deviationMeters?: number;
    stoppedDurationSeconds?: number;
    currentLocation: Coordinate;
    speed: number;
  };
  timestamp: number;
}

export interface ActiveTripSafetyContext {
  rideId: string;
  driverId: string;
  plannedCorridor: Coordinate[];
  stationarySince?: number;
  lastAlertTimestamp?: number;
}

export const CORRIDOR_DEVIATION_THRESHOLD_METERS = 500;
export const STATIONARY_SPEED_THRESHOLD_KMH = 2.0;
export const STATIONARY_DURATION_THRESHOLD_MS = 300000; // 5 minutes

export class RouteSafetyAgent {
  private activeTrips = new Map<string, ActiveTripSafetyContext>();
  private safetyAuditTrail: SafetyAlert[] = [];

  constructor(
    private pubSubService: RedisPubSubService,
    private dbClient?: DbQueryRunner
  ) {}

  /**
   * Registers a trip corridor for monitoring during IN_TRANSIT
   */
  registerTripCorridor(rideId: string, driverId: string, plannedCorridor: Coordinate[]): void {
    this.activeTrips.set(rideId, {
      rideId,
      driverId,
      plannedCorridor,
    });
  }

  /**
   * Unregisters a trip when completed or cancelled
   */
  unregisterTrip(rideId: string): void {
    this.activeTrips.delete(rideId);
  }

  /**
   * Evaluates incoming live telemetry packet for safety corridor deviation and unauthorized stoppages
   */
  async evaluateTelemetry(packet: {
    rideId: string;
    driverId: string;
    lat: number;
    lng: number;
    speed: number;
    timestamp: number;
  }): Promise<SafetyAlert[]> {
    const context = this.activeTrips.get(packet.rideId);
    if (!context) {
      return [];
    }

    const alerts: SafetyAlert[] = [];
    const currentCoord: Coordinate = { lat: packet.lat, lng: packet.lng };

    // 1. Check Route Corridor Deviation (> 500 meters)
    if (context.plannedCorridor.length >= 2) {
      const deviationMeters = minDistanceToCorridor(currentCoord, context.plannedCorridor);

      if (deviationMeters > CORRIDOR_DEVIATION_THRESHOLD_METERS) {
        const alert: SafetyAlert = {
          id: crypto.randomUUID(),
          rideId: packet.rideId,
          driverId: packet.driverId,
          type: 'SAFETY_CORRIDOR_DEVIATION',
          severity: deviationMeters > 1500 ? 'CRITICAL' : 'HIGH',
          details: {
            deviationMeters: Math.round(deviationMeters),
            currentLocation: currentCoord,
            speed: packet.speed,
          },
          timestamp: packet.timestamp,
        };

        alerts.push(alert);
        await this.handleSafetyAlert(alert);
      }
    }

    // 2. Check Stationary / Unauthorized Stoppage (speed <= 2 km/h for > 5 minutes)
    if (packet.speed <= STATIONARY_SPEED_THRESHOLD_KMH) {
      if (!context.stationarySince) {
        context.stationarySince = packet.timestamp;
      } else {
        const stoppedDurationMs = packet.timestamp - context.stationarySince;

        if (stoppedDurationMs >= STATIONARY_DURATION_THRESHOLD_MS) {
          const alert: SafetyAlert = {
            id: crypto.randomUUID(),
            rideId: packet.rideId,
            driverId: packet.driverId,
            type: 'SAFETY_UNSCHEDULED_STOP',
            severity: 'CRITICAL',
            details: {
              stoppedDurationSeconds: Math.round(stoppedDurationMs / 1000),
              currentLocation: currentCoord,
              speed: packet.speed,
            },
            timestamp: packet.timestamp,
          };

          alerts.push(alert);
          await this.handleSafetyAlert(alert);
        }
      }
    } else {
      // Vehicle is moving; reset stationary timer
      context.stationarySince = undefined;
    }

    return alerts;
  }

  /**
   * Broadcasts alert to rider WebSocket and persists to database audit trail
   */
  private async handleSafetyAlert(alert: SafetyAlert): Promise<void> {
    this.safetyAuditTrail.push(alert);

    // 1. Broadcast real-time safety alert to rider on trip:<rideId>
    await this.pubSubService.publishTripTelemetry(alert.rideId, {
      type: 'TRIP_TELEMETRY',
      rideId: alert.rideId,
      driverId: alert.driverId,
      lat: alert.details.currentLocation.lat,
      lng: alert.details.currentLocation.lng,
      bearing: 0,
      speed: alert.details.speed,
      timestamp: alert.timestamp,
    });

    // 2. Optional: Persist alert to PostgreSQL if client is provided
    if (this.dbClient) {
      try {
        await this.dbClient.query(
          `
          INSERT INTO safety_alerts (id, ride_id, driver_id, alert_type, severity, details, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT DO NOTHING;
          `,
          [
            alert.id,
            alert.rideId,
            alert.driverId,
            alert.type,
            alert.severity,
            JSON.stringify(alert.details),
            new Date(alert.timestamp),
          ]
        );
      } catch {
        // Fallback in-memory trail preserved
      }
    }
  }

  /**
   * Retrieves all safety alerts recorded for a trip
   */
  getAlertsForRide(rideId: string): SafetyAlert[] {
    return this.safetyAuditTrail.filter((a) => a.rideId === rideId);
  }

  clearAlerts(): void {
    this.safetyAuditTrail = [];
    this.activeTrips.clear();
  }
}
