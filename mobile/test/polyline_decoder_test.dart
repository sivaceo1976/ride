import 'package:flutter_test/flutter_test.dart';
import '../lib/core/map/polyline_decoder.dart';

void main() {
  group('PolylineDecoder', () {
    test('should decode Google polyline string accurately', () {
      // Encoded polyline for: (38.5, -120.2), (40.7, -120.95), (43.252, -126.453)
      const encoded = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
      final points = PolylineDecoder.decode(encoded);

      expect(points.length, 3);
      expect(points[0].latitude, closeTo(38.5, 1e-4));
      expect(points[0].longitude, closeTo(-120.2, 1e-4));
      expect(points[1].latitude, closeTo(40.7, 1e-4));
      expect(points[1].longitude, closeTo(-120.95, 1e-4));
      expect(points[2].latitude, closeTo(43.252, 1e-4));
      expect(points[2].longitude, closeTo(-126.453, 1e-4));
    });
  });
}
