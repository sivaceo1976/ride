import 'dart:math';
import 'package:google_maps_flutter/google_maps_flutter.dart';

class MarkerInterpolation {
  /// Linearly interpolates between two LatLng positions using fraction t in [0, 1]
  static LatLng interpolatePosition(LatLng start, LatLng end, double t) {
    final clampedT = t.clamp(0.0, 1.0);
    final lat = start.latitude + (end.latitude - start.latitude) * clampedT;
    final lng = start.longitude + (end.longitude - start.longitude) * clampedT;
    return LatLng(lat, lng);
  }

  /// Interpolates rotation (bearing) along the shortest angular distance
  static double interpolateBearing(double startBearing, double endBearing, double t) {
    final clampedT = t.clamp(0.0, 1.0);
    var diff = (endBearing - startBearing) % 360.0;
    if (diff > 180.0) {
      diff -= 360.0;
    } else if (diff < -180.0) {
      diff += 360.0;
    }
    return (startBearing + diff * clampedT + 360.0) % 360.0;
  }

  /// Calculates forward azimuth bearing from [from] to [to] in degrees [0, 360)
  static double calculateBearing(LatLng from, LatLng to) {
    final lat1 = _toRadians(from.latitude);
    final lat2 = _toRadians(to.latitude);
    final dLng = _toRadians(to.longitude - from.longitude);

    final y = sin(dLng) * cos(lat2);
    final x = cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(dLng);

    final bearing = atan2(y, x);
    return (_toDegrees(bearing) + 360.0) % 360.0;
  }

  /// Computes distance in meters using the Haversine formula
  static double distanceMeters(LatLng p1, LatLng p2) {
    const earthRadius = 6371000.0;
    final lat1 = _toRadians(p1.latitude);
    final lat2 = _toRadians(p2.latitude);
    final dLat = _toRadians(p2.latitude - p1.latitude);
    final dLng = _toRadians(p2.longitude - p1.longitude);

    final a = sin(dLat / 2) * sin(dLat / 2) +
        cos(lat1) * cos(lat2) * sin(dLng / 2) * sin(dLng / 2);
    final c = 2 * atan2(sqrt(a), sqrt(1 - a));
    return earthRadius * c;
  }

  static double _toRadians(double degrees) => degrees * (pi / 180.0);
  static double _toDegrees(double radians) => radians * (180.0 / pi);
}
