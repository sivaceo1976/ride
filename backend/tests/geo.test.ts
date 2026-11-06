import { describe, it, expect } from 'vitest';
import {
  calculateHaversineDistanceMeters,
  calculateHaversineDistanceKm,
  calculateBearing,
  coordinateToWkt,
  wktToCoordinate,
  coordinateToGeoJson,
  geoJsonToCoordinate,
  minDistanceToCorridor,
  latLngToH3Cell,
} from '../src/utils/geo.js';
import { PostGisHelper } from '../src/database/postgis.js';

describe('Geospatial Utilities & PostGIS Helpers', () => {
  const sfDowntown = { lat: 37.7925, lng: -122.4042 }; // Financial District SF
  const sfPier39 = { lat: 37.8087, lng: -122.4098 };   // Pier 39 SF

  it('should accurately calculate Haversine distance in meters and km', () => {
    const distMeters = calculateHaversineDistanceMeters(sfDowntown, sfPier39);
    const distKm = calculateHaversineDistanceKm(sfDowntown, sfPier39);

    // Distance between Financial District and Pier 39 is approx 1.87 km
    expect(distKm).toBeGreaterThan(1.7);
    expect(distKm).toBeLessThan(2.1);
    expect(distMeters).toBeCloseTo(distKm * 1000, 1);
  });

  it('should calculate correct bearing', () => {
    const origin = { lat: 0, lng: 0 };
    const north = { lat: 10, lng: 0 };
    const east = { lat: 0, lng: 10 };
    const south = { lat: -10, lng: 0 };
    const west = { lat: 0, lng: -10 };

    expect(calculateBearing(origin, north)).toBeCloseTo(0, 0);
    expect(calculateBearing(origin, east)).toBeCloseTo(90, 0);
    expect(calculateBearing(origin, south)).toBeCloseTo(180, 0);
    expect(calculateBearing(origin, west)).toBeCloseTo(270, 0);
  });

  it('should serialize and parse PostGIS WKT points accurately', () => {
    const wkt = coordinateToWkt(sfDowntown);
    expect(wkt).toBe('SRID=4326;POINT(-122.4042 37.7925)');

    const parsed = wktToCoordinate(wkt);
    expect(parsed.lat).toBeCloseTo(sfDowntown.lat, 4);
    expect(parsed.lng).toBeCloseTo(sfDowntown.lng, 4);
  });

  it('should serialize and parse GeoJSON Points accurately', () => {
    const geoJson = coordinateToGeoJson(sfDowntown);
    expect(geoJson.type).toBe('Point');
    expect(geoJson.coordinates).toEqual([-122.4042, 37.7925]);

    const parsed = geoJsonToCoordinate(geoJson);
    expect(parsed.lat).toBe(sfDowntown.lat);
    expect(parsed.lng).toBe(sfDowntown.lng);
  });

  it('should verify route corridor deviation (>500m threshold for safety agent)', () => {
    // Route corridor: Straight line from (37.77, -122.42) to (37.79, -122.42)
    const corridor = [
      { lat: 37.77, lng: -122.42 },
      { lat: 37.79, lng: -122.42 },
    ];

    // Point 1: Directly on the corridor (37.78, -122.42) -> deviation approx 0m
    const onCorridor = { lat: 37.78, lng: -122.42 };
    const distOn = minDistanceToCorridor(onCorridor, corridor);
    expect(distOn).toBeLessThan(10); // Less than 10 meters

    // Point 2: Slightly shifted (inside 500m safe corridor)
    // ~100m east: delta longitude ~0.0011
    const nearCorridor = { lat: 37.78, lng: -122.4189 };
    const distNear = minDistanceToCorridor(nearCorridor, corridor);
    expect(distNear).toBeLessThan(500);

    // Point 3: Deviated > 500m (unsafe deviation triggering anomaly alert)
    // ~1.5km east: delta longitude ~0.017
    const farOffCorridor = { lat: 37.78, lng: -122.403 };
    const distFar = minDistanceToCorridor(farOffCorridor, corridor);
    expect(distFar).toBeGreaterThan(500);
  });

  it('should generate valid H3 hex indices', () => {
    const h3Cell = latLngToH3Cell(37.7925, -122.4042, 8);
    expect(typeof h3Cell).toBe('string');
    expect(h3Cell.length).toBe(15);
  });

  it('should parse various database geometry representations via PostGisHelper', () => {
    // GeoJSON object format
    const fromGeoJson = PostGisHelper.parseDbGeometry({
      type: 'Point',
      coordinates: [-122.4042, 37.7925],
    });
    expect(fromGeoJson.lat).toBe(37.7925);
    expect(fromGeoJson.lng).toBe(-122.4042);

    // WKT format
    const fromWkt = PostGisHelper.parseDbGeometry('SRID=4326;POINT(-122.4042 37.7925)');
    expect(fromWkt.lat).toBe(37.7925);
    expect(fromWkt.lng).toBe(-122.4042);
  });
});
