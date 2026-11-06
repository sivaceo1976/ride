import { IRedisClient, HydratedDriverCandidate } from '../redis/redis.interface.js';
import { RedisGeoService } from '../redis/geo.service.js';
import { DistributedLockManager, LockHandle } from '../locking/lock.manager.js';
import { RedisPubSubService } from '../redis/pubsub.service.js';
import { Coordinate } from '../../modules/rides/types.js';
import { VehicleClass } from '../../modules/vehicles/types.js';
import { calculateBearing, calculateHaversineDistanceKm } from '../../utils/geo.js';

export interface DispatchCandidate extends HydratedDriverCandidate {
  rating: number;
  etaMinutes: number;
  bearingAlignment: number; // 0 (directly facing pickup) to 1 (facing 180 deg away)
  score: number;
}

export interface RideOfferPayload {
  type: 'RIDE_OFFER';
  rideId: string;
  driverId: string;
  pickupLocation: Coordinate;
  pickupAddress: string;
  dropoffLocation: Coordinate;
  dropoffAddress: string;
  estimatedFare: number;
  estimatedDistanceKm: number;
  estimatedDurationMin: number;
  timeoutSec: number;
  expiresAt: number;
}

export interface DispatchRequest {
  rideId: string;
  pickupLocation: Coordinate;
  pickupAddress: string;
  dropoffLocation: Coordinate;
  dropoffAddress: string;
  estimatedFare: number;
  estimatedDistanceKm: number;
  estimatedDurationMin: number;
  vehicleClass: VehicleClass;
  searchRadiusKm?: number;
}

export const DISPATCH_OFFER_TIMEOUT_SEC = 15;

export class DispatchEngine {
  // In-memory registry of scheduled timeout timers
  private activeTimers = new Map<string, NodeJS.Timeout>();
  // Registry of active driver locks during offer
  private activeDriverLocks = new Map<string, LockHandle>();

  constructor(
    private redis: IRedisClient,
    private geoService: RedisGeoService,
    private lockManager: DistributedLockManager,
    private pubSubService: RedisPubSubService
  ) {}

  private getOfferKey(rideId: string): string {
    return `ride:offer:${rideId}`;
  }

  private getBlacklistKey(rideId: string): string {
    return `ride:blacklist:${rideId}`;
  }

