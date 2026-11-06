import { Redis } from 'ioredis';
import { IRedisClient, GeoSearchResult } from './redis.interface.js';
import { InMemoryRedisClient } from './in-memory-redis.js';

export class RealRedisClient implements IRedisClient {
  private client: Redis;
  private subClient?: Redis;
  private subscriptionHandlers = new Map<string, Set<(channel: string, message: string) => void>>();

  constructor(connectionUrl?: string) {
    const url = connectionUrl || process.env.REDIS_URL || 'redis://localhost:6379';
    this.client = new Redis(url, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 100, 3000),
      enableReadyCheck: true,
      autoResubscribe: true,
      lazyConnect: true,
    });
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  async ping(): Promise<string> {
    return this.client.ping();
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(
    key: string,
    value: string,
    mode?: string,
    duration?: number,
    flag?: string
  ): Promise<'OK' | null> {
    if (mode && duration !== undefined && flag) {
      return (this.client as any).set(key, value, mode, duration, flag);
    }
    if (mode && duration !== undefined) {
      return (this.client as any).set(key, value, mode, duration);
    }
    return (this.client as any).set(key, value);
  }

  async eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<any> {
    return (this.client as any).eval(script, numKeys, ...args);
  }

  async geoadd(key: string, lng: number, lat: number, member: string): Promise<number> {
    return this.client.geoadd(key, lng, lat, member);
  }

  async geosearch(
    key: string,
    fromLng: number,
    fromLat: number,
    radiusKm: number
  ): Promise<GeoSearchResult[]> {
    // Redis 7 GEOSEARCH command with WITHCOORD WITHDIST ASC
    // returns array: [[member, distance, [lng, lat]], ...]
    const raw: any = await (this.client as any).geosearch(
      key,
      'FROMLONLAT',
      fromLng,
      fromLat,
      'BYRADIUS',
      radiusKm,
      'km',
      'WITHCOORD',
      'WITHDIST',
      'ASC'
    );

    if (!Array.isArray(raw)) {
      return [];
    }

    return raw.map((item: any) => ({
      member: item[0],
      distanceKm: parseFloat(item[1]),
      lng: parseFloat(item[2][0]),
      lat: parseFloat(item[2][1]),
    }));
  }

  async hset(key: string, data: Record<string, string | number>): Promise<number> {
    return this.client.hset(key, data);
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return this.client.hgetall(key);
  }

  async expire(key: string, seconds: number): Promise<number> {
    return this.client.expire(key, seconds);
  }

  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  async del(...keys: string[]): Promise<number> {
    return this.client.del(...keys);
  }

  async zrem(key: string, ...members: string[]): Promise<number> {
    return this.client.zrem(key, ...members);
  }

  async zrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.client.zrange(key, start, stop);
  }

  async publish(channel: string, message: string): Promise<number> {
    return this.client.publish(channel, message);
  }

  async subscribe(
    channel: string,
    handler: (channel: string, message: string) => void
  ): Promise<void> {
    if (!this.subClient) {
      this.subClient = this.client.duplicate();
      await this.subClient.connect();
      this.subClient.on('message', (ch, msg) => {
        const handlers = this.subscriptionHandlers.get(ch);
        if (handlers) {
          for (const h of handlers) h(ch, msg);
        }
      });
    }

    let handlers = this.subscriptionHandlers.get(channel);
    if (!handlers) {
      handlers = new Set();
      this.subscriptionHandlers.set(channel, handlers);
      await this.subClient.subscribe(channel);
    }
    handlers.add(handler);
  }

  async unsubscribe(channel: string): Promise<void> {
    this.subscriptionHandlers.delete(channel);
    if (this.subClient) {
      await this.subClient.unsubscribe(channel);
    }
  }

  async keys(pattern: string): Promise<string[]> {
    return this.client.keys(pattern);
  }

  async quit(): Promise<void> {
    if (this.subClient) {
      await this.subClient.quit();
    }
    await this.client.quit();
  }
}

let redisInstance: IRedisClient | null = null;

export function getRedisClient(forceInMemory = false): IRedisClient {
  if (redisInstance) {
    return redisInstance;
  }

  if (forceInMemory || process.env.NODE_ENV === 'test' || !process.env.REDIS_URL) {
    redisInstance = new InMemoryRedisClient();
  } else {
    try {
      redisInstance = new RealRedisClient(process.env.REDIS_URL);
    } catch {
      redisInstance = new InMemoryRedisClient();
    }
  }

  return redisInstance;
}

export function setRedisClient(client: IRedisClient): void {
  redisInstance = client;
}
