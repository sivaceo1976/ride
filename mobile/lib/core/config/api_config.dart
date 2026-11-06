class ApiConfig {
  static const String defaultBaseUrl = 'http://10.0.2.2:3000'; // Android emulator to host
  static const String defaultWsUrl = 'ws://10.0.2.2:3000';

  static String baseUrl = defaultBaseUrl;
  static String wsUrl = defaultWsUrl;

  static const Duration connectTimeout = Duration(seconds: 10);
  static const Duration receiveTimeout = Duration(seconds: 10);

  // Endpoints
  static const String ridesRequest = '/rides/request';
  static String ridesAccept(String id) => '/rides/$id/accept';
  static String ridesReject(String id) => '/rides/$id/reject';
  static String ridesArrived(String id) => '/rides/$id/arrived';
  static String ridesStart(String id) => '/rides/$id/start';
  static String ridesComplete(String id) => '/rides/$id/complete';
  static String ridesCancel(String id) => '/rides/$id/cancel';
  static String rideDetails(String id) => '/rides/$id';

  static String driverWsUrl(String driverId, [String? token]) =>
      '$wsUrl/ws/driver?driverId=$driverId${token != null ? '&token=$token' : ''}';

  static String riderWsUrl(String riderId, [String? token]) =>
      '$wsUrl/ws/rider?riderId=$riderId${token != null ? '&token=$token' : ''}';
}
