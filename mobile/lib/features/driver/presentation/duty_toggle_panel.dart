import 'package:flutter/material.dart';

class DutyTogglePanel extends StatelessWidget {
  final bool isOnline;
  final ValueChanged<bool> onToggle;
  final double speed;
  final double earningsToday;

  const DutyTogglePanel({
    super.key,
    required this.isOnline,
    required this.onToggle,
    this.speed = 0.0,
    this.earningsToday = 142.50,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        boxShadow: const [
          BoxShadow(color: Colors.black12, blurRadius: 10, offset: Offset(0, 4)),
        ],
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                children: [
                  Container(
                    width: 10,
                    height: 10,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: isOnline ? Colors.green : Colors.grey,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    isOnline ? 'YOU ARE ONLINE' : 'YOU ARE OFFLINE',
                    style: TextStyle(
                      fontWeight: FontWeight.bold,
                      fontSize: 14,
                      color: isOnline ? Colors.green.shade700 : Colors.grey.shade600,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 4),
              Text(
                isOnline ? 'Emitting telemetry • Speed: ${speed.toStringAsFixed(0)} km/h' : 'Toggle switch to receive ride offers',
                style: const TextStyle(fontSize: 11, color: Colors.grey),
              ),
            ],
          ),
          Switch(
            value: isOnline,
            activeColor: Colors.green,
            onChanged: onToggle,
          ),
        ],
      ),
    );
  }
}
