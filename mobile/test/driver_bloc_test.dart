import 'package:flutter_test/flutter_test.dart';
import 'package:bloc_test/bloc_test.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:mocktail/mocktail.dart';
import 'package:dio/dio.dart';
import '../lib/core/network/api_client.dart';
import '../lib/core/network/websocket_client.dart';
import '../lib/features/driver/bloc/driver_bloc.dart';
import '../lib/features/driver/bloc/driver_event.dart';
import '../lib/features/driver/bloc/driver_state.dart';
import '../lib/features/driver/models/dispatch_offer_model.dart';

class MockApiClient extends Mock implements ApiClient {}
class MockWebSocketClient extends Mock implements WebSocketClient {}

void main() {
  late MockApiClient mockApiClient;
  late MockWebSocketClient mockWsClient;
  const driverId = 'd0000000-0000-4000-8000-000000000001';

  setUp(() {
    mockApiClient = MockApiClient();
    mockWsClient = MockWebSocketClient();
    when(() => mockWsClient.messages).thenAnswer((_) => const Stream.empty());
  });

  final mockOffer = DispatchOfferModel(
    rideId: 'r0000000-0000-4000-8000-000000000001',
    driverId: driverId,
    pickupLocation: const LatLng(37.7749, -122.4194),
    pickupAddress: 'Civic Center, SF',
    dropoffLocation: const LatLng(37.7925, -122.4042),
    dropoffAddress: 'Financial District, SF',
    estimatedFare: 18.50,
    estimatedDistanceKm: 3.2,
    estimatedDurationMin: 11.0,
    timeoutSeconds: 15,
    expiresAt: DateTime.now().millisecondsSinceEpoch + 15000,
  );

  group('DriverBloc Lifecycle & State Machine', () {
    test('initial state is DriverOffline', () {
      final bloc = DriverBloc(driverId: driverId, apiClient: mockApiClient, webSocketClient: mockWsClient);
      expect(bloc.state, isA<DriverOffline>());
      bloc.close();
    });

    blocTest<DriverBloc, DriverState>(
      'toggles duty: DriverOffline -> DriverOnline -> DriverOffline',
      build: () => DriverBloc(driverId: driverId, apiClient: mockApiClient, webSocketClient: mockWsClient),
      act: (bloc) {
        bloc.add(const DriverDutyToggled(isOnline: true));
        bloc.add(const DriverDutyToggled(isOnline: false));
      },
      expect: () => [
        isA<DriverOnline>(),
        isA<DriverOffline>(),
      ],
    );

    blocTest<DriverBloc, DriverState>(
      'emits OfferReceived when dispatch offer arrives',
      build: () => DriverBloc(driverId: driverId, apiClient: mockApiClient, webSocketClient: mockWsClient),
      seed: () => const DriverOnline(),
      act: (bloc) => bloc.add(DriverOfferReceived(offer: mockOffer)),
      expect: () => [
        isA<OfferReceived>().having((s) => s.offer.estimatedFare, 'estimatedFare', 18.50),
      ],
    );

    blocTest<DriverBloc, DriverState>(
      'auto-dismisses offer back to DriverOnline when 15-second timer expires',
      build: () => DriverBloc(driverId: driverId, apiClient: mockApiClient, webSocketClient: mockWsClient),
      seed: () => OfferReceived(offer: mockOffer, secondsRemaining: 1),
      act: (bloc) => bloc.add(DriverOfferTimeoutExpired(rideId: mockOffer.rideId)),
      expect: () => [
        isA<DriverOnline>(),
      ],
    );

    blocTest<DriverBloc, DriverState>(
      'transitions through OfferAccepted -> EnRoutePickup -> TripStarted -> TripFinished',
      build: () {
        when(() => mockApiClient.post<void>(any(), data: any(named: 'data')))
            .thenAnswer((_) async => Response(requestOptions: RequestOptions(path: '')));
        when(() => mockApiClient.post<Map<String, dynamic>>(any(), data: any(named: 'data')))
            .thenAnswer((_) async => Response(
                  data: {
                    'dropoffAddress': 'Financial District',
                    'fareBreakdown': {'totalFare': 18.50},
                  },
                  requestOptions: RequestOptions(path: ''),
                ));
        return DriverBloc(driverId: driverId, apiClient: mockApiClient, webSocketClient: mockWsClient);
      },
      seed: () => OfferReceived(offer: mockOffer),
      act: (bloc) async {
        // Driver accepts offer
        bloc.add(DriverOfferAcceptedSubmitted(rideId: mockOffer.rideId));
        await Future.delayed(const Duration(milliseconds: 10));

        // Driver marks arrived
        bloc.add(DriverArrivedAtPickupSubmitted(rideId: mockOffer.rideId));
        await Future.delayed(const Duration(milliseconds: 10));

        // Enters 4-digit OTP
        bloc.add(DriverVerifyOtpSubmitted(rideId: mockOffer.rideId, otp: '4821'));
        await Future.delayed(const Duration(milliseconds: 10));

        // Completes trip
        bloc.add(DriverCompleteTripSubmitted(rideId: mockOffer.rideId));
      },
      expect: () => [
        isA<OfferAccepted>(),
        isA<EnRoutePickup>().having((s) => s.hasArrived, 'hasArrived', false),
        isA<EnRoutePickup>().having((s) => s.hasArrived, 'hasArrived', true),
        isA<TripStarted>(),
        isA<TripFinished>().having((s) => s.totalEarnings, 'totalEarnings', 18.50),
      ],
    );
  });
}
