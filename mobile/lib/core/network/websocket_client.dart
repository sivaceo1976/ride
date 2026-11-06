import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'package:web_socket_channel/web_socket_channel.dart';

enum WebSocketConnectionState {
  disconnected,
  connecting,
  connected,
  reconnecting,
}

class WebSocketClient {
  final String url;
  WebSocketChannel? _channel;
  StreamSubscription<dynamic>? _subscription;
  Timer? _heartbeatTimer;
  Timer? _reconnectTimer;

  final _messageController = StreamController<Map<String, dynamic>>.broadcast();
  final _stateController = StreamController<WebSocketConnectionState>.broadcast();

  WebSocketConnectionState _state = WebSocketConnectionState.disconnected;
  int _reconnectAttempts = 0;
  bool _manualDisconnect = false;

  Stream<Map<String, dynamic>> get messages => _messageController.stream;
  Stream<WebSocketConnectionState> get state => _stateController.stream;
  WebSocketConnectionState get currentState => _state;

  WebSocketClient({required this.url});

  void connect() {
    if (_state == WebSocketConnectionState.connected || _state == WebSocketConnectionState.connecting) {
      return;
    }

    _manualDisconnect = false;
    _setState(WebSocketConnectionState.connecting);

    try {
      _channel = WebSocketChannel.connect(Uri.parse(url));

      _subscription = _channel!.stream.listen(
        (data) {
          _onData(data);
        },
        onError: (error) {
          _handleDisconnect();
        },
        onDone: () {
          _handleDisconnect();
        },
        cancelOnError: true,
      );

      _setState(WebSocketConnectionState.connected);
      _reconnectAttempts = 0;
      _startHeartbeat();
    } catch (_) {
      _handleDisconnect();
    }
  }

  void _onData(dynamic raw) {
    try {
      final decoded = jsonDecode(raw.toString());
      if (decoded is Map<String, dynamic>) {
        if (decoded['type'] == 'PONG') {
          // Heartbeat acknowledged
          return;
        }
        _messageController.add(decoded);
      }
    } catch (e) {
      // Ignore unparseable frames
    }
  }

  void send(Map<String, dynamic> message) {
    if (_state == WebSocketConnectionState.connected && _channel != null) {
      _channel!.sink.add(jsonEncode(message));
    }
  }

  void _startHeartbeat() {
    _heartbeatTimer?.cancel();
    _heartbeatTimer = Timer.periodic(const Duration(seconds: 15), (_) {
      send({'type': 'PING', 'timestamp': DateTime.now().millisecondsSinceEpoch});
    });
  }

  void _handleDisconnect() {
    _heartbeatTimer?.cancel();
    _subscription?.cancel();
    _channel = null;

    if (_manualDisconnect) {
      _setState(WebSocketConnectionState.disconnected);
      return;
    }

    _setState(WebSocketConnectionState.reconnecting);
    _scheduleReconnect();
  }

  void _scheduleReconnect() {
    _reconnectTimer?.cancel();
    _reconnectAttempts++;

    // Exponential backoff: min(1000 * 2^attempts + jitter, 30000ms)
    final delayMs = min(1000 * pow(2, min(_reconnectAttempts, 5)).toInt() + Random().nextInt(500), 30000);
    _reconnectTimer = Timer(Duration(milliseconds: delayMs), () {
      if (!_manualDisconnect) {
        connect();
      }
    });
  }

  void disconnect() {
    _manualDisconnect = true;
    _heartbeatTimer?.cancel();
    _reconnectTimer?.cancel();
    _subscription?.cancel();
    _channel?.sink.close();
    _channel = null;
    _setState(WebSocketConnectionState.disconnected);
  }

  void _setState(WebSocketConnectionState newState) {
    _state = newState;
    _stateController.add(newState);
  }

  void dispose() {
    disconnect();
    _messageController.close();
    _stateController.close();
  }
}
