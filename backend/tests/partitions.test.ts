import { describe, it, expect } from 'vitest';
import {
  getIsoWeekDetails,
  getWeekPartitionInfo,
  generatePartitionDdl,
  generateUpcomingPartitionDdls,
} from '../src/database/partitions.js';

describe('PostgreSQL Weekly Telemetry Partitioning', () => {
  it('should compute correct ISO week and partition name for a given date', () => {
    // 2026-11-06 is Friday in Week 45 of 2026
    const date = new Date('2026-11-06T12:00:00Z');
    const { isoYear, isoWeek } = getIsoWeekDetails(date);
    expect(isoYear).toBe(2026);
    expect(isoWeek).toBe(45);

    const info = getWeekPartitionInfo(date);
    expect(info.partitionName).toBe('driver_telemetry_2026_w45');
    // Start of week 45 should be Monday 2026-11-02 00:00:00 UTC
    expect(info.startDate.toISOString()).toBe('2026-11-02T00:00:00.000Z');
    // End of week 45 should be Monday 2026-11-09 00:00:00 UTC
    expect(info.endDate.toISOString()).toBe('2026-11-09T00:00:00.000Z');
  });

  it('should generate valid PostgreSQL PARTITION OF DDL', () => {
    const date = new Date('2026-11-06T12:00:00Z');
    const info = getWeekPartitionInfo(date);
    const ddl = generatePartitionDdl(info);

    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS "driver_telemetry_2026_w45"');
    expect(ddl).toContain('PARTITION OF "driver_telemetry"');
    expect(ddl).toContain("FOR VALUES FROM ('2026-11-02T00:00:00.000Z') TO ('2026-11-09T00:00:00.000Z')");
  });

  it('should generate sequential partition DDLs for upcoming weeks ahead', () => {
    const baseDate = new Date('2026-11-06T12:00:00Z');
    const ddls = generateUpcomingPartitionDdls(baseDate, 4);

    expect(ddls.length).toBe(4);
    expect(ddls[0]).toContain('driver_telemetry_2026_w45');
    expect(ddls[1]).toContain('driver_telemetry_2026_w46');
    expect(ddls[2]).toContain('driver_telemetry_2026_w47');
    expect(ddls[3]).toContain('driver_telemetry_2026_w48');
  });
});
