import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryRedisClient } from '../src/services/redis/in-memory-redis.js';
import { DistributedLockManager, LockAcquisitionError } from '../src/services/locking/lock.manager.js';

describe('Phase 3 - Distributed Locking & Redlock Atomicity', () => {
  let redis: InMemoryRedisClient;
  let lockManager: DistributedLockManager;

  beforeEach(() => {
    redis = new InMemoryRedisClient();
    lockManager = new DistributedLockManager(redis);
  });

  it('should grant lock to exactly one caller among concurrent simultaneous contenders', async () => {
    const resource = 'driver:d0000000-0000-4000-8000-000000000001';
    const contendersCount = 10;

    // 10 callers attempt to acquire the lock at the exact same millisecond
    const acquirePromises = Array.from({ length: contendersCount }, () =>
      lockManager.acquire(resource, 5000)
    );

    const results = await Promise.all(acquirePromises);
    const successfulLocks = results.filter((h) => h !== null);

    // Exactly one winner must acquire the lock
    expect(successfulLocks.length).toBe(1);

    const winner = successfulLocks[0]!;
    expect(winner.resource).toBe(resource);
    expect(typeof winner.token).toBe('string');
  });

  it('should prevent unauthorized release: only the token owner can release the lock', async () => {
    const resource = 'ride:r0000000-0000-4000-8000-000000000001';
    const lock = await lockManager.acquire(resource, 5000);
    expect(lock).not.toBeNull();

    // Impostor tries to release with a forged token
    const impostorLock = {
      resource,
      token: 'impostor-fake-token-uuid',
      ttlMs: 5000,
      acquiredAt: Date.now(),
    };

    const releasedByImpostor = await lockManager.release(impostorLock);
    expect(releasedByImpostor).toBe(false);

    // Lock is still held
    const secondAcquire = await lockManager.acquire(resource, 5000);
    expect(secondAcquire).toBeNull();

    // Genuine owner releases
    const releasedByOwner = await lockManager.release(lock!);
    expect(releasedByOwner).toBe(true);

    // Now resource is freed and can be acquired
    const thirdAcquire = await lockManager.acquire(resource, 5000);
    expect(thirdAcquire).not.toBeNull();
  });

  it('should auto-expire lock after TTL elapses', async () => {
    const resource = 'ride:r0000000-0000-4000-8000-000000000002';
    // Acquire with short 50ms TTL
    const lock = await lockManager.acquire(resource, 50);
    expect(lock).not.toBeNull();

    // Immediately subsequent acquire fails
    expect(await lockManager.acquire(resource, 5000)).toBeNull();

    // Wait 70ms for TTL expiration
    await new Promise((r) => setTimeout(r, 70));

    // Lock must now be freely acquirable again
    const lockAfterExpiry = await lockManager.acquire(resource, 5000);
    expect(lockAfterExpiry).not.toBeNull();
  });

  it('should guarantee atomic execution and cleanup via withLock RAII helper', async () => {
    const resource = 'driver:d0000000-0000-4000-8000-000000000002';

    let executed = false;
    const result = await lockManager.withLock(resource, 5000, async () => {
      executed = true;
      // While running inside withLock, concurrent acquire must fail
      const concurrent = await lockManager.acquire(resource, 5000);
      expect(concurrent).toBeNull();
      return 42;
    });

    expect(executed).toBe(true);
    expect(result).toBe(42);

    // After withLock completes, lock must be cleanly released
    const afterRelease = await lockManager.acquire(resource, 5000);
    expect(afterRelease).not.toBeNull();
  });
});
