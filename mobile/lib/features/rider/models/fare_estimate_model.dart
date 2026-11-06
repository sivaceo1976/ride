import 'package:equatable/equatable.dart';

enum VehicleClass { bike, sedan, suv }

class FareBreakdownModel extends Equatable {
  final double baseFare;
  final double perKmRate;
  final double distanceKm;
  final double distanceFare;
  final double perMinRate;
  final double durationMin;
  final double timeFare;
  final double surgeMultiplier;
  final double totalFare;
  final String currency;

  const FareBreakdownModel({
    required this.baseFare,
    required this.perKmRate,
    required this.distanceKm,
    required this.distanceFare,
    required this.perMinRate,
    required this.durationMin,
    required this.timeFare,
    required this.surgeMultiplier,
    required this.totalFare,
    required this.currency,
  });

  factory FareBreakdownModel.fromJson(Map<String, dynamic> json) {
    return FareBreakdownModel(
      baseFare: (json['baseFare'] as num).toDouble(),
      perKmRate: (json['perKmRate'] as num).toDouble(),
      distanceKm: (json['distanceKm'] as num).toDouble(),
      distanceFare: (json['distanceFare'] as num).toDouble(),
      perMinRate: (json['perMinRate'] as num).toDouble(),
      durationMin: (json['durationMin'] as num).toDouble(),
      timeFare: (json['timeFare'] as num).toDouble(),
      surgeMultiplier: (json['surgeMultiplier'] as num).toDouble(),
      totalFare: (json['totalFare'] as num).toDouble(),
      currency: json['currency']?.toString() ?? 'USD',
    );
  }

  Map<String, dynamic> toJson() => {
        'baseFare': baseFare,
        'perKmRate': perKmRate,
        'distanceKm': distanceKm,
        'distanceFare': distanceFare,
        'perMinRate': perMinRate,
        'durationMin': durationMin,
        'timeFare': timeFare,
        'surgeMultiplier': surgeMultiplier,
        'totalFare': totalFare,
        'currency': currency,
      };

  @override
  List<Object?> get props => [
        baseFare,
        perKmRate,
        distanceKm,
        distanceFare,
        perMinRate,
        durationMin,
        timeFare,
        surgeMultiplier,
        totalFare,
        currency,
      ];
}
