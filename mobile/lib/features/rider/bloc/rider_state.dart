import 'package:equatable/equatable.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import '../models/fare_estimate_model.dart';
import '../models/ride_model.dart';

abstract class RiderState extends Equatable {
  const RiderState();

  @override
  List<Object?> get props => [];
}

class RiderInitial extends RiderState {
  const RiderInitial();
}

class RideBooking extends RiderState {
  final String pickupAddress;
  final LatLng pickupLocation;
  final String dropoffAddress;
  final LatLng dropoffLocation;
  final VehicleClass vehicleClass;
  final FareBreakdownModel fareEstimate;

  const RideBooking({
    required this.pickupAddress,
    required this.pickupLocation,
    required this.dropoffAddress,
    required this.dropoffLocation,
    required this.vehicleClass,
    required this.fareEstimate,
  });

  @override
  List<Object?> get props => [
        pickupAddress,
        pickupLocation,
        dropoffAddress,
        dropoffLocation,
        vehicleClass,
        fareEstimate,
      ];
}

class RideSearching extends RiderState {
  final RideModel ride;

  const RideSearching({required this.ride});

  @override
  List<Object?> get props => [ride];
}

class RideAssigned extends RiderState {
  final RideModel ride;
  final LatLng driverLocation;
  final double driverBearing;
  final bool driverArrived;
  final String? activeSafetyAlert;

  const RideAssigned({
    required this.ride,
    required this.driverLocation,
    this.driverBearing = 0.0,
    this.driverArrived = false,
    this.activeSafetyAlert,
  });

  RideAssigned copyWith({
    LatLng? driverLocation,
    double? driverBearing,
    bool? driverArrived,
    String? activeSafetyAlert,
  }) {
    return RideAssigned(
      ride: ride,
      driverLocation: driverLocation ?? this.driverLocation,
      driverBearing: driverBearing ?? this.driverBearing,
      driverArrived: driverArrived ?? this.driverArrived,
      activeSafetyAlert: activeSafetyAlert ?? this.activeSafetyAlert,
    );
  }

  @override
  List<Object?> get props => [
        ride,
        driverLocation,
        driverBearing,
        driverArrived,
        activeSafetyAlert,
      ];
}

class RideInTransit extends RiderState {
  final RideModel ride;
  final LatLng driverLocation;
  final double driverBearing;
  final double speed;
  final String? activeSafetyAlert;

  const RideInTransit({
    required this.ride,
    required this.driverLocation,
    required this.driverBearing,
    required this.speed,
    this.activeSafetyAlert,
  });

  RideInTransit copyWith({
    LatLng? driverLocation,
    double? driverBearing,
    double? speed,
    String? activeSafetyAlert,
  }) {
    return RideInTransit(
      ride: ride,
      driverLocation: driverLocation ?? this.driverLocation,
      driverBearing: driverBearing ?? this.driverBearing,
      speed: speed ?? this.speed,
      activeSafetyAlert: activeSafetyAlert ?? this.activeSafetyAlert,
    );
  }

  @override
  List<Object?> get props => [
        ride,
        driverLocation,
        driverBearing,
        speed,
        activeSafetyAlert,
      ];
}

class RideCompleted extends RiderState {
  final RideModel ride;
  final FareBreakdownModel finalFare;

  const RideCompleted({
    required this.ride,
    required this.finalFare,
  });

  @override
  List<Object?> get props => [ride, finalFare];
}

class RideFailure extends RiderState {
  final String error;

  const RideFailure({required this.error});

  @override
  List<Object?> get props => [error];
}
