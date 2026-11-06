import 'dart:async';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/websocket_client.dart';
import '../../../core/map/marker_interpolation.dart';
import '../models/fare_estimate_model.dart';
import '../models/ride_model.dart';
import 'rider_event.dart';
import 'rider_state.dart';

class RiderBloc extends Bloc<RiderEvent, RiderState> {
  final ApiClient apiClient;
  final WebSocketClient? webSocketClient;
  StreamSubscription<Map<String, dynamic>>? _wsSubscription;

  RiderBloc({
    required this.apiClient,
    this.webSocketClient,
  }) : super(const RiderInitial()) {
    on<RiderDestinationSelected>(_onDestinationSelected);
    on<RiderRequestRideSubmitted>(_onRequestRideSubmitted);
    on<RiderDriverAssignedReceived>(_onDriverAssigned);
    on<RiderDriverLocationUpdatedReceived>(_onDriverLocationUpdated);
    on<RiderDriverArrivedReceived>(_onDriverArrived);
    on<RiderTripStartedReceived>(_onTripStarted);
    on<RiderSafetyAlertReceived>(_onSafetyAlertReceived);
    on<RiderTripCompletedReceived>(_onTripCompleted);
    on<RiderCancelRideSubmitted>(_onCancelRide);

    _listenToWebSocket();
  }

  void _listenToWebSocket() {
    _wsSubscription = webSocketClient?.messages.listen((msg) {
      final type = msg['type']?.toString();

      if (type == 'TRIP_TELEMETRY') {
        final lat = (msg['lat'] as num).toDouble();
        final lng = (msg['lng'] as num).toDouble();
        final bearing = (msg['bearing'] as num?)?.toDouble() ?? 0.0;
        final speed = (msg['speed'] as num?)?.toDouble() ?? 0.0;

        add(RiderDriverLocationUpdatedReceived(
          driverLocation: LatLng(lat, lng),
          bearing: bearing,
          speed: speed,
        ));
      } else if (type == 'RIDE_ACCEPTED') {
        final driverId = msg['driverId'].toString();
        final lat = (msg['lat'] as num).toDouble();
        final lng = (msg['lng'] as num).toDouble();
        add(RiderDriverAssignedReceived(
          driverId: driverId,
          driverLocation: LatLng(lat, lng),
        ));
      } else if (type == 'DRIVER_ARRIVED') {
        add(const RiderDriverArrivedReceived());
      } else if (type == 'TRIP_STARTED') {
        add(const RiderTripStartedReceived());
      } else if (type == 'SAFETY_CORRIDOR_DEVIATION') {
        add(RiderSafetyAlertReceived(
          alertType: 'CORRIDOR_DEVIATION',
          deviationMeters: (msg['deviationMeters'] as num?)?.toDouble() ?? 500.0,
        ));
      }
    });
  }

  void _onDestinationSelected(
    RiderDestinationSelected event,
    Emitter<RiderState> emit,
  ) {
    // Compute local upfront fare estimate
    final distanceMeters = MarkerInterpolation.distanceMeters(
      event.pickupLocation,
      event.dropoffLocation,
    );
    final distanceKm = distanceMeters / 1000.0;
    final durationMin = (distanceKm / 28.0) * 60.0;

    final rates = {
      VehicleClass.bike: {'base': 2.5, 'km': 1.0, 'min': 0.2},
      VehicleClass.sedan: {'base': 4.0, 'km': 1.75, 'min': 0.35},
      VehicleClass.suv: {'base': 7.0, 'km': 2.5, 'min': 0.5},
    };

    final rate = rates[event.vehicleClass]!;
    final baseFare = rate['base']!;
    final distanceFare = distanceKm * rate['km']!;
    final timeFare = durationMin * rate['min']!;
    final totalFare = baseFare + distanceFare + timeFare;

    final estimate = FareBreakdownModel(
      baseFare: baseFare,
      perKmRate: rate['km']!,
      distanceKm: distanceKm,
      distanceFare: distanceFare,
      perMinRate: rate['min']!,
      durationMin: durationMin,
      timeFare: timeFare,
      surgeMultiplier: 1.0,
      totalFare: totalFare,
      currency: 'USD',
    );

    emit(RideBooking(
      pickupAddress: event.pickupAddress,
      pickupLocation: event.pickupLocation,
      dropoffAddress: event.dropoffAddress,
      dropoffLocation: event.dropoffLocation,
      vehicleClass: event.vehicleClass,
      fareEstimate: estimate,
    ));
  }

