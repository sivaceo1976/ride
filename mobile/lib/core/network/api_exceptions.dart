class ApiException implements Exception {
  final String message;
  final int? statusCode;
  final dynamic details;

  ApiException({
    required this.message,
    this.statusCode,
    this.details,
  });

  @override
  String toString() => 'ApiException(statusCode: $statusCode, message: $message)';
}

class NetworkException extends ApiException {
  NetworkException({required super.message, super.statusCode, super.details});
}

class ConflictException extends ApiException {
  ConflictException({required super.message, super.statusCode = 409, super.details});
}

class UnauthorizedException extends ApiException {
  UnauthorizedException({required super.message, super.statusCode = 401, super.details});
}

class ValidationException extends ApiException {
  ValidationException({required super.message, super.statusCode = 400, super.details});
}
