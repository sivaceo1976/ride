import {
  RideStatus,
  Ride,
  CreateRideRequestDto,
  FareBreakdown,
  canTransitionRide,
  Coordinate,
} from './types.js';
import { VehicleClass } from '../vehicles/types.js';
import { calculateHaversineDistanceKm } from '../../utils/geo.js';
import { generatePickupOtp, verifyPickupOtp } from '../../utils/otp.js';
import { DistributedLockManager } from '../../services/locking/lock.manager.js';
import { RedisGeoService } from '../../services/redis/geo.service.js';
import { RedisPubSubService } from '../../services/redis/pubsub.service.js';
import { DispatchEngine } from '../../services/dispatch/dispatch.engine.js';
import { DbQueryRunner } from '../../database/seed.js';

export class RideConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RideConflictError';
  }
}

export class InvalidOtpError extends Error {
  constructor(message = 'Invalid pickup verification OTP') {
    super(message);
    this.name = 'InvalidOtpError';
  }
}

export class RideNotFoundError extends Error {
  constructor(rideId: string) {
    super(`Ride not found with id: ${rideId}`);
    this.name = 'RideNotFoundError';
  }
}

export class InvalidStateTransitionError extends Error {
  constructor(from: RideStatus, to: RideStatus) {
    super(`Illegal ride state transition from ${from} to ${to}`);
    this.name = 'InvalidStateTransitionError';
  }
}

export class RideService {
  // In-memory ride repository fallback (for standalone tests & when dbClient is in-memory)
  private inMemoryRides = new Map<string, Ride>();

  constructor(
    private lockManager: DistributedLockManager,
    private geoService: RedisGeoService,
    private pubSubService: RedisPubSubService,
    private dispatchEngine: DispatchEngine,
    private dbClient?: DbQueryRunner
  ) {}

  /**
   * Calculates upfront fare breakdown based on vehicle class, distance, and duration.
   */
  calculateUpfrontFare(
    distanceKm: number,
    durationMin: number,
    vehicleClass: VehicleClass,
    surgeMultiplier = 1.0
  ): FareBreakdown {
    const rates: Record<VehicleClass, { base: number; perKm: number; perMin: number }> = {
      [VehicleClass.BIKE]: { base: 2.5, perKm: 1.0, perMin: 0.2 },
      [VehicleClass.SEDAN]: { base: 4.0, perKm: 1.75, perMin: 0.35 },
      [VehicleClass.SUV]: { base: 7.0, perKm: 2.5, perMin: 0.5 },
    };

    const rate = rates[vehicleClass] || rates[VehicleClass.SEDAN];
    const distanceFare = Math.round(distanceKm * rate.perKm * 100) / 100;
    const timeFare = Math.round(durationMin * rate.perMin * 100) / 100;
    const subtotal = rate.base + distanceFare + timeFare;
    const totalFare = Math.round(subtotal * surgeMultiplier * 100) / 100;

    return {
      baseFare: rate.base,
      perKmRate: rate.perKm,
      distanceKm: Math.round(distanceKm * 10) / 10,
      distanceFare,
      perMinRate: rate.perMin,
      durationMin: Math.round(durationMin * 10) / 10,
      timeFare,
      surgeMultiplier,
      totalFare,
      currency: 'USD',
    };
  }

  /**
   * 1. POST /rides/request:
   * Requests a new ride, calculates fare, generates 4-digit OTP, saves record, and triggers dispatch.
   */
  async requestRide(dto: CreateRideRequestDto): Promise<Ride> {
    const distanceKm = calculateHaversineDistanceKm(dto.pickupLocation, dto.dropoffLocation);
    // Estimated duration: assuming average metro speed of 28 km/h
    const durationMin = Math.max(5.0, (distanceKm / 28) * 60);
    const fare = this.calculateUpfrontFare(distanceKm, durationMin, dto.vehicleClass as VehicleClass);
    const otp = generatePickupOtp();

    const rideId = crypto.randomUUID();
    const now = new Date();

    const ride: Ride = {
      id: rideId,
      riderId: dto.riderId,
      driverId: null,
      status: RideStatus.REQUESTED,
      pickupAddress: dto.pickupAddress,
      pickupLocation: dto.pickupLocation,
      dropoffAddress: dto.dropoffAddress,
      dropoffLocation: dto.dropoffLocation,
      fareBreakdown: fare,
      otp,
      surgeMultiplier: fare.surgeMultiplier,
      estimatedDistanceKm: Math.round(distanceKm * 10) / 10,
      estimatedDurationMin: Math.round(durationMin * 10) / 10,
      createdAt: now,
      updatedAt: now,
    };

    // Transition to SEARCHING_DRIVER
    ride.status = RideStatus.SEARCHING_DRIVER;

    // Persist to DB or in-memory
    await this.saveRide(ride);

    // Trigger dispatch engine
    await this.dispatchEngine.dispatchRide({
      rideId: ride.id,
      pickupLocation: ride.pickupLocation,
      pickupAddress: ride.pickupAddress,
      dropoffLocation: ride.dropoffLocation,
      dropoffAddress: ride.dropoffAddress,
      estimatedFare: fare.totalFare,
      estimatedDistanceKm: ride.estimatedDistanceKm,
      estimatedDurationMin: ride.estimatedDurationMin,
      vehicleClass: dto.vehicleClass as VehicleClass,
    });

    return ride;
  }