  Future<void> _onRequestRideSubmitted(
    RiderRequestRideSubmitted event,
    Emitter<RiderState> emit,
  ) async {
    try {
      final response = await apiClient.post<Map<String, dynamic>>(
        '/rides/request',
        data: {
          'riderId': event.riderId,
          'pickupAddress': event.pickupAddress,
          'pickupLocation': {
            'lat': event.pickupLocation.latitude,
            'lng': event.pickupLocation.longitude,
          },
          'dropoffAddress': event.dropoffAddress,
          'dropoffLocation': {
            'lat': event.dropoffLocation.latitude,
            'lng': event.dropoffLocation.longitude,
          },
          'vehicleClass': event.vehicleClass.name.toUpperCase(),
        },
      );

      final ride = RideModel.fromJson(response.data!);
      emit(RideSearching(ride: ride));

      // Subscribe to trip WebSocket
      webSocketClient?.send({
        'type': 'TRACK_TRIP',
        'rideId': ride.id,
      });
    } catch (e) {
      emit(RideFailure(error: e.toString()));
    }
  }

  void _onDriverAssigned(
    RiderDriverAssignedReceived event,
    Emitter<RiderState> emit,
  ) {
    if (state is RideSearching) {
      final currentRide = (state as RideSearching).ride;
      final updatedRide = currentRide.copyWith(
        driverId: event.driverId,
        status: RideStatus.accepted,
      );
      emit(RideAssigned(
        ride: updatedRide,
        driverLocation: event.driverLocation,
        driverBearing: event.bearing,
      ));
    }
  }

  void _onDriverLocationUpdated(
    RiderDriverLocationUpdatedReceived event,
    Emitter<RiderState> emit,
  ) {
    if (state is RideAssigned) {
      final s = state as RideAssigned;
      emit(s.copyWith(
        driverLocation: event.driverLocation,
        driverBearing: event.bearing,
      ));
    } else if (state is RideInTransit) {
      final s = state as RideInTransit;
      emit(s.copyWith(
        driverLocation: event.driverLocation,
        driverBearing: event.bearing,
        speed: event.speed,
      ));
    }
  }

  void _onDriverArrived(
    RiderDriverArrivedReceived event,
    Emitter<RiderState> emit,
  ) {
    if (state is RideAssigned) {
      final s = state as RideAssigned;
      emit(s.copyWith(driverArrived: true));
    }
  }

  void _onTripStarted(
    RiderTripStartedReceived event,
    Emitter<RiderState> emit,
  ) {
    if (state is RideAssigned) {
      final s = state as RideAssigned;
      final inTransitRide = s.ride.copyWith(status: RideStatus.inTransit);
      emit(RideInTransit(
        ride: inTransitRide,
        driverLocation: s.driverLocation,
        driverBearing: s.driverBearing,
        speed: 0.0,
      ));
    }
  }

  void _onSafetyAlertReceived(
    RiderSafetyAlertReceived event,
    Emitter<RiderState> emit,
  ) {
    final alertMsg = 'Safety Alert: ${event.alertType} (Deviated ${event.deviationMeters.round()}m)';
    if (state is RideInTransit) {
      final s = state as RideInTransit;
      emit(s.copyWith(activeSafetyAlert: alertMsg));
    } else if (state is RideAssigned) {
      final s = state as RideAssigned;
      emit(s.copyWith(activeSafetyAlert: alertMsg));
    }
  }

  void _onTripCompleted(
    RiderTripCompletedReceived event,
    Emitter<RiderState> emit,
  ) {
    if (state is RideInTransit) {
      final s = state as RideInTransit;
      final completedRide = s.ride.copyWith(status: RideStatus.completed);
      emit(RideCompleted(
        ride: completedRide,
        finalFare: event.finalFare,
      ));
    }
  }

  Future<void> _onCancelRide(
    RiderCancelRideSubmitted event,
    Emitter<RiderState> emit,
  ) async {
    RideModel? targetRide;
    if (state is RideSearching) targetRide = (state as RideSearching).ride;
    if (state is RideAssigned) targetRide = (state as RideAssigned).ride;

    if (targetRide != null) {
      try {
        await apiClient.post<void>(
          '/rides/${targetRide.id}/cancel',
          data: {'cancelledBy': 'RIDER', 'reason': event.reason},
        );
        emit(const RiderInitial());
      } catch (e) {
        emit(RideFailure(error: e.toString()));
      }
    }
  }

  @override
  Future<void> close() {
    _wsSubscription?.cancel();
    return super.close();
  }
}
