import 'package:equatable/equatable.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import '../models/dispatch_offer_model.dart';

abstract class DriverEvent extends Equatable {
  const DriverEvent();

  @override
  List<Object?> get props => [];
}

class DriverDutyToggled extends DriverEvent {
  final bool isOnline;

  const DriverDutyToggled({required this.isOnline});

  @override
  List<Object?> get props => [isOnline];
}

class DriverLocationPushed extends DriverEvent {
  final LatLng location;
  final double bearing;
  final double speed;

  const DriverLocationPushed({
    required this.location,
    required this.bearing,
    required this.speed,
  });

  @override
  List<Object?> get props => [location, bearing, speed];
}

class DriverOfferReceived extends DriverEvent {
  final DispatchOfferModel offer;

  const DriverOfferReceived({required this.offer});

  @override
  List<Object?> get props => [offer];
}

class DriverOfferAcceptedSubmitted extends DriverEvent {
  final String rideId;

  const DriverOfferAcceptedSubmitted({required this.rideId});

  @override
  List<Object?> get props => [rideId];
}

class DriverOfferDeclinedSubmitted extends DriverEvent {
  final String rideId;

  const DriverOfferDeclinedSubmitted({required this.rideId});

  @override
  List<Object?> get props => [rideId];
}

class DriverOfferTimeoutExpired extends DriverEvent {
  final String rideId;

  const DriverOfferTimeoutExpired({required this.rideId});

  @override
  List<Object?> get props => [rideId];
}

class DriverArrivedAtPickupSubmitted extends DriverEvent {
  final String rideId;

  const DriverArrivedAtPickupSubmitted({required this.rideId});

  @override
  List<Object?> get props => [rideId];
}

class DriverVerifyOtpSubmitted extends DriverEvent {
  final String rideId;
  final String otp;

  const DriverVerifyOtpSubmitted({
    required this.rideId,
    required this.otp,
  });

  @override
  List<Object?> get props => [rideId, otp];
}

class DriverCompleteTripSubmitted extends DriverEvent {
  final String rideId;

  const DriverCompleteTripSubmitted({required this.rideId});

  @override
  List<Object?> get props => [rideId];
}