  /**
   * Evaluates candidates for a ride, ranks them with the multi-factor scoring formula,
   * and dispatches an offer to the highest-scoring available candidate.
   */
  async dispatchRide(request: DispatchRequest): Promise<{ dispatched: boolean; candidateId?: string }> {
    const currentOffer = await this.getCurrentOffer(request.rideId);
    if (currentOffer) {
      // An offer is already active for this ride
      return { dispatched: true, candidateId: currentOffer };
    }

    const radius = request.searchRadiusKm || 3.0;

    // 1. Query nearby drivers within search radius
    let nearbyDrivers = await this.geoService.getNearbyDrivers(
      request.pickupLocation.lat,
      request.pickupLocation.lng,
      radius,
      request.vehicleClass
    );

    // Expand search radius if no candidates found initially
    if (nearbyDrivers.length === 0 && radius < 8.0) {
      nearbyDrivers = await this.geoService.getNearbyDrivers(
        request.pickupLocation.lat,
        request.pickupLocation.lng,
        Math.min(radius + 3.0, 8.0),
        request.vehicleClass
      );
    }

    if (nearbyDrivers.length === 0) {
      return { dispatched: false };
    }

    // 2. Fetch blacklisted drivers for this ride
    const blacklisted = await this.getBlacklistedDrivers(request.rideId);

    // 3. Filter candidates: drop busy, blacklisted, or currently locked drivers
    const eligibleCandidates: HydratedDriverCandidate[] = [];
    for (const driver of nearbyDrivers) {
      if (blacklisted.has(driver.driverId)) continue;
      if (driver.status !== 'ONLINE') continue;

      eligibleCandidates.push(driver);
    }

    if (eligibleCandidates.length === 0) {
      return { dispatched: false };
    }

    // 4. Compute multi-factor scores and rank candidates
    const scoredCandidates = this.rankCandidates(eligibleCandidates, request.pickupLocation);

    // 5. Try dispatching sequentially to top candidate
    for (const candidate of scoredCandidates) {
      const lockAcquired = await this.lockManager.acquireDriverLock(
        candidate.driverId,
        DISPATCH_OFFER_TIMEOUT_SEC * 1000
      );

      if (!lockAcquired) {
        // Driver is currently locked (evaluating another offer or accepting)
        continue;
      }

      // Record lock
      this.activeDriverLocks.set(`${request.rideId}:${candidate.driverId}`, lockAcquired);

      // Record offer in Redis with 15s TTL
      const offerKey = this.getOfferKey(request.rideId);
      await this.redis.set(offerKey, candidate.driverId, 'EX', DISPATCH_OFFER_TIMEOUT_SEC);

      const offerPayload: RideOfferPayload = {
        type: 'RIDE_OFFER',
        rideId: request.rideId,
        driverId: candidate.driverId,
        pickupLocation: request.pickupLocation,
        pickupAddress: request.pickupAddress,
        dropoffLocation: request.dropoffLocation,
        dropoffAddress: request.dropoffAddress,
        estimatedFare: request.estimatedFare,
        estimatedDistanceKm: request.estimatedDistanceKm,
        estimatedDurationMin: request.estimatedDurationMin,
        timeoutSec: DISPATCH_OFFER_TIMEOUT_SEC,
        expiresAt: Date.now() + DISPATCH_OFFER_TIMEOUT_SEC * 1000,
      };

      // Publish offer directly to the driver's private channel
      await this.redis.publish(`driver:offer:${candidate.driverId}`, JSON.stringify(offerPayload));

      // Schedule 15-second timeout handler
      this.scheduleOfferTimeout(request, candidate.driverId);

      return { dispatched: true, candidateId: candidate.driverId };
    }

    return { dispatched: false };
  }

  /**
   * Multi-Factor Ranking Formula:
   * Score = w1 * ETA + w2 * (5.0 - Rating) + w3 * BearingAlignment
   * Lower score wins!
   */
  rankCandidates(candidates: HydratedDriverCandidate[], pickupCoord: Coordinate): DispatchCandidate[] {
    const w1 = 0.5; // ETA weight
    const w2 = 0.3; // Rating weight
    const w3 = 0.2; // Bearing alignment weight

    const scored = candidates.map((driver) => {
      // 1. Calculate ETA: assuming average speed of max(driver.speed, 25) km/h
      const effectiveSpeed = driver.speed > 10 ? driver.speed : 30;
      const etaMinutes = (driver.distanceKm / effectiveSpeed) * 60;

      // 2. Rating penalty: (5.0 - rating), default rating 4.9
      const rating = 4.9;
      const ratingPenalty = 5.0 - rating;

      // 3. Bearing alignment: difference between driver heading and line-of-sight to pickup
      const bearingToPickup = calculateBearing(
        { lat: driver.lat, lng: driver.lng },
        pickupCoord
      );
      let angleDiff = Math.abs(driver.bearing - bearingToPickup) % 360;
      if (angleDiff > 180) {
        angleDiff = 360 - angleDiff;
      }
      const bearingAlignment = angleDiff / 180; // 0 = aligned, 1 = opposite direction

      // Combined composite score
      const score = w1 * etaMinutes + w2 * ratingPenalty + w3 * bearingAlignment;

      return {
        ...driver,
        rating,
        etaMinutes: Math.round(etaMinutes * 10) / 10,
        bearingAlignment: Math.round(bearingAlignment * 100) / 100,
        score: Math.round(score * 1000) / 1000,
      };
    });

    // Sort ascending (lowest score is best match)
    return scored.sort((a, b) => a.score - b.score);
  }

  /**
   * Schedules a delayed 15-second offer expiration job.
   */
  scheduleOfferTimeout(request: DispatchRequest, driverId: string): void {
    const timerKey = `${request.rideId}:${driverId}`;

    const timer = setTimeout(async () => {
      await this.handleOfferTimeout(request, driverId);
    }, DISPATCH_OFFER_TIMEOUT_SEC * 1000);

    if (timer.unref) {
      timer.unref();
    }

    this.activeTimers.set(timerKey, timer);
  }

