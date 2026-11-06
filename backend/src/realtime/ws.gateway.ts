import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { RedisGeoService } from '../services/redis/geo.service.js';
import { RedisPubSubService } from '../services/redis/pubsub.service.js';
import { TelemetryBufferService } from '../services/telemetry/telemetry-buffer.service.js';
import { DriverWsMessageSchema, RiderWsMessageSchema } from './ws.types.js';
import { latLngToH3Cell } from '../utils/geo.js';
import { VehicleClass } from '../modules/vehicles/types.js';

interface AuthenticatedSocket extends WebSocket {
  isAlive: boolean;
  userId?: string;
  role?: 'DRIVER' | 'RIDER';
  cleanupHandlers?: Array<() => Promise<void> | void>;
}

export class RealtimeGateway {
  private driverWss: WebSocketServer;
  private riderWss: WebSocketServer;
  private heartbeatInterval?: NodeJS.Timeout;

  constructor(
    private server: http.Server,
    private geoService: RedisGeoService,
    private pubSubService: RedisPubSubService,
    private telemetryBuffer: TelemetryBufferService
  ) {
    // Independent WebSocket servers attached to HTTP upgrade routing
    this.driverWss = new WebSocketServer({ noServer: true });
    this.riderWss = new WebSocketServer({ noServer: true });

    this.setupUpgradeRouting();
    this.setupConnectionHandlers();
    this.startConnectionHeartbeats();
  }

