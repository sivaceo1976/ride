import crypto from 'node:crypto';
import { IRedisClient } from '../redis/redis.interface.js';

export interface LockHandle {
  resource: string;
  token: string;
  ttlMs: number;
  acquiredAt: number;
}

export class LockAcquisitionError extends Error {
  constructor(public readonly resource: string, message?: string) {
    super(message || `Failed to acquire distributed lock for resource: ${resource}`);
    this.name = 'LockAcquisitionError';
  }
}

const REDLOCK_RELEASE_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`.trim();

export class DistributedLockManager {
  constructor(private redis: IRedisClient) {}

  private getLockKey(resource: string): string {
    return `lock:${resource}`;
  }

  /**
   * Attempts to acquire a distributed lock.
   * Uses atomic SET key token NX PX ttlMs.
   * If retryAttempts > 0, retries with exponential/jittered backoff.
   */
  async acquire(
    resource: string,
    ttlMs = 10000,
    retryAttempts = 0,
    retryDelayMs = 50
  ): Promise<LockHandle | null> {
    const key = this.getLockKey(resource);
    const token = crypto.randomUUID();

    let attempts = 0;
    while (attempts <= retryAttempts) {
      // SET key token PX ttlMs NX
      const res = await this.redis.set(key, token, 'PX', ttlMs, 'NX');

      if (res === 'OK') {
        return {
          resource,
          token,
          ttlMs,
          acquiredAt: Date.now(),
        };
      }

      attempts++;
      if (attempts <= retryAttempts) {
        const jitter = Math.floor(Math.random() * 20);
        await new Promise((r) => setTimeout(r, retryDelayMs + jitter));
      }
    }

    return null;
  }

  /**
   * Releases the distributed lock atomically using Lua script.
   * Only the original token holder can release the lock.
   */
  async release(lock: LockHandle): Promise<boolean> {
    const key = this.getLockKey(lock.resource);
    const result = await this.redis.eval(REDLOCK_RELEASE_LUA, 1, key, lock.token);
    return Number(result) === 1;
  }

  /**
   * Executes a callback within a protected distributed lock context (RAII pattern).
   * Automatically releases the lock when callback finishes or throws.
   */
  async withLock<T>(
    resource: string,
    ttlMs: number,
    fn: () => Promise<T>,
    retryAttempts = 3,
    retryDelayMs = 50
  ): Promise<T> {
    const lock = await this.acquire(resource, ttlMs, retryAttempts, retryDelayMs);
    if (!lock) {
      throw new LockAcquisitionError(resource);
    }

    try {
      return await fn();
    } finally {
      await this.release(lock).catch((err) => {
        console.error(`Failed to cleanly release lock for ${resource}:`, err);
      });
    }
  }

  /**
   * Specialized lock for a driver: lock:driver:<driver_id>
   */
  async acquireDriverLock(driverId: string, ttlMs = 15000): Promise<LockHandle | null> {
    return this.acquire(`driver:${driverId}`, ttlMs, 0);
  }

  /**
   * Specialized lock for a ride: lock:ride:<ride_id>
   */
  async acquireRideLock(rideId: string, ttlMs = 10000): Promise<LockHandle | null> {
    return this.acquire(`ride:${rideId}`, ttlMs, 2, 50);
  }
}
