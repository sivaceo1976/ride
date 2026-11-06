/**
 * Weekly Partition Management for `driver_telemetry` table.
 * Telemetry records are high-volume time-series data partitioned on recorded_at by ISO week.
 */

export interface WeekPartitionInfo {
  partitionName: string;
  startDate: Date;
  endDate: Date;
  isoWeek: number;
  isoYear: number;
}

/**
 * Returns ISO week number and ISO week-numbering year for a date.
 */
export function getIsoWeekDetails(date: Date): { isoYear: number; isoWeek: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  // Set to nearest Thursday: current date + 4 - current day number, make Sunday's day number 7
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { isoYear: d.getUTCFullYear(), isoWeek: weekNo };
}

/**
 * Calculates start of the ISO week (Monday 00:00:00.000 UTC) and end of the week (following Monday 00:00:00.000 UTC).
 */
export function getWeekPartitionInfo(date: Date): WeekPartitionInfo {
  const { isoYear, isoWeek } = getIsoWeekDetails(date);

  // Compute Monday 00:00:00 UTC of target ISO week
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const dayOfWeekJan4 = jan4.getUTCDay() || 7;
  const startOfWeek = new Date(jan4.getTime() - (dayOfWeekJan4 - 1) * 86400000 + (isoWeek - 1) * 7 * 86400000);
  startOfWeek.setUTCHours(0, 0, 0, 0);

  const endOfWeek = new Date(startOfWeek.getTime() + 7 * 86400000);

  const paddedWeek = isoWeek.toString().padStart(2, '0');
  const partitionName = `driver_telemetry_${isoYear}_w${paddedWeek}`;

  return {
    partitionName,
    startDate: startOfWeek,
    endDate: endOfWeek,
    isoWeek,
    isoYear,
  };
}

/**
 * Generates SQL DDL to create a weekly partition if it does not already exist.
 */
export function generatePartitionDdl(info: WeekPartitionInfo): string {
  const startIso = info.startDate.toISOString();
  const endIso = info.endDate.toISOString();

  return `
CREATE TABLE IF NOT EXISTS "${info.partitionName}" PARTITION OF "driver_telemetry"
    FOR VALUES FROM ('${startIso}') TO ('${endIso}');
  `.trim();
}

/**
 * Generates partition DDL statements for a given range of weeks (e.g. current week + next 4 weeks).
 */
export function generateUpcomingPartitionDdls(referenceDate: Date = new Date(), weeksCount = 4): string[] {
  const ddls: string[] = [];
  const processedPartitions = new Set<string>();

  for (let i = 0; i < weeksCount; i++) {
    const targetDate = new Date(referenceDate.getTime() + i * 7 * 86400000);
    const info = getWeekPartitionInfo(targetDate);

    if (!processedPartitions.has(info.partitionName)) {
      processedPartitions.add(info.partitionName);
      ddls.push(generatePartitionDdl(info));
    }
  }

  return ddls;
}
