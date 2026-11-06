import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import '../../rider/bloc/rider_bloc.dart';
import '../../rider/bloc/rider_event.dart';
import '../../rider/bloc/rider_state.dart';
import '../../rider/presentation/destination_selection_sheet.dart';
import '../../rider/presentation/radar_matching_view.dart';
import '../../rider/presentation/live_tracking_sheet.dart';
import '../../rider/presentation/trip_receipt_view.dart';
import '../../driver/bloc/driver_bloc.dart';
import '../../driver/bloc/driver_event.dart';
import '../../driver/bloc/driver_state.dart';
import '../../driver/presentation/duty_toggle_panel.dart';
import '../../driver/presentation/dispatch_alert_dialog.dart';
import '../../driver/presentation/turn_by_turn_view.dart';
import '../../driver/presentation/otp_verification_dialog.dart';
import '../models/map_view_state.dart';

class InteractiveMapScreen extends StatefulWidget {
  const InteractiveMapScreen({super.key});

  @override
  State<InteractiveMapScreen> createState() => _InteractiveMapScreenState();
}

class _InteractiveMapScreenState extends State<InteractiveMapScreen> {
  GoogleMapController? _mapController;
  UserAppRole _currentRole = UserAppRole.rider;

  // Initial SF camera position
  static const CameraPosition _initialCamera = CameraPosition(
    target: LatLng(37.7749, -122.4194),
    zoom: 14.5,
  );

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Stack(
        children: [
          // 1. Google Map Viewport
          GoogleMap(
            initialCameraPosition: _initialCamera,
            onMapCreated: (controller) => _mapController = controller,
            myLocationEnabled: true,
            myLocationButtonEnabled: false,
            zoomControlsEnabled: false,
          ),

          // 2. Top App Bar & Role Switcher
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  // App Brand Pill
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                    decoration: BoxDecoration(
                      color: Colors.black.withOpacity(0.85),
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: const Row(
                      children: [
                        Icon(Icons.local_taxi, color: Colors.amber, size: 20),
                        SizedBox(width: 8),
                        Text(
                          'AURA RIDE',
                          style: TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.bold,
                            letterSpacing: 1.1,
                          ),
                        ),
                      ],
                    ),
                  ),

                  // Role Toggle Button
                  Container(
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(20),
                      boxShadow: const [BoxShadow(color: Colors.black12, blurRadius: 8)],
                    ),
                    child: Row(
                      children: [
                        _buildRoleTab('Rider', UserAppRole.rider),
                        _buildRoleTab('Driver', UserAppRole.driver),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),

          // 3. Dynamic Bottom Sheets & Overlays based on active Role & Bloc States
          Align(
            alignment: Alignment.bottomCenter,
            child: _currentRole == UserAppRole.rider
                ? _buildRiderOverlay(context)
                : _buildDriverOverlay(context),
          ),
        ],
      ),
    );
  }

  Widget _buildRoleTab(String label, UserAppRole role) {
    final isSelected = _currentRole == role;
    return GestureDetector(
      onTap: () => setState(() => _currentRole = role),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        decoration: BoxDecoration(
          color: isSelected ? Colors.black : Colors.transparent,
          borderRadius: BorderRadius.circular(20),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: isSelected ? Colors.white : Colors.black87,
            fontWeight: FontWeight.bold,
            fontSize: 12,
          ),
        ),
      ),
    );
  }

  Widget _buildRiderOverlay(BuildContext context) {
    return BlocBuilder<RiderBloc, RiderState>(
      builder: (context, state) {
        if (state is RiderInitial) {
          return Padding(
            padding: const EdgeInsets.all(20),
            child: ElevatedButton.icon(
              onPressed: () {
                context.read<RiderBloc>().add(const RiderDestinationSelected(
                      pickupAddress: '555 California St, SF',
                      pickupLocation: LatLng(37.7925, -122.4042),
                      dropoffAddress: 'Pier 39, The Embarcadero, SF',
                      dropoffLocation: LatLng(37.8087, -122.4098),
                    ));
              },
              icon: const Icon(Icons.search),
              label: const Text('Where to? (Select Destination)'),
            ),
          );
        }

        if (state is RideBooking) {
          return DestinationSelectionSheet(
            pickupAddress: state.pickupAddress,
            dropoffAddress: state.dropoffAddress,
            selectedClass: state.vehicleClass,
            fareEstimate: state.fareEstimate,
            onClassChanged: (newClass) {
              context.read<RiderBloc>().add(RiderDestinationSelected(
                    pickupAddress: state.pickupAddress,
                    pickupLocation: state.pickupLocation,
                    dropoffAddress: state.dropoffAddress,
                    dropoffLocation: state.dropoffLocation,
                    vehicleClass: newClass,
                  ));
            },
            onRequestRide: () {
              context.read<RiderBloc>().add(RiderRequestRideSubmitted(
                    riderId: 'a0000000-0000-4000-8000-000000000001',
                    pickupAddress: state.pickupAddress,
                    pickupLocation: state.pickupLocation,
                    dropoffAddress: state.dropoffAddress,
                    dropoffLocation: state.dropoffLocation,
                    vehicleClass: state.vehicleClass,
                  ));
            },
          );
        }

        if (state is RideSearching) {
          return RadarMatchingView(
            onCancel: () {
              context.read<RiderBloc>().add(const RiderCancelRideSubmitted(reason: 'Rider cancelled search'));
            },
          );
        }

        if (state is RideAssigned) {
          return LiveTrackingSheet(
            statusPillText: state.driverArrived ? 'DRIVER ARRIVED' : 'DRIVER APPROACHING',
            statusPillColor: state.driverArrived ? Colors.green : Colors.blue,
            otp: state.ride.otp,
            safetyAlert: state.activeSafetyAlert,
            pickupAddress: state.ride.pickupAddress,
            dropoffAddress: state.ride.dropoffAddress,
            onCancel: () {
              context.read<RiderBloc>().add(const RiderCancelRideSubmitted(reason: 'Rider cancelled'));
            },
          );
        }

        if (state is RideInTransit) {
          return LiveTrackingSheet(
            statusPillText: 'IN TRANSIT',
            statusPillColor: Colors.purple,
            otp: state.ride.otp,
            safetyAlert: state.activeSafetyAlert,
            pickupAddress: state.ride.pickupAddress,
            dropoffAddress: state.ride.dropoffAddress,
            onCancel: () {},
          );
        }

        if (state is RideCompleted) {
          return TripReceiptView(
            fare: state.finalFare,
            onDone: () {
              context.read<RiderBloc>().add(const RiderDestinationSelected(
                    pickupAddress: '',
                    pickupLocation: LatLng(0, 0),
                    dropoffAddress: '',
                    dropoffLocation: LatLng(0, 0),
                  ));
            },
          );
        }

        return const SizedBox.shrink();
      },
    );
  }

  Widget _buildDriverOverlay(BuildContext context) {
    return BlocConsumer<DriverBloc, DriverState>(
      listener: (context, state) {
        if (state is OfferReceived) {
          showDialog<void>(
            context: context,
            barrierDismissible: false,
            builder: (_) => DispatchAlertDialog(
              offer: state.offer,
              secondsRemaining: state.secondsRemaining,
              onAccept: () {
                Navigator.of(context).pop();
                context.read<DriverBloc>().add(DriverOfferAcceptedSubmitted(rideId: state.offer.rideId));
              },
              onDecline: () {
                Navigator.of(context).pop();
                context.read<DriverBloc>().add(DriverOfferDeclinedSubmitted(rideId: state.offer.rideId));
              },
            ),
          );
        }
      },
      builder: (context, state) {
        if (state is DriverOffline || state is DriverOnline) {
          final isOnline = state is DriverOnline;
          return Padding(
            padding: const EdgeInsets.all(16),
            child: DutyTogglePanel(
              isOnline: isOnline,
              speed: state is DriverOnline ? (state as DriverOnline).speed : 0.0,
              onToggle: (online) {
                context.read<DriverBloc>().add(DriverDutyToggled(isOnline: online));
              },
            ),
          );
        }

        if (state is EnRoutePickup) {
          return TurnByTurnView(
            destinationAddress: state.pickupAddress,
            isEnRouteToPickup: true,
            hasArrivedAtPickup: state.hasArrived,
            onArrived: () {
              context.read<DriverBloc>().add(DriverArrivedAtPickupSubmitted(rideId: state.rideId));
            },
            onVerifyOtp: () {
              showDialog<void>(
                context: context,
                builder: (_) => OtpVerificationDialog(
                  onVerify: (otp) {
                    Navigator.of(context).pop();
                    context.read<DriverBloc>().add(DriverVerifyOtpSubmitted(
                          rideId: state.rideId,
                          otp: otp,
                        ));
                  },
                ),
              );
            },
            onCompleteTrip: () {},
          );
        }

        if (state is TripStarted) {
          return TurnByTurnView(
            destinationAddress: state.dropoffAddress,
            isEnRouteToPickup: false,
            onArrived: () {},
            onVerifyOtp: () {},
            onCompleteTrip: () {
              context.read<DriverBloc>().add(DriverCompleteTripSubmitted(rideId: state.rideId));
            },
          );
        }

        return const SizedBox.shrink();
      },
    );
  }
}