  private setupUpgradeRouting(): void {
    this.server.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
      const pathname = url.pathname;

      // Extract authentication from Authorization header or query param
      const token = url.searchParams.get('token') || request.headers.authorization;
      const userId = url.searchParams.get('driverId') || url.searchParams.get('riderId') || 'anonymous-user';

      if (pathname === '/ws/driver') {
        this.driverWss.handleUpgrade(request, socket, head, (ws) => {
          const authWs = ws as AuthenticatedSocket;
          authWs.userId = userId;
          authWs.role = 'DRIVER';
          this.driverWss.emit('connection', authWs, request);
        });
      } else if (pathname === '/ws/rider') {
        this.riderWss.handleUpgrade(request, socket, head, (ws) => {
          const authWs = ws as AuthenticatedSocket;
          authWs.userId = userId;
          authWs.role = 'RIDER';
          this.riderWss.emit('connection', authWs, request);
        });
      } else {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
      }
    });
  }

  private setupConnectionHandlers(): void {
    // 1. Driver Channel Handler
    this.driverWss.on('connection', (ws: AuthenticatedSocket) => {
      ws.isAlive = true;
      ws.cleanupHandlers = [];

      ws.on('pong', () => {
        ws.isAlive = true;
      });

      ws.on('message', async (data: Buffer | string) => {
        try {
          const raw = JSON.parse(data.toString());
          const parseResult = DriverWsMessageSchema.safeParse(raw);

          if (!parseResult.success) {
            ws.send(JSON.stringify({ type: 'ERROR', message: 'Invalid payload format', details: parseResult.error.format() }));
            return;
          }

          const message = parseResult.data;

          if (message.type === 'PING') {
            ws.send(JSON.stringify({ type: 'PONG', timestamp: Date.now() }));
            return;
          }

          if (message.type === 'DUTY_STATUS') {
            await this.geoService.setDriverDutyStatus(message.driverId, message.status);
            ws.send(JSON.stringify({ type: 'DUTY_STATUS_ACK', status: message.status }));
            return;
          }

          if (message.type === 'TELEMETRY') {
            // Retrieve vehicle class from metadata if available, default to SEDAN
            const meta = await this.geoService.getDriverMetadata(message.driverId);
            const vehicleClass = meta?.vehicleClass || VehicleClass.SEDAN;

            // 1. Ingest into Redis spatial index & hash with 15s TTL
            await this.geoService.updateDriverLocation(
              message.driverId,
              message.lat,
              message.lng,
              vehicleClass,
              message.bearing,
              message.speed,
              message.rideId
            );

            // 2. Buffer for asynchronous PostgreSQL partitioned write-behind
            await this.telemetryBuffer.push({
              driverId: message.driverId,
              lat: message.lat,
              lng: message.lng,
              bearing: message.bearing,
              speed: message.speed,
              timestamp: message.timestamp,
            });

            // 3. Publish to distributed Redis Pub/Sub
            // A. Area broadcast by H3 hex cell
            const h3Cell = latLngToH3Cell(message.lat, message.lng, 8);
            await this.pubSubService.publishAreaTelemetry(h3Cell, {
              type: 'AREA_TELEMETRY',
              h3Cell,
              driverId: message.driverId,
              vehicleClass,
              lat: message.lat,
              lng: message.lng,
              bearing: message.bearing,
              speed: message.speed,
              timestamp: message.timestamp,
            });

            // B. If assigned to a ride, stream to active trip channel
            if (message.rideId) {
              await this.pubSubService.publishTripTelemetry(message.rideId, {
                type: 'TRIP_TELEMETRY',
                rideId: message.rideId,
                driverId: message.driverId,
                lat: message.lat,
                lng: message.lng,
                bearing: message.bearing,
                speed: message.speed,
                timestamp: message.timestamp,
              });
            }

            ws.send(JSON.stringify({ type: 'TELEMETRY_ACK', timestamp: Date.now() }));
          }
        } catch (err: any) {
          ws.send(JSON.stringify({ type: 'ERROR', message: err.message || 'Internal gateway error' }));
        }
      });

      ws.on('close', async () => {
        if (ws.cleanupHandlers) {
          for (const cleanup of ws.cleanupHandlers) {
            await cleanup();
          }
        }
      });
    });

    // 2. Rider Channel Handler
    this.riderWss.on('connection', (ws: AuthenticatedSocket) => {
      ws.isAlive = true;
      ws.cleanupHandlers = [];

      ws.on('pong', () => {
        ws.isAlive = true;
      });

      ws.on('message', async (data: Buffer | string) => {
        try {
          const raw = JSON.parse(data.toString());
          const parseResult = RiderWsMessageSchema.safeParse(raw);

          if (!parseResult.success) {
            ws.send(JSON.stringify({ type: 'ERROR', message: 'Invalid rider payload format', details: parseResult.error.format() }));
            return;
          }

          const message = parseResult.data;

          if (message.type === 'PING') {
            ws.send(JSON.stringify({ type: 'PONG', timestamp: Date.now() }));
            return;
          }

          if (message.type === 'SUBSCRIBE_NEARBY') {
            // Immediately return current snapshot of nearby drivers
            const nearby = await this.geoService.getNearbyDrivers(
              message.lat,
              message.lng,
              message.radiusKm,
              message.vehicleClass
            );

            ws.send(JSON.stringify({ type: 'NEARBY_DRIVERS', drivers: nearby }));

            // Subscribe to local H3 cell telemetry stream
            const h3Cell = latLngToH3Cell(message.lat, message.lng, 8);
            const unsub = await this.pubSubService.subscribeToArea(h3Cell, (areaTelemetry) => {
              if (ws.readyState === WebSocket.OPEN) {
                // Check if telemetry matches requested vehicle class (if specified)
                if (!message.vehicleClass || areaTelemetry.vehicleClass === message.vehicleClass) {
                  ws.send(JSON.stringify(areaTelemetry));
                }
              }
            });

            ws.cleanupHandlers?.push(unsub);
          }

          if (message.type === 'TRACK_TRIP') {
            // Subscribe to dedicated trip telemetry channel
            const unsubTrip = await this.pubSubService.subscribeToTrip(message.rideId, (tripTelemetry) => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(tripTelemetry));
              }
            });

            ws.cleanupHandlers?.push(unsubTrip);
            ws.send(JSON.stringify({ type: 'TRACKING_STARTED', rideId: message.rideId }));
          }

          if (message.type === 'UNTRACK_TRIP' || message.type === 'UNSUBSCRIBE_NEARBY') {
            if (ws.cleanupHandlers) {
              for (const cleanup of ws.cleanupHandlers) {
                await cleanup();
              }
              ws.cleanupHandlers = [];
            }
            ws.send(JSON.stringify({ type: 'UNSUBSCRIBED_ACK' }));
          }
        } catch (err: any) {
          ws.send(JSON.stringify({ type: 'ERROR', message: err.message || 'Internal gateway error' }));
        }
      });

      ws.on('close', async () => {
        if (ws.cleanupHandlers) {
          for (const cleanup of ws.cleanupHandlers) {
            await cleanup();
          }
        }
      });
    });
  }

  private startConnectionHeartbeats(): void {
    this.heartbeatInterval = setInterval(() => {
      this.driverWss.clients.forEach((client) => {
        const authWs = client as AuthenticatedSocket;
        if (!authWs.isAlive) {
          return authWs.terminate();
        }
        authWs.isAlive = false;
        authWs.ping();
      });

      this.riderWss.clients.forEach((client) => {
        const authWs = client as AuthenticatedSocket;
        if (!authWs.isAlive) {
          return authWs.terminate();
        }
        authWs.isAlive = false;
        authWs.ping();
      });
    }, 30000);

    if (this.heartbeatInterval.unref) {
      this.heartbeatInterval.unref();
    }
  }

  async close(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    this.driverWss.clients.forEach((client) => client.terminate());
    this.riderWss.clients.forEach((client) => client.terminate());
    await new Promise<void>((resolve) => this.driverWss.close(() => resolve()));
    await new Promise<void>((resolve) => this.riderWss.close(() => resolve()));
  }
}
