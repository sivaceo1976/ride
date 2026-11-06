import { IRedisClient, GeoSearchResult } from './redis.interface.js';
import { calculateHaversineDistanceKm } from '../../utils/geo.js';

interface SpatialMember {
  member: string;
  lng: number;
  lat: number;
}

interface KeyData {
  type: 'hash' | 'zset' | 'string';
  value: any;
  expiresAt?: number;
}

export class InMemoryRedisClient implements IRedisClient {
  private store = new Map<string, KeyData>();
  private subscribers = new Map<string, Set<(channel: string, message: string) => void>>();
  private cleanupTimer?: NodeJS.Timeout;

  constructor() {
    // Background purge for expired keys every second
    this.cleanupTimer = setInterval(() => this.purgeExpiredKeys(), 1000);
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  private isExpired(key: string): boolean {
    const data = this.store.get(key);
    if (!data || !data.expiresAt) return false;
    return Date.now() > data.expiresAt;
  }

  private purgeExpiredKeys(): void {
    const now = Date.now();
    for (const [key, data] of this.store.entries()) {
      if (data.expiresAt && now > data.expiresAt) {
        this.store.delete(key);
      }
    }
  }

  async ping(): Promise<string> {
    return 'PONG';
  }

  async get(key: string): Promise<string | null> {
    if (this.isExpired(key)) {
      this.store.delete(key);
      return null;
    }
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.type === 'string') return String(entry.value);
    return null;
  }

  async set(
    key: string,
    value: string,
    mode?: string,
    duration?: number,
    flag?: string
  ): Promise<'OK' | null> {
    const isNx = mode === 'NX' || flag === 'NX';
    const isPx = mode === 'PX' || flag === 'PX';
    const isEx = mode === 'EX' || flag === 'EX';

    const existsAndAlive = this.store.has(key) && !this.isExpired(key);

    if (isNx && existsAndAlive) {
      return null;
    }

    let expiresAt: number | undefined;
    if (duration !== undefined && duration > 0) {
      if (isPx) {
        expiresAt = Date.now() + duration;
      } else if (isEx) {
        expiresAt = Date.now() + duration * 1000;
      } else {
        expiresAt = Date.now() + duration;
      }
    }

    this.store.set(key, {
      type: 'string',
      value,
      expiresAt,
    });

    return 'OK';
  }

  async eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<any> {
    const keys = args.slice(0, numKeys).map(String);
    const argv = args.slice(numKeys).map(String);

    // Standard Redlock Lua unlock script
    if (script.includes('redis.call("get", KEYS[1]) == ARGV[1]') || script.includes("redis.call('get', KEYS[1]) == ARGV[1]")) {
      const key = keys[0];
      const token = argv[0];
      const currentVal = await this.get(key);
      if (currentVal === token) {
        await this.del(key);
        return 1;
      }
      return 0;
    }

    return 0;
  }

  async geoadd(key: string, lng: number, lat: number, member: string): Promise<number> {
    let entry = this.store.get(key);
    if (!entry || entry.type !== 'zset') {
      entry = { type: 'zset', value: new Map<string, SpatialMember>() };
      this.store.set(key, entry);
    }

    const zset = entry.value as Map<string, SpatialMember>;
    const isNew = !zset.has(member);
    zset.set(member, { member, lng, lat });
    return isNew ? 1 : 0;
  }

  async geosearch(
    key: string,
    fromLng: number,
    fromLat: number,
    radiusKm: number
  ): Promise<GeoSearchResult[]> {
    if (this.isExpired(key)) {
      this.store.delete(key);
      return [];
    }

    const entry = this.store.get(key);
    if (!entry || entry.type !== 'zset') {
      return [];
    }

    const zset = entry.value as Map<string, SpatialMember>;
    const results: GeoSearchResult[] = [];

    const center = { lat: fromLat, lng: fromLng };

    for (const item of zset.values()) {
      const itemCoord = { lat: item.lat, lng: item.lng };
      const distKm = calculateHaversineDistanceKm(center, itemCoord);

      if (distKm <= radiusKm) {
        results.push({
          member: item.member,
          distanceKm: Math.round(distKm * 1000) / 1000,
          lat: item.lat,
          lng: item.lng,
        });
      }
    }

    // Sort by distance ascending
    results.sort((a, b) => a.distanceKm - b.distanceKm);
    return results;
  }