  /**
   * Handles timeout of an unaccepted 15s offer:
   * 1. Releases driver lock
   * 2. Clears offer key
   * 3. Blacklists driver for this ride
   * 4. Automatically iterates to next candidate
   */
  async handleOfferTimeout(request: DispatchRequest, driverId: string): Promise<void> {
    const timerKey = `${request.rideId}:${driverId}`;
    this.activeTimers.delete(timerKey);

    const offerKey = this.getOfferKey(request.rideId);
    const currentOfferDriver = await this.redis.get(offerKey);

    // Only proceed if offer hasn't already been accepted by this driver
    if (currentOfferDriver === driverId) {
      await this.redis.del(offerKey);
      await this.blacklistDriver(request.rideId, driverId);

      const lock = this.activeDriverLocks.get(timerKey);
      if (lock) {
        await this.lockManager.release(lock);
        this.activeDriverLocks.delete(timerKey);
      }

      // Automatically re-trigger dispatch for next candidate
      await this.dispatchRide(request);
    }
  }

  /**
   * Handles driver manual rejection of an offer.
   */
  async handleDriverReject(request: DispatchRequest, driverId: string): Promise<void> {
    const timerKey = `${request.rideId}:${driverId}`;
    const timer = this.activeTimers.get(timerKey);
    if (timer) {
      clearTimeout(timer);
      this.activeTimers.delete(timerKey);
    }

    const offerKey = this.getOfferKey(request.rideId);
    await this.redis.del(offerKey);
    await this.blacklistDriver(request.rideId, driverId);

    const lock = this.activeDriverLocks.get(timerKey);
    if (lock) {
      await this.lockManager.release(lock);
      this.activeDriverLocks.delete(timerKey);
    }

    // Immediately trigger dispatch for the next eligible candidate
    await this.dispatchRide(request);
  }

  /**
   * Releases the offer reservation lock held on a driver.
   */
  async releaseOfferLock(rideId: string, driverId: string): Promise<void> {
    const timerKey = `${rideId}:${driverId}`;
    const lock = this.activeDriverLocks.get(timerKey);
    if (lock) {
      await this.lockManager.release(lock);
      this.activeDriverLocks.delete(timerKey);
    }
  }

  /**
   * Cleans up offer state when an offer is successfully accepted.
   */
  async handleOfferAccepted(rideId: string, driverId: string): Promise<void> {
    const timerKey = `${rideId}:${driverId}`;
    const timer = this.activeTimers.get(timerKey);
    if (timer) {
      clearTimeout(timer);
      this.activeTimers.delete(timerKey);
    }

    const offerKey = this.getOfferKey(rideId);
    await this.redis.del(offerKey);
    await this.releaseOfferLock(rideId, driverId);
  }

  async getCurrentOffer(rideId: string): Promise<string | null> {
    return this.redis.get(this.getOfferKey(rideId));
  }

  async blacklistDriver(rideId: string, driverId: string): Promise<void> {
    const key = this.getBlacklistKey(rideId);
    const existing = await this.redis.get(key);
    const list = existing ? JSON.parse(existing) : [];
    if (!list.includes(driverId)) {
      list.push(driverId);
      await this.redis.set(key, JSON.stringify(list), 'EX', 3600); // 1 hour TTL
    }
  }

  async getBlacklistedDrivers(rideId: string): Promise<Set<string>> {
    const key = this.getBlacklistKey(rideId);
    const existing = await this.redis.get(key);
    if (!existing) return new Set();
    try {
      const list = JSON.parse(existing);
      return new Set(Array.isArray(list) ? list : []);
    } catch {
      return new Set();
    }
  }

  clearAllTimers(): void {
    for (const timer of this.activeTimers.values()) {
      clearTimeout(timer);
    }
    this.activeTimers.clear();
    this.activeDriverLocks.clear();
  }
}
