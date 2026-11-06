import 'package:flutter_test/flutter_test.dart';
import 'package:bloc_test/bloc_test.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:mocktail/mocktail.dart';
import 'package:dio/dio.dart';
import '../lib/core/network/api_client.dart';
import '../lib/core/network/websocket_client.dart';
import '../lib/features/rider/bloc/rider_bloc.dart';
import '../lib/features/rider/bloc/rider_event.dart';
import '../lib/features/rider/bloc/rider_state.dart';
import '../lib/features/rider/models/fare_estimate_model.dart';
import '../lib/features/rider/models/ride_model.dart';

class MockApiClient extends Mock implements ApiClient {}
class MockWebSocketClient extends Mock implements WebSocketClient {}

void main() {
  late MockApiClient mockApiClient;
  late MockWebSocketClient mockWsClient;

  setUp(() {
    mockApiClient = MockApiClient();
    mockWsClient = MockWebSocketClient();
    when(() => mockWsClient.messages).thenAnswer((_) => const Stream.empty());
  });

  group('RiderBloc Lifecycle & Transitions', () {
    test('initial state is RiderInitial', () {
      final bloc = RiderBloc(apiClient: mockApiClient, webSocketClient: mockWsClient);
      expect(bloc.state, isA<RiderInitial>());
      bloc.close();
    });

    blocTest<RiderBloc, RiderState>(
      'emits [RideBooking] when destination is selected',
      build: () => RiderBloc(apiClient: mockApiClient, webSocketClient: mockWsClient),
      act: (bloc) => bloc.add(const RiderDestinationSelected(
        pickupAddress: '555 California St, SF',
        pickupLocation: LatLng(37.7925, -122.4042),
        dropoffAddress: 'Pier 39, SF',
        dropoffLocation: LatLng(37.8087, -122.4098),
        vehicleClass: VehicleClass.sedan,
      )),
      expect: () => [
        isA<RideBooking>().having(
          (s) => s.fareEstimate.totalFare,
          'totalFare',
          greaterThan(0),
        ),
      ],
    );

    final mockRideJson = {
      'id': 'r0000000-0000-4000-8000-000000000001',
      'riderId': 'a0000000-0000-4000-8000-000000000001',
      'status': 'SEARCHING_DRIVER',
      'pickupAddress': '555 California St, SF',
      'pickupLocation': {'lat': 37.7925, 'lng': -122.4042},
      'dropoffAddress': 'Pier 39, SF',
      'dropoffLocation': {'lat': 37.8087, 'lng': -122.4098},
      'fareBreakdown': {
        'baseFare': 4.0,
        'perKmRate': 1.75,
        'distanceKm': 2.8,
        'distanceFare': 4.9,
        'perMinRate': 0.35,
        'durationMin': 9.0,
        'timeFare': 3.15,
        'surgeMultiplier': 1.0,
        'totalFare': 12.05,
        'currency': 'USD',
      },
      'otp': '4821',
      'surgeMultiplier': 1.0,
      'estimatedDistanceKm': 2.8,
      'estimatedDurationMin': 9.0,
    };

    blocTest<RiderBloc, RiderState>(
      'emits [RideSearching] when ride request is submitted successfully',
      build: () {
        when(() => mockApiClient.post<Map<String, dynamic>>(
              any(),
              data: any(named: 'data'),
            )).thenAnswer(
          (_) async => Response(
            data: mockRideJson,
            statusCode: 201,
            requestOptions: RequestOptions(path: '/rides/request'),
          ),
        );
        return RiderBloc(apiClient: mockApiClient, webSocketClient: mockWsClient);
      },
      act: (bloc) => bloc.add(const RiderRequestRideSubmitted(
        riderId: 'a0000000-0000-4000-8000-000000000001',
        pickupAddress: '555 California St, SF',
        pickupLocation: LatLng(37.7925, -122.4042),
        dropoffAddress: 'Pier 39, SF',
        dropoffLocation: LatLng(37.8087, -122.4098),
        vehicleClass: VehicleClass.sedan,
      )),
      expect: () => [
        isA<RideSearching>().having((s) => s.ride.id, 'id', 'r0000000-0000-4000-8000-000000000001'),
      ],
    );

    blocTest<RiderBloc, RiderState>(
      'transitions through RideSearching -> RideAssigned -> RideInTransit -> RideCompleted',
      build: () => RiderBloc(apiClient: mockApiClient, webSocketClient: mockWsClient),
      seed: () => RideSearching(ride: RideModel.fromJson(mockRideJson)),
      act: (bloc) {
        // Driver accepted
        bloc.add(const RiderDriverAssignedReceived(
          driverId: 'd0000000-0000-4000-8000-000000000001',
          driverLocation: LatLng(37.78, -122.41),
        ));
        // Driver arrived
        bloc.add(const RiderDriverArrivedReceived());
        // OTP entered -> trip started
        bloc.add(const RiderTripStartedReceived());
        // Completed
        bloc.add(RiderTripCompletedReceived(
          finalFare: FareBreakdownModel.fromJson(mockRideJson['fareBreakdown'] as Map<String, dynamic>),
        ));
      },
      expect: () => [
        isA<RideAssigned>().having((s) => s.driverId, 'driverId', 'd0000000-0000-4000-8000-000000000001'),
        isA<RideAssigned>().having((s) => s.driverArrived, 'driverArrived', true),
        isA<RideInTransit>().having((s) => s.ride.status, 'status', RideStatus.inTransit),
        isA<RideCompleted>().having((s) => s.finalFare.totalFare, 'totalFare', 12.05),
      ],
    );
  });
}
