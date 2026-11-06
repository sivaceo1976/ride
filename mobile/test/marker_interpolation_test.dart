import 'package:flutter_test/flutter_test.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import '../lib/core/map/marker_interpolation.dart';

void main() {
  group('MarkerInterpolation', () {
    const start = LatLng(37.7749, -122.4194);
    const end = LatLng(37.7849, -122.4094);

    test('should linearly interpolate coordinates at t = 0, 0.5, 1.0', () {
      final p0 = MarkerInterpolation.interpolatePosition(start, end, 0.0);
      expect(p0.latitude, closeTo(start.latitude, 1e-5));
      expect(p0.longitude, closeTo(start.longitude, 1e-5));

      final pMid = MarkerInterpolation.interpolatePosition(start, end, 0.5);
      expect(pMid.latitude, closeTo((start.latitude + end.latitude) / 2, 1e-5));
      expect(pMid.longitude, closeTo((start.longitude + end.longitude) / 2, 1e-5));

      final p1 = MarkerInterpolation.interpolatePosition(start, end, 1.0);
      expect(p1.latitude, closeTo(end.latitude, 1e-5));
      expect(p1.longitude, closeTo(end.longitude, 1e-5));
    });

    test('should interpolate bearing along the shortest angular arc', () {
      // 350 deg to 10 deg (shortest is across 0, not 340 deg backwards)
      final midBearing = MarkerInterpolation.interpolateBearing(350.0, 10.0, 0.5);
      expect(midBearing, closeTo(0.0, 1e-2));
    });

    test('should accurately calculate Haversine distance and azimuth bearing', () {
      const p1 = LatLng(0.0, 0.0);
      const pNorth = LatLng(1.0, 0.0);
      const pEast = LatLng(0.0, 1.0);

      expect(MarkerInterpolation.calculateBearing(p1, pNorth), closeTo(0.0, 1e-1));
      expect(MarkerInterpolation.calculateBearing(p1, pEast), closeTo(90.0, 1e-1));

      final dist = MarkerInterpolation.distanceMeters(p1, pNorth);
      expect(dist, greaterThan(110000)); // ~111 km
      expect(dist, lessThan(112000));
    });
  });
}
