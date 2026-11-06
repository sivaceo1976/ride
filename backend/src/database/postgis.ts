import { Coordinate, GeoPoint } from '../modules/rides/types.js';

export class PostGisHelper {
  /**
   * Generates PostGIS Point SQL expression for coordinates.
   * Longitude first (X), Latitude second (Y) per GIS standards.
   */
  static toPointExpression(lngParam: string | number, latParam: string | number): string {
    return `ST_SetSRID(ST_MakePoint(${lngParam}, ${latParam}), 4326)`;
  }

  /**
   * Generates PostGIS ST_DWithin expression for spherical radius filter in meters.
   */
  static dWithinExpression(
    columnName: string,
    centerLng: string | number,
    centerLat: string | number,
    radiusMeters: string | number
  ): string {
    return `ST_DWithin(${columnName}::geography, ST_SetSRID(ST_MakePoint(${centerLng}, ${centerLat}), 4326)::geography, ${radiusMeters})`;
  }

  /**
   * Generates PostGIS ST_Distance expression returning distance in meters.
   */
  static distanceMetersExpression(
    columnName: string,
    lng: string | number,
    lat: string | number
  ): string {
    return `ST_Distance(${columnName}::geography, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography)`;
  }

  /**
   * Wraps a geometry column with ST_AsGeoJSON to extract valid JSON directly from Postgres.
   */
  static asGeoJsonExpression(columnName: string): string {
    return `ST_AsGeoJSON(${columnName})::json`;
  }

  /**
   * Parses raw database return values (WKT string, GeoJSON object, or EWKB) into standard Coordinate { lat, lng }.
   */
  static parseDbGeometry(raw: unknown): Coordinate {
    if (!raw) {
      throw new Error('Cannot parse null or undefined geometry');
    }

    // Already a parsed GeoJSON object
    if (typeof raw === 'object' && raw !== null && 'coordinates' in raw) {
      const geo = raw as GeoPoint;
      return {
        lng: geo.coordinates[0],
        lat: geo.coordinates[1],
      };
    }

    // JSON string representation of GeoJSON
    if (typeof raw === 'string' && raw.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed.coordinates && Array.isArray(parsed.coordinates)) {
          return {
            lng: parsed.coordinates[0],
            lat: parsed.coordinates[1],
          };
        }
      } catch {
        // Fallback to WKT parsing below
      }
    }

    // WKT String: "0101000020E6100000..." (EWKB) or "POINT(lng lat)" or "SRID=4326;POINT(lng lat)"
    if (typeof raw === 'string') {
      const pointMatch = raw.match(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i);
      if (pointMatch) {
        return {
          lng: parseFloat(pointMatch[1]),
          lat: parseFloat(pointMatch[2]),
        };
      }
    }

    throw new Error(`Unrecognized geometry database output format: ${JSON.stringify(raw)}`);
  }
}
