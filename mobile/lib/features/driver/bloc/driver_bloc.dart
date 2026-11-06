import 'dart:async';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/websocket_client.dart';
import '../models/dispatch_offer_model.dart';
import 'driver_event.dart';
import 'driver_state.dart';

class DriverBloc extends Bloc<DriverEvent, DriverState> {
  final String driverId;
  final ApiClient apiClient;
  final WebSocketClient? webSocketClient;
  StreamSubscription<Map<String, dynamic>>? _wsSubscription;
  Timer? _countdownTimer;
  Timer? _telemetryTimer;

  DriverBloc({
    required this.driverId,
    required this.apiClient,
    this.webSocketClient,
  }) : super(const DriverOffline()) {
    on<DriverDutyToggled>(_onDutyToggled);
    on<DriverLocationPushed>(_onLocationPushed);
    on<DriverOfferReceived>(_onOfferReceived);
    on<DriverOfferAcceptedSubmitted>(_onOfferAccepted);
    on<DriverOfferDeclinedSubmitted>(_onOfferDeclined);
    on<DriverOfferTimeoutExpired>(_onOfferTimeout);
    on<DriverArrivedAtPickupSubmitted>(_onArrivedAtPickup);
    on<DriverVerifyOtpSubmitted>(_onVerifyOtp);
    on<DriverCompleteTripSubmitted>(_onCompleteTrip);

    _listenToWebSocket();
  }

  void _listenToWebSocket() {
    _wsSubscription = webSocketClient?.messages.listen((msg) {
      final type = msg['type']?.toString();

      if (type == 'RIDE_OFFER') {
        final offer = DispatchOfferModel.fromJson(msg);
        add(DriverOfferReceived(offer: offer));
      }
    });
  }

  void _onDutyToggled(
    DriverDutyToggled event,
    Emitter<DriverState> emit,
  ) {
    if (event.isOnline) {
      emit(const DriverOnline());
      webSocketClient?.send({
        'type': 'DUTY_STATUS',
        'driverId': driverId,
        'status': 'ONLINE',
      });
      _startTelemetryStream();
    } else {
      _stopTelemetryStream();
      _countdownTimer?.cancel();
      webSocketClient?.send({
        'type': 'DUTY_STATUS',
        'driverId': driverId,
        'status': 'OFFLINE',
      });
      emit(const DriverOffline());
    }
  }

  void _startTelemetryStream() {
    _telemetryTimer?.cancel();
    _telemetryTimer = Timer.periodic(const Duration(seconds: 3), (_) {
      if (state is DriverOnline) {
        final s = state as DriverOnline;
        if (s.currentLocation != null) {
          webSocketClient?.send({
            'type': 'TELEMETRY',
            'driverId': driverId,
            'lat': s.currentLocation!.latitude,
            'lng': s.currentLocation!.longitude,
            'bearing': s.bearing,
            'speed': s.speed,
            'timestamp': DateTime.now().millisecondsSinceEpoch,
          });
        }
      }
    });
  }

  void _stopTelemetryStream() {
    _telemetryTimer?.cancel();
    _telemetryTimer = null;
  }

  void _onLocationPushed(
    DriverLocationPushed event,
    Emitter<DriverState> emit,
  ) {
    if (state is DriverOnline) {
      final s = state as DriverOnline;
      emit(s.copyWith(
        currentLocation: event.location,
        bearing: event.bearing,
        speed: event.speed,
      ));
    }
  }