  async hset(key: string, data: Record<string, string | number>): Promise<number> {
    let entry = this.store.get(key);
    if (!entry || entry.type !== 'hash' || this.isExpired(key)) {
      entry = { type: 'hash', value: new Map<string, string>() };
      this.store.set(key, entry);
    }

    const hash = entry.value as Map<string, string>;
    let newFields = 0;

    for (const [field, val] of Object.entries(data)) {
      if (!hash.has(field)) newFields++;
      hash.set(field, String(val));
    }

    return newFields;
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    if (this.isExpired(key)) {
      this.store.delete(key);
      return {};
    }

    const entry = this.store.get(key);
    if (!entry || entry.type !== 'hash') {
      return {};
    }

    const hash = entry.value as Map<string, string>;
    const result: Record<string, string> = {};
    for (const [k, v] of hash.entries()) {
      result[k] = v;
    }
    return result;
  }

  async expire(key: string, seconds: number): Promise<number> {
    const entry = this.store.get(key);
    if (!entry) return 0;
    entry.expiresAt = Date.now() + seconds * 1000;
    return 1;
  }

  async ttl(key: string): Promise<number> {
    const entry = this.store.get(key);
    if (!entry) return -2;
    if (!entry.expiresAt) return -1;
    const remainingMs = entry.expiresAt - Date.now();
    if (remainingMs <= 0) {
      this.store.delete(key);
      return -2;
    }
    return Math.ceil(remainingMs / 1000);
  }

  async del(...keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) {
      if (this.store.delete(key)) count++;
    }
    return count;
  }

  async zrem(key: string, ...members: string[]): Promise<number> {
    const entry = this.store.get(key);
    if (!entry || entry.type !== 'zset') return 0;
    const zset = entry.value as Map<string, SpatialMember>;
    let removed = 0;
    for (const m of members) {
      if (zset.delete(m)) removed++;
    }
    return removed;
  }

  async zrange(key: string, start: number, stop: number): Promise<string[]> {
    const entry = this.store.get(key);
    if (!entry || entry.type !== 'zset') return [];
    const zset = entry.value as Map<string, SpatialMember>;
    const members = Array.from(zset.keys());
    if (stop === -1) {
      return members.slice(start);
    }
    return members.slice(start, stop + 1);
  }

  async publish(channel: string, message: string): Promise<number> {
    const subs = this.subscribers.get(channel);
    if (!subs || subs.size === 0) return 0;

    for (const handler of subs) {
      try {
        handler(channel, message);
      } catch (err) {
        console.error(`Error in subscriber handler for channel ${channel}:`, err);
      }
    }
    return subs.size;
  }

  async subscribe(
    channel: string,
    handler: (channel: string, message: string) => void
  ): Promise<void> {
    let subs = this.subscribers.get(channel);
    if (!subs) {
      subs = new Set();
      this.subscribers.set(channel, subs);
    }
    subs.add(handler);
  }

  async unsubscribe(channel: string): Promise<void> {
    this.subscribers.delete(channel);
  }

  async keys(pattern: string): Promise<string[]> {
    const regexStr = '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$';
    const regex = new RegExp(regexStr);
    const result: string[] = [];
    for (const [key] of this.store.entries()) {
      if (!this.isExpired(key) && regex.test(key)) {
        result.push(key);
      }
    }
    return result;
  }

  async quit(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    this.store.clear();
    this.subscribers.clear();
  }
}