  /**
   * 2. POST /rides/:id/accept:
   * Driver accepts dispatched offer. Enforces distributed lock to prevent race conditions.
   */
  async acceptRide(rideId: string, driverId: string): Promise<Ride> {
    // Acquire distributed lock for the ride
    return this.lockManager.withLock(`ride:${rideId}`, 10000, async () => {
      const ride = await this.getRideById(rideId);
      if (!ride) {
        throw new RideNotFoundError(rideId);
      }

      // Verify state is strictly SEARCHING_DRIVER
      if (ride.status !== RideStatus.SEARCHING_DRIVER) {
        throw new RideConflictError(
          `Cannot accept ride: current status is ${ride.status}, not SEARCHING_DRIVER`
        );
      }

      // Verify active offer in Redis matches this driver
      const activeOfferDriver = await this.dispatchEngine.getCurrentOffer(rideId);
      if (activeOfferDriver !== driverId) {
        throw new RideConflictError(
          `Offer mismatch or expired: offer belonged to ${activeOfferDriver}, attempted by ${driverId}`
        );
      }

      // Hand off offer lock from dispatch reservation to accept transaction
      await this.dispatchEngine.releaseOfferLock(rideId, driverId);

      // Now acquire driver lock to ensure atomicity
      return this.lockManager.withLock(`driver:${driverId}`, 10000, async () => {
        // Atomic State Transitions: SEARCHING_DRIVER -> ASSIGNED -> ACCEPTED
        if (!canTransitionRide(ride.status, RideStatus.ASSIGNED) || !canTransitionRide(RideStatus.ASSIGNED, RideStatus.ACCEPTED)) {
          throw new InvalidStateTransitionError(ride.status, RideStatus.ACCEPTED);
        }

        const now = new Date();
        ride.driverId = driverId;
        ride.status = RideStatus.ACCEPTED;
        ride.acceptedAt = now;
        ride.updatedAt = now;

        await this.saveRide(ride);

        // Mark driver as BUSY in Redis and associate rideId
        const meta = await this.geoService.getDriverMetadata(driverId);
        if (meta) {
          await this.geoService.updateDriverLocation(
            driverId,
            meta.lat,
            meta.lng,
            meta.vehicleClass,
            meta.bearing,
            meta.speed,
            rideId
          );
        }

        // Clean up offer timers in dispatch engine
        await this.dispatchEngine.handleOfferAccepted(rideId, driverId);

        // Broadcast to rider channel
        await this.pubSubService.publishTripTelemetry(rideId, {
          type: 'TRIP_TELEMETRY',
          rideId,
          driverId,
          lat: meta?.lat || ride.pickupLocation.lat,
          lng: meta?.lng || ride.pickupLocation.lng,
          bearing: meta?.bearing || 0,
          speed: meta?.speed || 0,
          timestamp: now.getTime(),
        });

        return ride;
      });
    });
  }

  /**
   * 3. POST /rides/:id/reject:
   * Driver rejects current offer -> immediately iterates to next candidate.
   */
  async rejectRide(rideId: string, driverId: string): Promise<void> {
    const ride = await this.getRideById(rideId);
    if (!ride) {
      throw new RideNotFoundError(rideId);
    }

    await this.dispatchEngine.handleDriverReject(
      {
        rideId,
        pickupLocation: ride.pickupLocation,
        pickupAddress: ride.pickupAddress,
        dropoffLocation: ride.dropoffLocation,
        dropoffAddress: ride.dropoffAddress,
        estimatedFare: ride.fareBreakdown.totalFare,
        estimatedDistanceKm: ride.estimatedDistanceKm,
        estimatedDurationMin: ride.estimatedDurationMin,
        vehicleClass: VehicleClass.SEDAN,
      },
      driverId
    );
  }

