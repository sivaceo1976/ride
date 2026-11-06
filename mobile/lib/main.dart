import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'core/theme/app_theme.dart';
import 'core/network/api_client.dart';
import 'core/network/websocket_client.dart';
import 'core/config/api_config.dart';
import 'features/rider/bloc/rider_bloc.dart';
import 'features/driver/bloc/driver_bloc.dart';
import 'features/shared_map/presentation/interactive_map_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();

  final apiClient = ApiClient();
  final riderWsClient = WebSocketClient(
    url: ApiConfig.riderWsUrl('a0000000-0000-4000-8000-000000000001'),
  );
  final driverWsClient = WebSocketClient(
    url: ApiConfig.driverWsUrl('d0000000-0000-4000-8000-000000000001'),
  );

  runApp(RideHailingApp(
    apiClient: apiClient,
    riderWsClient: riderWsClient,
    driverWsClient: driverWsClient,
  ));
}

class RideHailingApp extends StatelessWidget {
  final ApiClient apiClient;
  final WebSocketClient riderWsClient;
  final WebSocketClient driverWsClient;

  const RideHailingApp({
    super.key,
    required this.apiClient,
    required this.riderWsClient,
    required this.driverWsClient,
  });

  @override
  Widget build(BuildContext context) {
    return MultiBlocProvider(
      providers: [
        BlocProvider<RiderBloc>(
          create: (_) => RiderBloc(
            apiClient: apiClient,
            webSocketClient: riderWsClient,
          ),
        ),
        BlocProvider<DriverBloc>(
          create: (_) => DriverBloc(
            driverId: 'd0000000-0000-4000-8000-000000000001',
            apiClient: apiClient,
            webSocketClient: driverWsClient,
          ),
        ),
      ],
      child: MaterialApp(
        title: 'Aura Ride Hailing',
        debugShowCheckedModeBanner: false,
        theme: AppTheme.lightTheme,
        home: const InteractiveMapScreen(),
      ),
    );
  }
}
