import { VehicleClass } from '../../modules/vehicles/types.js';

export interface GeoSearchResult {
  member: string;
  distanceKm: number;
  lat: number;
  lng: number;
}

export interface DriverMetadata {
  driverId: string;
  lat: number;
  lng: number;
  bearing: number;
  speed: number;
  status: 'ONLINE' | 'OFFLINE' | 'BUSY';
  lastSeen: number;
  vehicleClass: VehicleClass;
  rideId?: string;
}

export interface HydratedDriverCandidate {
  driverId: string;
  distanceKm: number;
  lat: number;
  lng: number;
  bearing: number;
  speed: number;
  status: 'ONLINE' | 'OFFLINE' | 'BUSY';
  vehicleClass: VehicleClass;
  lastSeen: number;
}

export interface IRedisClient {
  geoadd(key: string, lng: number, lat: number, member: string): Promise<number>;
  geosearch(
    key: string,
    fromLng: number,
    fromLat: number,
    radiusKm: number
  ): Promise<GeoSearchResult[]>;
  hset(key: string, data: Record<string, string | number>): Promise<number>;
  hgetall(key: string): Promise<Record<string, string>>;
  expire(key: string, seconds: number): Promise<number>;
  ttl(key: string): Promise<number>;
  del(...keys: string[]): Promise<number>;
  zrem(key: string, ...members: string[]): Promise<number>;
  zrange(key: string, start: number, stop: number): Promise<string[]>;
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    mode?: string,
    duration?: number,
    flag?: string
  ): Promise<'OK' | null>;
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<any>;
  publish(channel: string, message: string): Promise<number>;
  subscribe(channel: string, handler: (channel: string, message: string) => void): Promise<void>;
  unsubscribe(channel: string): Promise<void>;
  keys(pattern: string): Promise<string[]>;
  ping(): Promise<string>;
  quit(): Promise<void>;
}