  void _onOfferReceived(
    DriverOfferReceived event,
    Emitter<DriverState> emit,
  ) {
    _countdownTimer?.cancel();
    emit(OfferReceived(offer: event.offer, secondsRemaining: event.offer.timeoutSeconds));

    // 15-second countdown timer
    _countdownTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (state is OfferReceived) {
        final currentRemaining = (state as OfferReceived).secondsRemaining;
        if (currentRemaining <= 1) {
          timer.cancel();
          add(DriverOfferTimeoutExpired(rideId: event.offer.rideId));
        } else {
          emit((state as OfferReceived).copyWith(secondsRemaining: currentRemaining - 1));
        }
      } else {
        timer.cancel();
      }
    });
  }

  Future<void> _onOfferAccepted(
    DriverOfferAcceptedSubmitted event,
    Emitter<DriverState> emit,
  ) async {
    _countdownTimer?.cancel();
    if (state is OfferReceived) {
      final offer = (state as OfferReceived).offer;
      try {
        await apiClient.post<void>(
          '/rides/${event.rideId}/accept',
          data: {'driverId': driverId},
        );

        emit(OfferAccepted(
          rideId: event.rideId,
          pickupLocation: offer.pickupLocation,
          pickupAddress: offer.pickupAddress,
        ));

        // Immediately transition to EnRoutePickup
        emit(EnRoutePickup(
          rideId: event.rideId,
          pickupLocation: offer.pickupLocation,
          pickupAddress: offer.pickupAddress,
        ));
      } catch (e) {
        emit(DriverFailure(error: e.toString()));
      }
    }
  }

  Future<void> _onOfferDeclined(
    DriverOfferDeclinedSubmitted event,
    Emitter<DriverState> emit,
  ) async {
    _countdownTimer?.cancel();
    try {
      await apiClient.post<void>(
        '/rides/${event.rideId}/reject',
        data: {'driverId': driverId},
      );
    } catch (_) {
      // Best effort
    }
    emit(const DriverOnline());
  }

  void _onOfferTimeout(
    DriverOfferTimeoutExpired event,
    Emitter<DriverState> emit,
  ) {
    _countdownTimer?.cancel();
    emit(const DriverOnline());
  }

  Future<void> _onArrivedAtPickup(
    DriverArrivedAtPickupSubmitted event,
    Emitter<DriverState> emit,
  ) async {
    if (state is EnRoutePickup) {
      try {
        await apiClient.post<void>(
          '/rides/${event.rideId}/arrived',
          data: {'driverId': driverId},
        );
        emit((state as EnRoutePickup).copyWith(hasArrived: true));
      } catch (e) {
        emit(DriverFailure(error: e.toString()));
      }
    }
  }

  Future<void> _onVerifyOtp(
    DriverVerifyOtpSubmitted event,
    Emitter<DriverState> emit,
  ) async {
    if (state is EnRoutePickup) {
      final current = state as EnRoutePickup;
      try {
        final response = await apiClient.post<Map<String, dynamic>>(
          '/rides/${event.rideId}/start',
          data: {'driverId': driverId, 'otp': event.otp},
        );

        final dropoff = response.data?['dropoffLocation'] as Map<String, dynamic>?;
        final lat = (dropoff?['lat'] as num?)?.toDouble() ?? current.pickupLocation.latitude;
        final lng = (dropoff?['lng'] as num?)?.toDouble() ?? current.pickupLocation.longitude;
        final dropoffAddress = response.data?['dropoffAddress']?.toString() ?? 'Destination';

        emit(TripStarted(
          rideId: event.rideId,
          dropoffLocation: current.pickupLocation,
          dropoffAddress: dropoffAddress,
        ));
      } catch (e) {
        emit(DriverFailure(error: 'Invalid OTP. Please verify with rider.'));
      }
    }
  }

  Future<void> _onCompleteTrip(
    DriverCompleteTripSubmitted event,
    Emitter<DriverState> emit,
  ) async {
    if (state is TripStarted) {
      try {
        final response = await apiClient.post<Map<String, dynamic>>(
          '/rides/${event.rideId}/complete',
          data: {'driverId': driverId},
        );

        final fare = response.data?['fareBreakdown'] as Map<String, dynamic>?;
        final total = (fare?['totalFare'] as num?)?.toDouble() ?? 25.0;

        emit(TripFinished(
          rideId: event.rideId,
          totalEarnings: total,
        ));
      } catch (e) {
        emit(DriverFailure(error: e.toString()));
      }
    }
  }

  @override
  Future<void> close() {
    _countdownTimer?.cancel();
    _telemetryTimer?.cancel();
    _wsSubscription?.cancel();
    return super.close();
  }
}