  /**
   * 4. POST /rides/:id/arrived:
   * Driver marks arrived at pickup -> transitions to ARRIVED_AT_PICKUP.
   */
  async driverArrived(rideId: string, driverId: string): Promise<Ride> {
    return this.lockManager.withLock(`ride:${rideId}`, 10000, async () => {
      const ride = await this.getRideById(rideId);
      if (!ride) throw new RideNotFoundError(rideId);

      if (ride.driverId !== driverId) {
        throw new RideConflictError(`Driver ${driverId} is not assigned to ride ${rideId}`);
      }

      if (!canTransitionRide(ride.status, RideStatus.ARRIVED_AT_PICKUP)) {
        throw new InvalidStateTransitionError(ride.status, RideStatus.ARRIVED_AT_PICKUP);
      }

      const now = new Date();
      ride.status = RideStatus.ARRIVED_AT_PICKUP;
      ride.arrivedAt = now;
      ride.updatedAt = now;

      await this.saveRide(ride);
      return ride;
    });
  }

  /**
   * 5. POST /rides/:id/start:
   * Validates 4-digit OTP using timing-safe comparison -> transitions to IN_TRANSIT.
   */
  async startTrip(rideId: string, driverId: string, submittedOtp: string): Promise<Ride> {
    return this.lockManager.withLock(`ride:${rideId}`, 10000, async () => {
      const ride = await this.getRideById(rideId);
      if (!ride) throw new RideNotFoundError(rideId);

      if (ride.driverId !== driverId) {
        throw new RideConflictError(`Driver ${driverId} is not assigned to ride ${rideId}`);
      }

      if (!canTransitionRide(ride.status, RideStatus.IN_TRANSIT)) {
        throw new InvalidStateTransitionError(ride.status, RideStatus.IN_TRANSIT);
      }

      // Timing-safe OTP verification
      const isValidOtp = verifyPickupOtp(submittedOtp, ride.otp);
      if (!isValidOtp) {
        throw new InvalidOtpError();
      }

      const now = new Date();
      ride.status = RideStatus.IN_TRANSIT;
      ride.startedAt = now;
      ride.updatedAt = now;

      await this.saveRide(ride);
      return ride;
    });
  }

  /**
   * 6. POST /rides/:id/complete:
   * Marks trip complete, releases driver in Redis, sets completed_at timestamp.
   */
  async completeTrip(rideId: string, driverId: string): Promise<Ride> {
    return this.lockManager.withLock(`ride:${rideId}`, 10000, async () => {
      const ride = await this.getRideById(rideId);
      if (!ride) throw new RideNotFoundError(rideId);

      if (ride.driverId !== driverId) {
        throw new RideConflictError(`Driver ${driverId} is not assigned to ride ${rideId}`);
      }

      if (!canTransitionRide(ride.status, RideStatus.COMPLETED)) {
        throw new InvalidStateTransitionError(ride.status, RideStatus.COMPLETED);
      }

      const now = new Date();
      ride.status = RideStatus.COMPLETED;
      ride.completedAt = now;
      ride.updatedAt = now;

      await this.saveRide(ride);

      // Release driver in Redis: set status back to ONLINE and clear rideId
      const meta = await this.geoService.getDriverMetadata(driverId);
      if (meta) {
        await this.geoService.updateDriverLocation(
          driverId,
          meta.lat,
          meta.lng,
          meta.vehicleClass,
          meta.bearing,
          meta.speed,
          undefined // Clear active rideId
        );
      }

      return ride;
    });
  }

