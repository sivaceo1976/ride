import { EventEmitter } from 'node:events';
import { IRedisClient } from './redis.interface.js';
import { RedisGeoService, DRIVER_HEARTBEAT_TTL_SECONDS } from './geo.service.js';
import { RedisPubSubService } from './pubsub.service.js';
import { VehicleClass } from '../../modules/vehicles/types.js';

export interface HeartbeatWorkerOptions {
  checkIntervalMs?: number;
  silenceThresholdSeconds?: number;
}

export class HeartbeatWorker extends EventEmitter {
  private timer?: NodeJS.Timeout;
  private isRunning = false;
  private silenceThresholdMs: number;
  private checkIntervalMs: number;

  constructor(
    private redis: IRedisClient,
    private geoService: RedisGeoService,
    private pubSubService: RedisPubSubService,
    options?: HeartbeatWorkerOptions
  ) {
    super();
    this.checkIntervalMs = options?.checkIntervalMs || 3000;
    this.silenceThresholdMs = (options?.silenceThresholdSeconds || DRIVER_HEARTBEAT_TTL_SECONDS) * 1000;
  }

  /**
   * Starts the background heartbeat sweep
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.timer = setInterval(() => {
      this.checkHeartbeats().catch((err) => {
        console.error('Error during heartbeat worker sweep:', err);
      });
    }, this.checkIntervalMs);

    if (this.timer.unref) {
      this.timer.unref();
    }
  }

  /**
   * Stops the background worker
   */
  stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /**
   * Performs an atomic check of all registered active drivers.
   * If any driver has exceeded the silence threshold (>15s), evicts them and notifies matching queues.
   */
  async checkHeartbeats(): Promise<string[]> {
    const activeDrivers = await this.redis.zrange('drivers:active', 0, -1);
    if (!activeDrivers || activeDrivers.length === 0) {
      return [];
    }

    const now = Date.now();
    const expiredDriverIds: string[] = [];

    for (const driverId of activeDrivers) {
      const meta = await this.geoService.getDriverMetadata(driverId);

      // If metadata is gone or lastSeen is beyond silence threshold
      if (!meta || now - meta.lastSeen > this.silenceThresholdMs) {
        expiredDriverIds.push(driverId);
        const vehicleClass = meta?.vehicleClass;

        // Evict driver from geospatial indexes and active set
        await this.geoService.evictDriver(driverId, vehicleClass);

        // Publish to distributed pub/sub
        await this.pubSubService.publishDriverOffline(driverId, vehicleClass);

        // Emit local event for in-process dispatch queue
        this.emit('driver:expired', {
          driverId,
          vehicleClass,
          expiredAt: now,
        });
      }
    }

    return expiredDriverIds;
  }
}
