import 'package:dio/dio.dart';
import '../config/api_config.dart';
import 'api_exceptions.dart';

class ApiClient {
  final Dio _dio;
  String? _authToken;

  ApiClient({Dio? dio})
      : _dio = dio ??
            Dio(
              BaseOptions(
                baseUrl: ApiConfig.baseUrl,
                connectTimeout: ApiConfig.connectTimeout,
                receiveTimeout: ApiConfig.receiveTimeout,
                headers: {
                  'Content-Type': 'application/json',
                  'Accept': 'application/json',
                },
              ),
            ) {
    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          if (_authToken != null) {
            options.headers['Authorization'] = 'Bearer $_authToken';
          }
          return handler.next(options);
        },
        onError: (DioException error, handler) {
          final mapped = _mapDioError(error);
          return handler.reject(
            DioException(
              requestOptions: error.requestOptions,
              error: mapped,
              response: error.response,
              type: error.type,
            ),
          );
        },
      ),
    );
  }

  void setAuthToken(String? token) {
    _authToken = token;
  }

  Future<Response<T>> get<T>(
    String path, {
    Map<String, dynamic>? queryParameters,
  }) async {
    try {
      return await _dio.get<T>(path, queryParameters: queryParameters);
    } on DioException catch (e) {
      throw (e.error is ApiException) ? e.error! : _mapDioError(e);
    }
  }

  Future<Response<T>> post<T>(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
  }) async {
    try {
      return await _dio.post<T>(path, data: data, queryParameters: queryParameters);
    } on DioException catch (e) {
      throw (e.error is ApiException) ? e.error! : _mapDioError(e);
    }
  }

  ApiException _mapDioError(DioException error) {
    final status = error.response?.statusCode;
    final data = error.response?.data;
    final message = (data is Map && data['error'] != null)
        ? data['error'].toString()
        : (error.message ?? 'Unknown network error');

    if (status == 400) {
      return ValidationException(message: message, statusCode: status, details: data);
    }
    if (status == 401 || status == 403) {
      return UnauthorizedException(message: message, statusCode: status, details: data);
    }
    if (status == 409) {
      return ConflictException(message: message, statusCode: status, details: data);
    }
    return NetworkException(message: message, statusCode: status, details: data);
  }
}
