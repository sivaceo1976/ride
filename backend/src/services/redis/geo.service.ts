import { IRedisClient, HydratedDriverCandidate, DriverMetadata } from './redis.interface.js';
import { VehicleClass } from '../../modules/vehicles/types.js';

export const DRIVER_HEARTBEAT_TTL_SECONDS = 15;

export class RedisGeoService {
  constructor(private redis: IRedisClient) {}

  /**
   * Key for vehicle class spatial index: drivers:BIKE, drivers:SEDAN, drivers:SUV
   */
  private getClassSpatialKey(vehicleClass: VehicleClass): string {
    return `drivers:${vehicleClass}`;
  }

  /**
   * Key for global active drivers spatial index
   */
  private getActiveSpatialKey(): string {
    return 'drivers:active';
  }

  /**
   * Key for transient driver metadata hash
   */
  private getDriverMetaKey(driverId: string): string {
    return `driver:meta:${driverId}`;
  }

  /**
   * Ingests real-time driver telemetry:
   * 1. Updates vehicle-class spatial index (GEOADD drivers:<class> lng lat driverId)
   * 2. Updates global active spatial index (GEOADD drivers:active lng lat driverId)
   * 3. Sets transient metadata in driver:meta:<driverId> with a 15-second sliding TTL
   */
  async updateDriverLocation(
    driverId: string,
    lat: number,
    lng: number,
    vehicleClass: VehicleClass,
    bearing = 0,
    speed = 0,
    rideId?: string
  ): Promise<DriverMetadata> {
    const classKey = this.getClassSpatialKey(vehicleClass);
    const activeKey = this.getActiveSpatialKey();
    const metaKey = this.getDriverMetaKey(driverId);
    const now = Date.now();

    // 1. Write to vehicle class spatial index
    await this.redis.geoadd(classKey, lng, lat, driverId);

    // 2. Write to global active spatial index
    await this.redis.geoadd(activeKey, lng, lat, driverId);

    // 3. Store transient metadata in hash with sliding 15s TTL
    const metaPayload: Record<string, string | number> = {
      driverId,
      lat,
      lng,
      bearing,
      speed,
      status: rideId ? 'BUSY' : 'ONLINE',
      lastSeen: now,
      vehicleClass,
      rideId: rideId || '',
    };

    await this.redis.hset(metaKey, metaPayload);
    await this.redis.expire(metaKey, DRIVER_HEARTBEAT_TTL_SECONDS);

    return {
      driverId,
      lat,
      lng,
      bearing,
      speed,
      status: rideId ? 'BUSY' : 'ONLINE',
      lastSeen: now,
      vehicleClass,
      rideId: rideId || undefined,
    };
  }

  /**
   * Queries nearby active drivers within a given radius:
   * 1. Uses GEOSEARCH on drivers:<class> or drivers:active
   * 2. Hydrates with driver metadata from driver:meta:<driverId>
   * 3. Drops any driver whose metadata has expired (silence > 15s)
   */
  async getNearbyDrivers(
    lat: number,
    lng: number,
    radiusKm: number,
    vehicleClass?: VehicleClass
  ): Promise<HydratedDriverCandidate[]> {
    const searchKey = vehicleClass ? this.getClassSpatialKey(vehicleClass) : this.getActiveSpatialKey();

    const searchResults = await this.redis.geosearch(searchKey, lng, lat, radiusKm);
    if (searchResults.length === 0) {
      return [];
    }

    const hydratedList: HydratedDriverCandidate[] = [];

    // Hydrate candidates and filter out expired/silent drivers
    for (const res of searchResults) {
      const metaKey = this.getDriverMetaKey(res.member);
      const meta = await this.redis.hgetall(metaKey);

      if (!meta || Object.keys(meta).length === 0) {
        // Driver heartbeat expired! Clean up spatial set lazily
        await this.redis.zrem(searchKey, res.member);
        await this.redis.zrem(this.getActiveSpatialKey(), res.member);
        continue;
      }

      // Check status: ignore busy or offline drivers
      if (meta.status === 'OFFLINE' || meta.status === 'BUSY') {
        continue;
      }

      hydratedList.push({
        driverId: res.member,
        distanceKm: res.distanceKm,
        lat: parseFloat(meta.lat || String(res.lat)),
        lng: parseFloat(meta.lng || String(res.lng)),
        bearing: parseFloat(meta.bearing || '0'),
        speed: parseFloat(meta.speed || '0'),
        status: (meta.status as 'ONLINE' | 'OFFLINE' | 'BUSY') || 'ONLINE',
        vehicleClass: (meta.vehicleClass as VehicleClass) || VehicleClass.SEDAN,
        lastSeen: parseInt(meta.lastSeen || String(Date.now()), 10),
      });
    }

    return hydratedList;
  }

  /**
   * Retrieves current transient metadata for a driver
   */
  async getDriverMetadata(driverId: string): Promise<DriverMetadata | null> {
    const metaKey = this.getDriverMetaKey(driverId);
    const meta = await this.redis.hgetall(metaKey);
    if (!meta || Object.keys(meta).length === 0) {
      return null;
    }

    return {
      driverId,
      lat: parseFloat(meta.lat),
      lng: parseFloat(meta.lng),
      bearing: parseFloat(meta.bearing || '0'),
      speed: parseFloat(meta.speed || '0'),
      status: (meta.status as 'ONLINE' | 'OFFLINE' | 'BUSY') || 'ONLINE',
      lastSeen: parseInt(meta.lastSeen, 10),
      vehicleClass: (meta.vehicleClass as VehicleClass) || VehicleClass.SEDAN,
      rideId: meta.rideId && meta.rideId !== '' ? meta.rideId : undefined,
    };
  }

  /**
   * Sets driver duty status:
   * When switching to OFFLINE, removes driver from all spatial sets and clears active metadata.
   */
  async setDriverDutyStatus(driverId: string, status: 'ONLINE' | 'OFFLINE'): Promise<void> {
    const metaKey = this.getDriverMetaKey(driverId);
    const existingMeta = await this.redis.hgetall(metaKey);

    if (status === 'OFFLINE') {
      const activeKey = this.getActiveSpatialKey();
      await this.redis.zrem(activeKey, driverId);

      if (existingMeta && existingMeta.vehicleClass) {
        const classKey = this.getClassSpatialKey(existingMeta.vehicleClass as VehicleClass);
        await this.redis.zrem(classKey, driverId);
      }

      // Also clean up across all classes to prevent orphan indices
      await Promise.all([
        this.redis.zrem('drivers:BIKE', driverId),
        this.redis.zrem('drivers:SEDAN', driverId),
        this.redis.zrem('drivers:SUV', driverId),
      ]);

      await this.redis.del(metaKey);
    } else {
      if (existingMeta && Object.keys(existingMeta).length > 0) {
        await this.redis.hset(metaKey, { status: 'ONLINE' });
        await this.redis.expire(metaKey, DRIVER_HEARTBEAT_TTL_SECONDS);
      }
    }
  }

  /**
   * Hard eviction of an expired driver
   */
  async evictDriver(driverId: string, vehicleClass?: VehicleClass): Promise<void> {
    await this.redis.zrem(this.getActiveSpatialKey(), driverId);
    if (vehicleClass) {
      await this.redis.zrem(this.getClassSpatialKey(vehicleClass), driverId);
    } else {
      await Promise.all([
        this.redis.zrem('drivers:BIKE', driverId),
        this.redis.zrem('drivers:SEDAN', driverId),
        this.redis.zrem('drivers:SUV', driverId),
      ]);
    }
    await this.redis.del(this.getDriverMetaKey(driverId));
  }
}