  /**
   * 7. POST /rides/:id/cancel:
   * Cancels ride, validates deterministic transition, releases driver if assigned.
   */
  async cancelRide(
    rideId: string,
    cancelledBy: 'RIDER' | 'DRIVER',
    reason?: string
  ): Promise<Ride> {
    return this.lockManager.withLock(`ride:${rideId}`, 10000, async () => {
      const ride = await this.getRideById(rideId);
      if (!ride) throw new RideNotFoundError(rideId);

      if (!canTransitionRide(ride.status, RideStatus.CANCELLED)) {
        throw new InvalidStateTransitionError(ride.status, RideStatus.CANCELLED);
      }

      const now = new Date();
      ride.status = RideStatus.CANCELLED;
      ride.cancellationReason = `Cancelled by ${cancelledBy}: ${reason || 'No reason provided'}`;
      ride.updatedAt = now;

      await this.saveRide(ride);

      // Release driver if assigned
      if (ride.driverId) {
        const meta = await this.geoService.getDriverMetadata(ride.driverId);
        if (meta) {
          await this.geoService.updateDriverLocation(
            ride.driverId,
            meta.lat,
            meta.lng,
            meta.vehicleClass,
            meta.bearing,
            meta.speed,
            undefined
          );
        }
      }

      return ride;
    });
  }

  /**
   * Retrieves a ride by UUID
   */
  async getRideById(rideId: string): Promise<Ride | null> {
    if (this.dbClient) {
      try {
        const res: any = await this.dbClient.query(
          `
          SELECT id, rider_id as "riderId", driver_id as "driverId", status,
                 pickup_address as "pickupAddress", dropoff_address as "dropoffAddress",
                 fare_breakdown as "fareBreakdown", otp, surge_multiplier as "surgeMultiplier",
                 estimated_distance_km as "estimatedDistanceKm", estimated_duration_min as "estimatedDurationMin",
                 cancellation_reason as "cancellationReason", created_at as "createdAt",
                 updated_at as "updatedAt", accepted_at as "acceptedAt", arrived_at as "arrivedAt",
                 started_at as "startedAt", completed_at as "completedAt",
                 ST_AsGeoJSON(pickup_geom)::json as "pickupGeo",
                 ST_AsGeoJSON(dropoff_geom)::json as "dropoffGeo"
          FROM rides WHERE id = $1;
          `,
          [rideId]
        );

        if (res.rows && res.rows.length > 0) {
          const row = res.rows[0];
          return {
            ...row,
            pickupLocation: { lat: row.pickupGeo.coordinates[1], lng: row.pickupGeo.coordinates[0] },
            dropoffLocation: { lat: row.dropoffGeo.coordinates[1], lng: row.dropoffGeo.coordinates[0] },
          };
        }
      } catch {
        // Fallback to inMemory store below
      }
    }

    return this.inMemoryRides.get(rideId) || null;
  }

  /**
   * Saves or updates a ride record
   */
  async saveRide(ride: Ride): Promise<void> {
    this.inMemoryRides.set(ride.id, { ...ride });

    if (this.dbClient) {
      try {
        await this.dbClient.query(
          `
          INSERT INTO rides (
            id, rider_id, driver_id, status, pickup_address, pickup_geom,
            dropoff_address, dropoff_geom, fare_breakdown, otp, surge_multiplier,
            estimated_distance_km, estimated_duration_min, cancellation_reason,
            created_at, updated_at, accepted_at, arrived_at, started_at, completed_at
          )
          VALUES (
            $1, $2, $3, $4, $5,
            ST_SetSRID(ST_MakePoint($6, $7), 4326),
            $8,
            ST_SetSRID(ST_MakePoint($9, $10), 4326),
            $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21
          )
          ON CONFLICT (id) DO UPDATE SET
            driver_id = EXCLUDED.driver_id,
            status = EXCLUDED.status,
            updated_at = EXCLUDED.updated_at,
            accepted_at = EXCLUDED.accepted_at,
            arrived_at = EXCLUDED.arrived_at,
            started_at = EXCLUDED.started_at,
            completed_at = EXCLUDED.completed_at,
            cancellation_reason = EXCLUDED.cancellation_reason;
          `,
          [
            ride.id,
            ride.riderId,
            ride.driverId || null,
            ride.status,
            ride.pickupAddress,
            ride.pickupLocation.lng,
            ride.pickupLocation.lat,
            ride.dropoffAddress,
            ride.dropoffLocation.lng,
            ride.dropoffLocation.lat,
            JSON.stringify(ride.fareBreakdown),
            ride.otp,
            ride.surgeMultiplier,
            ride.estimatedDistanceKm,
            ride.estimatedDurationMin,
            ride.cancellationReason || null,
            ride.createdAt,
            ride.updatedAt,
            ride.acceptedAt || null,
            ride.arrivedAt || null,
            ride.startedAt || null,
            ride.completedAt || null,
          ]
        );
      } catch {
        // Fallback persisted to memory
      }
    }
  }
}
