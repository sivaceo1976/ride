import 'package:equatable/equatable.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'fare_estimate_model.dart';

enum RideStatus {
  requested,
  searchingDriver,
  assigned,
  accepted,
  arrivedAtPickup,
  inTransit,
  completed,
  cancelled,
}

RideStatus parseRideStatus(String? status) {
  switch (status?.toUpperCase()) {
    case 'SEARCHING_DRIVER':
      return RideStatus.searchingDriver;
    case 'ASSIGNED':
      return RideStatus.assigned;
    case 'ACCEPTED':
      return RideStatus.accepted;
    case 'ARRIVED_AT_PICKUP':
      return RideStatus.arrivedAtPickup;
    case 'IN_TRANSIT':
      return RideStatus.inTransit;
    case 'COMPLETED':
      return RideStatus.completed;
    case 'CANCELLED':
      return RideStatus.cancelled;
    default:
      return RideStatus.requested;
  }
}

class RideModel extends Equatable {
  final String id;
  final String riderId;
  final String? driverId;
  final RideStatus status;
  final String pickupAddress;
  final LatLng pickupLocation;
  final String dropoffAddress;
  final LatLng dropoffLocation;
  final FareBreakdownModel fareBreakdown;
  final String otp;
  final double surgeMultiplier;
  final double estimatedDistanceKm;
  final double estimatedDurationMin;
  final String? cancellationReason;

  const RideModel({
    required this.id,
    required this.riderId,
    this.driverId,
    required this.status,
    required this.pickupAddress,
    required this.pickupLocation,
    required this.dropoffAddress,
    required this.dropoffLocation,
    required this.fareBreakdown,
    required this.otp,
    required this.surgeMultiplier,
    required this.estimatedDistanceKm,
    required this.estimatedDurationMin,
    this.cancellationReason,
  });

  factory RideModel.fromJson(Map<String, dynamic> json) {
    final pickup = json['pickupLocation'] as Map<String, dynamic>;
    final dropoff = json['dropoffLocation'] as Map<String, dynamic>;

    return RideModel(
      id: json['id'].toString(),
      riderId: json['riderId'].toString(),
      driverId: json['driverId']?.toString(),
      status: parseRideStatus(json['status']?.toString()),
      pickupAddress: json['pickupAddress'].toString(),
      pickupLocation: LatLng(
        (pickup['lat'] as num).toDouble(),
        (pickup['lng'] as num).toDouble(),
      ),
      dropoffAddress: json['dropoffAddress'].toString(),
      dropoffLocation: LatLng(
        (dropoff['lat'] as num).toDouble(),
        (dropoff['lng'] as num).toDouble(),
      ),
      fareBreakdown: FareBreakdownModel.fromJson(
        json['fareBreakdown'] as Map<String, dynamic>,
      ),
      otp: json['otp'].toString(),
      surgeMultiplier: (json['surgeMultiplier'] as num?)?.toDouble() ?? 1.0,
      estimatedDistanceKm: (json['estimatedDistanceKm'] as num).toDouble(),
      estimatedDurationMin: (json['estimatedDurationMin'] as num).toDouble(),
      cancellationReason: json['cancellationReason']?.toString(),
    );
  }

  RideModel copyWith({
    String? driverId,
    RideStatus? status,
    String? cancellationReason,
  }) {
    return RideModel(
      id: id,
      riderId: riderId,
      driverId: driverId ?? this.driverId,
      status: status ?? this.status,
      pickupAddress: pickupAddress,
      pickupLocation: pickupLocation,
      dropoffAddress: dropoffAddress,
      dropoffLocation: dropoffLocation,
      fareBreakdown: fareBreakdown,
      otp: otp,
      surgeMultiplier: surgeMultiplier,
      estimatedDistanceKm: estimatedDistanceKm,
      estimatedDurationMin: estimatedDurationMin,
      cancellationReason: cancellationReason ?? this.cancellationReason,
    );
  }

  @override
  List<Object?> get props => [
        id,
        riderId,
        driverId,
        status,
        pickupAddress,
        pickupLocation,
        dropoffAddress,
        dropoffLocation,
        fareBreakdown,
        otp,
        surgeMultiplier,
        estimatedDistanceKm,
        estimatedDurationMin,
        cancellationReason,
      ];
}
