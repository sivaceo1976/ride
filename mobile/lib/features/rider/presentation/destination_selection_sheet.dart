import 'package:flutter/material.dart';
import '../models/fare_estimate_model.dart';

class DestinationSelectionSheet extends StatelessWidget {
  final String pickupAddress;
  final String dropoffAddress;
  final VehicleClass selectedClass;
  final FareBreakdownModel fareEstimate;
  final ValueChanged<VehicleClass> onClassChanged;
  final VoidCallback onRequestRide;

  const DestinationSelectionSheet({
    super.key,
    required this.pickupAddress,
    required this.dropoffAddress,
    required this.selectedClass,
    required this.fareEstimate,
    required this.onClassChanged,
    required this.onRequestRide,
  });

  @override
  Widget build(BuildContext context) {
    final isSurging = fareEstimate.surgeMultiplier > 1.0;

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        boxShadow: [
          BoxShadow(
            color: Colors.black12,
            blurRadius: 16,
            offset: Offset(0, -4),
          ),
        ],
      ),
      child: SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Handle bar
            Center(
              child: Container(
                width: 40,
                height: 4,
                margin: const EdgeInsets.only(bottom: 16),
                decoration: BoxDecoration(
                  color: Colors.grey.shade300,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),

            // Pickup & Destination Summary
            Row(
              children: [
                Column(
                  children: [
                    const Icon(Icons.radio_button_checked, color: Colors.blue, size: 20),
                    Container(width: 2, height: 28, color: Colors.grey.shade300),
                    const Icon(Icons.location_on, color: Colors.red, size: 20),
                  ],
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        pickupAddress,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
                      ),
                      const SizedBox(height: 18),
                      Text(
                        dropoffAddress,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
                      ),
                    ],
                  ),
                ),
              ],
            ),

            const Divider(height: 32),

            // Surge Warning Pill (if active)
            if (isSurging)
              Container(
                margin: const EdgeInsets.only(bottom: 16),
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                decoration: BoxDecoration(
                  color: Colors.amber.shade50,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: Colors.amber.shade400),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.bolt, color: Colors.amber, size: 20),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        'High demand in area: ${fareEstimate.surgeMultiplier.toStringAsFixed(2)}x Dynamic Surge applied',
                        style: const TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: Colors.black87,
                        ),
                      ),
                    ),
                  ],
                ),
              ),

            // Vehicle Class Selector
            Row(
              children: [
                _buildVehicleOption(
                  context,
                  title: 'Bike',
                  subtitle: 'Quick Solo',
                  vClass: VehicleClass.bike,
                  icon: Icons.two_wheeler,
                  basePrice: 2.50,
                ),
                const SizedBox(width: 8),
                _buildVehicleOption(
                  context,
                  title: 'Sedan',
                  subtitle: 'Affordable',
                  vClass: VehicleClass.sedan,
                  icon: Icons.directions_car,
                  basePrice: 4.00,
                ),
                const SizedBox(width: 8),
                _buildVehicleOption(
                  context,
                  title: 'SUV',
                  subtitle: 'Spacious',
                  vClass: VehicleClass.suv,
                  icon: Icons.airport_shuttle,
                  basePrice: 7.00,
                ),
              ],
            ),

            const SizedBox(height: 20),

            // Upfront Fare & Request Button
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Upfront Total', style: TextStyle(color: Colors.grey, fontSize: 12)),
                    Text(
                      '\$${fareEstimate.totalFare.toStringAsFixed(2)}',
                      style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
                    ),
                  ],
                ),
                ElevatedButton(
                  onPressed: onRequestRide,
                  style: ElevatedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 14),
                  ),
                  child: const Text('Confirm Ride'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildVehicleOption(
    BuildContext context, {
    required String title,
    required String subtitle,
    required VehicleClass vClass,
    required IconData icon,
    required double basePrice,
  }) {
    final isSelected = selectedClass == vClass;

    return Expanded(
      child: GestureDetector(
        onTap: () => onClassChanged(vClass),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 8),
          decoration: BoxDecoration(
            color: isSelected ? Colors.blue.shade50 : Colors.grey.shade50,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: isSelected ? Colors.blue : Colors.grey.shade300,
              width: isSelected ? 2 : 1,
            ),
          ),
          child: Column(
            children: [
              Icon(icon, color: isSelected ? Colors.blue : Colors.black87),
              const SizedBox(height: 6),
              Text(
                title,
                style: TextStyle(
                  fontWeight: isSelected ? FontWeight.bold : FontWeight.w500,
                  fontSize: 13,
                ),
              ),
              Text(
                subtitle,
                style: const TextStyle(fontSize: 10, color: Colors.grey),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
