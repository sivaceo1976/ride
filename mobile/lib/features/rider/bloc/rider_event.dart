import 'package:equatable/equatable.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import '../models/fare_estimate_model.dart';
import '../models/ride_model.dart';

abstract class RiderEvent extends Equatable {
  const RiderEvent();

  @override
  List<Object?> get props => [];
}

class RiderDestinationSelected extends RiderEvent {
  final String pickupAddress;
  final LatLng pickupLocation;
  final String dropoffAddress;
  final LatLng dropoffLocation;
  final VehicleClass vehicleClass;

  const RiderDestinationSelected({
    required this.pickupAddress,
    required this.pickupLocation,
    required this.dropoffAddress,
    required this.dropoffLocation,
    this.vehicleClass = VehicleClass.sedan,
  });

  @override
  List<Object?> get props => [
        pickupAddress,
        pickupLocation,
        dropoffAddress,
        dropoffLocation,
        vehicleClass,
      ];
}

class RiderRequestRideSubmitted extends RiderEvent {
  final String riderId;
  final String pickupAddress;
  final LatLng pickupLocation;
  final String dropoffAddress;
  final LatLng dropoffLocation;
  final VehicleClass vehicleClass;

  const RiderRequestRideSubmitted({
    required this.riderId,
    required this.pickupAddress,
    required this.pickupLocation,
    required this.dropoffAddress,
    required this.dropoffLocation,
    required this.vehicleClass,
  });

  @override
  List<Object?> get props => [
        riderId,
        pickupAddress,
        pickupLocation,
        dropoffAddress,
        dropoffLocation,
        vehicleClass,
      ];
}

class RiderDriverAssignedReceived extends RiderEvent {
  final String driverId;
  final LatLng driverLocation;
  final double bearing;

  const RiderDriverAssignedReceived({
    required this.driverId,
    required this.driverLocation,
    this.bearing = 0.0,
  });

  @override
  List<Object?> get props => [driverId, driverLocation, bearing];
}

class RiderDriverLocationUpdatedReceived extends RiderEvent {
  final LatLng driverLocation;
  final double bearing;
  final double speed;

  const RiderDriverLocationUpdatedReceived({
    required this.driverLocation,
    required this.bearing,
    required this.speed,
  });

  @override
  List<Object?> get props => [driverLocation, bearing, speed];
}

class RiderDriverArrivedReceived extends RiderEvent {
  const RiderDriverArrivedReceived();
}

class RiderTripStartedReceived extends RiderEvent {
  const RiderTripStartedReceived();
}

class RiderSafetyAlertReceived extends RiderEvent {
  final String alertType;
  final double deviationMeters;

  const RiderSafetyAlertReceived({
    required this.alertType,
    required this.deviationMeters,
  });

  @override
  List<Object?> get props => [alertType, deviationMeters];
}

class RiderTripCompletedReceived extends RiderEvent {
  final FareBreakdownModel finalFare;

  const RiderTripCompletedReceived({required this.finalFare});

  @override
  List<Object?> get props => [finalFare];
}

class RiderCancelRideSubmitted extends RiderEvent {
  final String reason;

  const RiderCancelRideSubmitted({required this.reason});

  @override
  List<Object?> get props => [reason];
}
