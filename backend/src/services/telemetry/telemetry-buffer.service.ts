import { TelemetryPacket } from '../../modules/telemetry/types.js';
import { DbQueryRunner } from '../../database/seed.js';
import { latLngToH3Cell } from '../../utils/geo.js';
import { getWeekPartitionInfo, generatePartitionDdl } from '../../database/partitions.js';

export interface TelemetryBufferOptions {
  batchSize?: number;
  flushIntervalMs?: number;
}

export interface BufferedTelemetryItem extends TelemetryPacket {
  h3Index: string;
}

export class TelemetryBufferService {
  private buffer: BufferedTelemetryItem[] = [];
  private flushTimer?: NodeJS.Timeout;
  private isFlushing = false;
  private batchSize: number;
  private flushIntervalMs: number;

  constructor(
    private dbClient?: DbQueryRunner,
    options?: TelemetryBufferOptions
  ) {
    this.batchSize = options?.batchSize || 50;
    this.flushIntervalMs = options?.flushIntervalMs || 1000;

    this.startFlushInterval();
  }

  private startFlushInterval(): void {
    this.flushTimer = setInterval(() => {
      this.flush().catch((err) => {
        console.error('Error during scheduled telemetry buffer flush:', err);
      });
    }, this.flushIntervalMs);

    if (this.flushTimer.unref) {
      this.flushTimer.unref();
    }
  }

  /**
   * Pushes a new telemetry packet to the write-behind buffer.
   * If buffer exceeds batchSize, triggers an immediate asynchronous flush.
   */
  async push(packet: TelemetryPacket): Promise<void> {
    const h3Index = latLngToH3Cell(packet.lat, packet.lng, 8);
    this.buffer.push({
      ...packet,
      h3Index,
    });

    if (this.buffer.length >= this.batchSize && !this.isFlushing) {
      this.flush().catch((err) => {
        console.error('Error during immediate telemetry buffer flush:', err);
      });
    }
  }

  /**
   * Returns current buffer length
   */
  getBufferLength(): number {
    return this.buffer.length;
  }

  /**
   * Drains the buffer and writes batched records into PostgreSQL partitioned tables.
   */
  async flush(): Promise<number> {
    if (this.buffer.length === 0 || this.isFlushing) {
      return 0;
    }

    this.isFlushing = true;
    const itemsToFlush = [...this.buffer];
    this.buffer = [];

    try {
      if (this.dbClient) {
        // 1. Ensure partitions exist for all timestamps in the batch
        const partitionsChecked = new Set<string>();
        for (const item of itemsToFlush) {
          const recordedAt = new Date(item.timestamp);
          const partInfo = getWeekPartitionInfo(recordedAt);
          if (!partitionsChecked.has(partInfo.partitionName)) {
            partitionsChecked.add(partInfo.partitionName);
            const ddl = generatePartitionDdl(partInfo);
            await this.dbClient.query(ddl);
          }
        }

        // 2. Build multi-row parameterized bulk insert
        const valueClauses: string[] = [];
        const params: unknown[] = [];
        let paramIndex = 1;

        for (const item of itemsToFlush) {
          valueClauses.push(
            `($${paramIndex}, ST_SetSRID(ST_MakePoint($${paramIndex + 1}, $${paramIndex + 2}), 4326), $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5}, $${paramIndex + 6})`
          );
          params.push(
            item.driverId,
            item.lng, // X
            item.lat, // Y
            item.bearing,
            item.speed,
            item.h3Index,
            new Date(item.timestamp)
          );
          paramIndex += 7;
        }

        const sql = `
          INSERT INTO driver_telemetry (driver_id, location, bearing, speed, h3_index, recorded_at)
          VALUES ${valueClauses.join(', ')};
        `;

        await this.dbClient.query(sql, params);
      }

      return itemsToFlush.length;
    } catch (error) {
      // On failure, restore items to the buffer to prevent data loss
      this.buffer = [...itemsToFlush, ...this.buffer];
      throw error;
    } finally {
      this.isFlushing = false;
    }
  }

  /**
   * Stops the timer and flushes any remaining items
   */
  async close(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
    await this.flush();
  }
}
