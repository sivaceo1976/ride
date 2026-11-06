import { IRedisClient } from '../redis/redis.interface.js';
import { SurgeRecommendation, WeatherCondition } from './pricing.types.js';

export const SURGE_ALPHA = 0.5;
export const SURGE_EPSILON = 1.0;
export const SURGE_FLOOR = 1.0;
export const SURGE_CEILING = 3.5;

export class PricingService {
  constructor(private redis: IRedisClient) {}

  /**
   * Computes deterministic mathematical surge multiplier based on supply-demand elasticity:
   * M = min(3.5, max(1.0, 1.0 + alpha * ((D - S) / (S + epsilon)))) * weatherFactor
   * Clamped strictly to [1.00, 3.50] and rounded to two decimal places.
   */
  calculateRuleBasedSurge(
    demand: number,
    supply: number,
    weatherMultiplier = 1.0
  ): number {
    const rawDeficit = demand - supply;

    let multiplier = 1.0;
    if (rawDeficit > 0) {
      const elasticity = (rawDeficit / (supply + SURGE_EPSILON));
      multiplier = 1.0 + SURGE_ALPHA * elasticity;
    }

    // Apply adverse weather multiplier (if any)
    multiplier *= weatherMultiplier;

    // Enforce strict bounds [1.00, 3.50]
    const clamped = Math.min(SURGE_CEILING, Math.max(SURGE_FLOOR, multiplier));
    return Math.round(clamped * 100) / 100;
  }

  /**
   * Records an open ride request in an H3 cell with a 5-minute sliding TTL.
   */
  async recordRideRequestInCell(h3Cell: string, rideId: string): Promise<void> {
    const key = `surge:demand:${h3Cell}`;
    const now = Date.now();
    // Add rideId with timestamp score to sorted set
    const client: any = this.redis;
    if (client.zadd) {
      await client.zadd(key, now, rideId);
      await this.redis.expire(key, 300); // 5 minutes
    } else {
      // In-memory set fallback
      await this.redis.hset(key, { [rideId]: now });
      await this.redis.expire(key, 300);
    }
  }

  /**
   * Aggregates active demand (unfulfilled requests in the last 5 minutes) in an H3 cell.
   */
  async getCellDemand(h3Cell: string): Promise<number> {
    const key = `surge:demand:${h3Cell}`;
    const client: any = this.redis;
    if (client.zcount) {
      const windowStart = Date.now() - 300000;
      return client.zcount(key, windowStart, '+inf');
    }

    const hash = await this.redis.hgetall(key);
    if (!hash) return 0;
    const windowStart = Date.now() - 300000;
    let count = 0;
    for (const ts of Object.values(hash)) {
      if (Number(ts) >= windowStart) count++;
    }
    return count;
  }

  /**
   * Sets cached surge multiplier for an H3 cell with a 60-second TTL.
   */
  async setCachedSurge(h3Cell: string, multiplier: number): Promise<void> {
    const key = `surge:multiplier:${h3Cell}`;
    await this.redis.set(key, String(multiplier), 'EX', 60);
  }

  /**
   * Gets cached surge multiplier for an H3 cell, defaulting to 1.00.
   */
  async getCachedSurge(h3Cell: string): Promise<number> {
    const key = `surge:multiplier:${h3Cell}`;
    const val = await this.redis.get(key);
    if (!val) return 1.0;
    const parsed = parseFloat(val);
    return isNaN(parsed) ? 1.0 : parsed;
  }
}
