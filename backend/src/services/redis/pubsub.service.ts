import { IRedisClient } from './redis.interface.js';
import { TelemetryPacket } from '../../modules/telemetry/types.js';

export interface TripTelemetryBroadcast {
  type: 'TRIP_TELEMETRY';
  rideId: string;
  driverId: string;
  lat: number;
  lng: number;
  bearing: number;
  speed: number;
  timestamp: number;
}

export interface AreaTelemetryBroadcast {
  type: 'AREA_TELEMETRY';
  h3Cell: string;
  driverId: string;
  vehicleClass: string;
  lat: number;
  lng: number;
  bearing: number;
  speed: number;
  timestamp: number;
}

export class RedisPubSubService {
  constructor(private redis: IRedisClient) {}

  /**
   * Publishes high-frequency trip telemetry to active trip channel (trip:<rideId>)
   */
  async publishTripTelemetry(rideId: string, telemetry: TripTelemetryBroadcast): Promise<number> {
    const channel = `trip:${rideId}`;
    return this.redis.publish(channel, JSON.stringify(telemetry));
  }

  /**
   * Publishes driver location update to H3 hex cell channel (drivers:nearby:<h3_cell>)
   */
  async publishAreaTelemetry(h3Cell: string, telemetry: AreaTelemetryBroadcast): Promise<number> {
    const channel = `drivers:nearby:${h3Cell}`;
    return this.redis.publish(channel, JSON.stringify(telemetry));
  }

  /**
   * Subscribes a client/socket handler to a specific trip channel
   */
  async subscribeToTrip(
    rideId: string,
    handler: (telemetry: TripTelemetryBroadcast) => void
  ): Promise<() => Promise<void>> {
    const channel = `trip:${rideId}`;
    const wrappedHandler = (ch: string, message: string) => {
      if (ch === channel) {
        try {
          const parsed = JSON.parse(message);
          handler(parsed);
        } catch (err) {
          console.error(`Failed to parse trip telemetry JSON: ${message}`, err);
        }
      }
    };

    await this.redis.subscribe(channel, wrappedHandler);

    return async () => {
      await this.redis.unsubscribe(channel);
    };
  }

  /**
   * Subscribes a client/socket handler to an H3 area channel
   */
  async subscribeToArea(
    h3Cell: string,
    handler: (telemetry: AreaTelemetryBroadcast) => void
  ): Promise<() => Promise<void>> {
    const channel = `drivers:nearby:${h3Cell}`;
    const wrappedHandler = (ch: string, message: string) => {
      if (ch === channel) {
        try {
          const parsed = JSON.parse(message);
          handler(parsed);
        } catch (err) {
          console.error(`Failed to parse area telemetry JSON: ${message}`, err);
        }
      }
    };

    await this.redis.subscribe(channel, wrappedHandler);

    return async () => {
      await this.redis.unsubscribe(channel);
    };
  }

  /**
   * Publishes driver offline notification
   */
  async publishDriverOffline(driverId: string, vehicleClass?: string): Promise<number> {
    const channel = 'drivers:events:offline';
    return this.redis.publish(channel, JSON.stringify({ driverId, vehicleClass, timestamp: Date.now() }));
  }
}
