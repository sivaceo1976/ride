import 'package:flutter/material.dart';
import '../models/fare_estimate_model.dart';

class TripReceiptView extends StatefulWidget {
  final FareBreakdownModel fare;
  final VoidCallback onDone;

  const TripReceiptView({
    super.key,
    required this.fare,
    required this.onDone,
  });

  @override
  State<TripReceiptView> createState() => _TripReceiptViewState();
}

class _TripReceiptViewState extends State<TripReceiptView> {
  int _selectedRating = 5;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      child: SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.check_circle, color: Colors.green, size: 56),
            const SizedBox(height: 12),
            const Text(
              'Trip Completed',
              style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 4),
            Text(
              'Total Charged: \$${widget.fare.totalFare.toStringAsFixed(2)}',
              style: const TextStyle(fontSize: 18, color: Colors.blue, fontWeight: FontWeight.w600),
            ),

            const Divider(height: 32),

            // Fare breakdown table
            _buildFareRow('Base Fare', '\$${widget.fare.baseFare.toStringAsFixed(2)}'),
            _buildFareRow(
              'Distance (${widget.fare.distanceKm.toStringAsFixed(1)} km)',
              '\$${widget.fare.distanceFare.toStringAsFixed(2)}',
            ),
            _buildFareRow(
              'Time (${widget.fare.durationMin.toStringAsFixed(0)} mins)',
              '\$${widget.fare.timeFare.toStringAsFixed(2)}',
            ),
            if (widget.fare.surgeMultiplier > 1.0)
              _buildFareRow(
                'Surge (${widget.fare.surgeMultiplier.toStringAsFixed(2)}x)',
                'Included',
                isHighlighted: true,
              ),

            const Divider(height: 24),

            // Rating Stars
            const Text('Rate your driver', style: TextStyle(fontWeight: FontWeight.w600)),
            const SizedBox(height: 8),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: List.generate(5, (index) {
                final starIndex = index + 1;
                return IconButton(
                  icon: Icon(
                    starIndex <= _selectedRating ? Icons.star : Icons.star_border,
                    color: Colors.amber,
                    size: 32,
                  ),
                  onPressed: () {
                    setState(() {
                      _selectedRating = starIndex;
                    });
                  },
                );
              }),
            ),

            const SizedBox(height: 20),
            ElevatedButton(
              onPressed: widget.onDone,
              child: const Text('Back to Home'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildFareRow(String title, String amount, {bool isHighlighted = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(title, style: TextStyle(color: isHighlighted ? Colors.amber.shade800 : Colors.grey.shade700)),
          Text(amount, style: TextStyle(fontWeight: FontWeight.w600, color: isHighlighted ? Colors.amber.shade800 : Colors.black87)),
        ],
      ),
    );
  }
}
