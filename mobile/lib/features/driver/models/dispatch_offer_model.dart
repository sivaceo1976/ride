import 'package:equatable/equatable.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

class DispatchOfferModel extends Equatable {
  final String rideId;
  final String driverId;
  final LatLng pickupLocation;
  final String pickupAddress;
  final LatLng dropoffLocation;
  final String dropoffAddress;
  final double estimatedFare;
  final double estimatedDistanceKm;
  final double estimatedDurationMin;
  final int timeoutSeconds;
  final int expiresAt;

  const DispatchOfferModel({
    required this.rideId,
    required this.driverId,
    required this.pickupLocation,
    required this.pickupAddress,
    required this.dropoffLocation,
    required this.dropoffAddress,
    required this.estimatedFare,
    required this.estimatedDistanceKm,
    required this.estimatedDurationMin,
    required this.timeoutSeconds,
    required this.expiresAt,
  });

  factory DispatchOfferModel.fromJson(Map<String, dynamic> json) {
    final pickup = json['pickupLocation'] as Map<String, dynamic>;
    final dropoff = json['dropoffLocation'] as Map<String, dynamic>;

    return DispatchOfferModel(
      rideId: json['rideId'].toString(),
      driverId: json['driverId'].toString(),
      pickupLocation: LatLng(
        (pickup['lat'] as num).toDouble(),
        (pickup['lng'] as num).toDouble(),
      ),
      pickupAddress: json['pickupAddress'].toString(),
      dropoffLocation: LatLng(
        (dropoff['lat'] as num).toDouble(),
        (dropoff['lng'] as num).toDouble(),
      ),
      dropoffAddress: json['dropoffAddress'].toString(),
      estimatedFare: (json['estimatedFare'] as num).toDouble(),
      estimatedDistanceKm: (json['estimatedDistanceKm'] as num).toDouble(),
      estimatedDurationMin: (json['estimatedDurationMin'] as num).toDouble(),
      timeoutSeconds: (json['timeoutSec'] as num?)?.toInt() ?? 15,
      expiresAt: (json['expiresAt'] as num?)?.toInt() ??
          (DateTime.now().millisecondsSinceEpoch + 15000),
    );
  }

  @override
  List<Object?> get props => [
        rideId,
        driverId,
        pickupLocation,
        pickupAddress,
        dropoffLocation,
        dropoffAddress,
        estimatedFare,
        estimatedDistanceKm,
        estimatedDurationMin,
        timeoutSeconds,
        expiresAt,
      ];
}
