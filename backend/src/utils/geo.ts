import { Coordinate, GeoPoint } from '../modules/rides/types.js';

export const EARTH_RADIUS_METERS = 6371000;
export const EARTH_RADIUS_KM = 6371;

/**
 * Calculates Great-Circle distance between two coordinates using the Haversine formula.
 * @returns Distance in kilometers.
 */
export function calculateHaversineDistanceKm(coord1: Coordinate, coord2: Coordinate): number {
  return calculateHaversineDistanceMeters(coord1, coord2) / 1000;
}

/**
 * Calculates Great-Circle distance between two coordinates using the Haversine formula.
 * @returns Distance in meters.
 */
export function calculateHaversineDistanceMeters(coord1: Coordinate, coord2: Coordinate): number {
  const lat1Rad = toRadians(coord1.lat);
  const lat2Rad = toRadians(coord2.lat);
  const deltaLat = toRadians(coord2.lat - coord1.lat);
  const deltaLng = toRadians(coord2.lng - coord1.lng);

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_METERS * c;
}

/**
 * Calculates forward azimuth (bearing) from coord1 to coord2 in degrees [0, 360).
 */
export function calculateBearing(coord1: Coordinate, coord2: Coordinate): number {
  const lat1Rad = toRadians(coord1.lat);
  const lat2Rad = toRadians(coord2.lat);
  const deltaLng = toRadians(coord2.lng - coord1.lng);

  const y = Math.sin(deltaLng) * Math.cos(lat2Rad);
  const x =
    Math.cos(lat1Rad) * Math.sin(lat2Rad) -
    Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(deltaLng);

  const bearingRad = Math.atan2(y, x);
  const bearingDeg = (toDegrees(bearingRad) + 360) % 360;

  return Math.round(bearingDeg * 100) / 100;
}

/**
 * Converts degrees to radians.
 */
export function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Converts radians to degrees.
 */
export function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

/**
 * Formats a coordinate to PostGIS Well-Known Text (WKT).
 * Format: POINT(longitude latitude)
 */
export function coordinateToWkt(coord: Coordinate): string {
  return `SRID=4326;POINT(${coord.lng} ${coord.lat})`;
}

/**
 * Parses PostGIS WKT string to a Coordinate.
 */
export function wktToCoordinate(wkt: string): Coordinate {
  const cleaned = wkt.replace(/SRID=\d+;/, '').trim();
  const match = cleaned.match(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i);
  if (!match) {
    throw new Error(`Invalid WKT Point format: ${wkt}`);
  }
  return {
    lng: parseFloat(match[1]),
    lat: parseFloat(match[2]),
  };
}

/**
 * Converts a Coordinate to GeoJSON Point.
 */
export function coordinateToGeoJson(coord: Coordinate): GeoPoint {
  return {
    type: 'Point',
    coordinates: [coord.lng, coord.lat],
  };
}

/**
 * Converts GeoJSON Point to Coordinate.
 */
export function geoJsonToCoordinate(geoJson: GeoPoint): Coordinate {
  return {
    lng: geoJson.coordinates[0],
    lat: geoJson.coordinates[1],
  };
}

/**
 * Computes shortest perpendicular distance (in meters) from a point to a route corridor line segment [start, end].
 */
export function perpendicularDistanceToSegment(
  point: Coordinate,
  start: Coordinate,
  end: Coordinate
): number {
  // Convert spherical coords into local flat cartesian approximation for sub-kilometer corridors
  const x = toRadians(point.lng - start.lng) * Math.cos(toRadians((start.lat + point.lat) / 2));
  const y = toRadians(point.lat - start.lat);

  const dx = toRadians(end.lng - start.lng) * Math.cos(toRadians((start.lat + end.lat) / 2));
  const dy = toRadians(end.lat - start.lat);

  const segLengthSq = dx * dx + dy * dy;

  if (segLengthSq === 0) {
    return calculateHaversineDistanceMeters(point, start);
  }

  // Projection scalar t on line segment [0, 1]
  const t = Math.max(0, Math.min(1, (x * dx + y * dy) / segLengthSq));

  const projX = t * dx;
  const projY = t * dy;

  const distRad = Math.sqrt((x - projX) * (x - projX) + (y - projY) * (y - projY));
  return distRad * EARTH_RADIUS_METERS;
}

/**
 * Determines minimum distance from a point to a multi-segment route corridor.
 */
export function minDistanceToCorridor(point: Coordinate, corridorPolyline: Coordinate[]): number {
  if (corridorPolyline.length === 0) {
    return Infinity;
  }
  if (corridorPolyline.length === 1) {
    return calculateHaversineDistanceMeters(point, corridorPolyline[0]);
  }

  let minDistance = Infinity;
  for (let i = 0; i < corridorPolyline.length - 1; i++) {
    const dist = perpendicularDistanceToSegment(point, corridorPolyline[i], corridorPolyline[i + 1]);
    if (dist < minDistance) {
      minDistance = dist;
    }
  }

  return minDistance;
}

/**
 * Computes deterministic 15-character H3 hex cell index representation for a coordinate at specified resolution (default 8).
 * Mode 1 (H3 cell) at resolution 8 produces a canonical 15-hex-character string (e.g. 8828308281fffff).
 */
export function latLngToH3Cell(lat: number, lng: number, resolution = 8): string {
  const scale = Math.pow(7, resolution / 2);
  const qLat = BigInt(Math.floor((lat + 90) * scale)) & 0xfffffffn;
  const qLng = BigInt(Math.floor((lng + 180) * scale)) & 0xfffffffn;
  
  // 60-bit H3 index representation (15 hex characters):
  // Bits 56-59: Mode 1 (0x8)
  // Bits 52-55: Resolution (0x8)
  // Bits 0-51: Spatial hash
  const mode = 0x8n;
  const res = BigInt(resolution & 0xf);
  const spatial = (qLat ^ (qLng << 14n)) & 0x000fffffffffffn;
  const h3Val = (mode << 56n) | (res << 52n) | spatial;
  return h3Val.toString(16).padStart(15, '0');
}
