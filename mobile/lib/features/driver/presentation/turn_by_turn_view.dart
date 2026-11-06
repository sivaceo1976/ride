import 'package:flutter/material.dart';

class TurnByTurnView extends StatelessWidget {
  final String destinationAddress;
  final bool isEnRouteToPickup;
  final bool hasArrivedAtPickup;
  final VoidCallback onArrived;
  final VoidCallback onVerifyOtp;
  final VoidCallback onCompleteTrip;

  const TurnByTurnView({
    super.key,
    required this.destinationAddress,
    required this.isEnRouteToPickup,
    this.hasArrivedAtPickup = false,
    required this.onArrived,
    required this.onVerifyOtp,
    required this.onCompleteTrip,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        boxShadow: [
          BoxShadow(color: Colors.black12, blurRadius: 16, offset: Offset(0, -4)),
        ],
      ),
      child: SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Target header
            Row(
              children: [
                Icon(
                  isEnRouteToPickup ? Icons.near_me : Icons.navigation,
                  color: Colors.blue,
                  size: 24,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        isEnRouteToPickup ? 'NAVIGATE TO PICKUP' : 'TRIP IN PROGRESS',
                        style: const TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.bold,
                          color: Colors.grey,
                        ),
                      ),
                      Text(
                        destinationAddress,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                      ),
                    ],
                  ),
                ),
              ],
            ),

            const SizedBox(height: 20),

            // Action Buttons based on state
            if (isEnRouteToPickup) ...[
              if (!hasArrivedAtPickup)
                ElevatedButton.icon(
                  onPressed: onArrived,
                  icon: const Icon(Icons.location_on),
                  label: const Text('ARRIVED AT PICKUP'),
                  style: ElevatedButton.styleFrom(backgroundColor: Colors.blue),
                )
              else
                ElevatedButton.icon(
                  onPressed: onVerifyOtp,
                  icon: const Icon(Icons.lock_open),
                  label: const Text('ENTER RIDER PIN (START TRIP)'),
                  style: ElevatedButton.styleFrom(backgroundColor: Colors.green),
                ),
            ] else ...[
              ElevatedButton.icon(
                onPressed: onCompleteTrip,
                icon: const Icon(Icons.flag),
                label: const Text('COMPLETE TRIP'),
                style: ElevatedButton.styleFrom(backgroundColor: Colors.redAccent),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
