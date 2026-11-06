import 'package:equatable/equatable.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import '../models/dispatch_offer_model.dart';

abstract class DriverState extends Equatable {
  const DriverState();

  @override
  List<Object?> get props => [];
}

class DriverOffline extends DriverState {
  const DriverOffline();
}

class DriverOnline extends DriverState {
  final LatLng? currentLocation;
  final double bearing;
  final double speed;

  const DriverOnline({
    this.currentLocation,
    this.bearing = 0.0,
    this.speed = 0.0,
  });

  DriverOnline copyWith({
    LatLng? currentLocation,
    double? bearing,
    double? speed,
  }) {
    return DriverOnline(
      currentLocation: currentLocation ?? this.currentLocation,
      bearing: bearing ?? this.bearing,
      speed: speed ?? this.speed,
    );
  }

  @override
  List<Object?> get props => [currentLocation, bearing, speed];
}

class OfferReceived extends DriverState {
  final DispatchOfferModel offer;
  final int secondsRemaining;

  const OfferReceived({
    required this.offer,
    this.secondsRemaining = 15,
  });

  OfferReceived copyWith({int? secondsRemaining}) {
    return OfferReceived(
      offer: offer,
      secondsRemaining: secondsRemaining ?? this.secondsRemaining,
    );
  }

  @override
  List<Object?> get props => [offer, secondsRemaining];
}

class OfferAccepted extends DriverState {
  final String rideId;
  final LatLng pickupLocation;
  final String pickupAddress;

  const OfferAccepted({
    required this.rideId,
    required this.pickupLocation,
    required this.pickupAddress,
  });

  @override
  List<Object?> get props => [rideId, pickupLocation, pickupAddress];
}

class EnRoutePickup extends DriverState {
  final String rideId;
  final LatLng pickupLocation;
  final String pickupAddress;
  final bool hasArrived;

  const EnRoutePickup({
    required this.rideId,
    required this.pickupLocation,
    required this.pickupAddress,
    this.hasArrived = false,
  });

  EnRoutePickup copyWith({bool? hasArrived}) {
    return EnRoutePickup(
      rideId: rideId,
      pickupLocation: pickupLocation,
      pickupAddress: pickupAddress,
      hasArrived: hasArrived ?? this.hasArrived,
    );
  }

  @override
  List<Object?> get props => [rideId, pickupLocation, pickupAddress, hasArrived];
}

class TripStarted extends DriverState {
  final String rideId;
  final LatLng dropoffLocation;
  final String dropoffAddress;

  const TripStarted({
    required this.rideId,
    required this.dropoffLocation,
    required this.dropoffAddress,
  });

  @override
  List<Object?> get props => [rideId, dropoffLocation, dropoffAddress];
}

class TripFinished extends DriverState {
  final String rideId;
  final double totalEarnings;

  const TripFinished({
    required this.rideId,
    required this.totalEarnings,
  });

  @override
  List<Object?> get props => [rideId, totalEarnings];
}

class DriverFailure extends DriverState {
  final String error;

  const DriverFailure({required this.error});

  @override
  List<Object?> get props => [error];
}
