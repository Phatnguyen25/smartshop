import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]);
  runApp(const SmartShopScannerApp());
}

const _beepChannel = MethodChannel('com.smartshop.scanner/beep');

Future<void> playBeep({required bool success}) async {
  try {
    await _beepChannel.invokeMethod(success ? 'success' : 'error');
    if (success) {
      await HapticFeedback.heavyImpact();
    } else {
      await HapticFeedback.vibrate();
    }
  } catch (_) {}
}

String formatVnd(num amount) {
  final s = amount.round().toString();
  final buf = StringBuffer();
  for (var i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 == 0) buf.write('.');
    buf.write(s[i]);
  }
  return '$buf ₫';
}

class SmartShopScannerApp extends StatelessWidget {
  const SmartShopScannerApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'SmartShop Scanner',
      debugShowCheckedModeBanner: false,
      theme: ThemeData.dark(useMaterial3: true).copyWith(
        scaffoldBackgroundColor: const Color(0xFF020617),
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF10B981),
          brightness: Brightness.dark,
        ),
      ),
      home: const ScannerScreen(),
    );
  }
}

class ScannedItemRecord {
  final String sku;
  final String name;
  final int price;
  final DateTime scannedAt;

  ScannedItemRecord({
    required this.sku,
    required this.name,
    required this.price,
    required this.scannedAt,
  });
}

class ScannerScreen extends StatefulWidget {
  const ScannerScreen({super.key});

  @override
  State<ScannerScreen> createState() => _ScannerScreenState();
}

class _ScannerScreenState extends State<ScannerScreen> {
  static const _prefSessionKey = 'smartshop.sessionId';
  static const _prefServerKey = 'smartshop.serverUrl';
  // Mặc định dùng IP Wi-Fi LAN của máy tính để rút cáp USB ra vẫn quét không dây thoải mái!
  static const _defaultWifiUrl = 'http://192.168.1.20:4000';
  static const _defaultUsbUrl = 'http://localhost:4000';
  static const _cooldownMs = 1500;

  final MobileScannerController _cameraCtrl = MobileScannerController(
    detectionSpeed: DetectionSpeed.normal,
    facing: CameraFacing.back,
    formats: const [BarcodeFormat.qrCode, BarcodeFormat.ean13, BarcodeFormat.code128],
  );

  final TextEditingController _sessionController = TextEditingController(text: '7EXUV4');
  final TextEditingController _serverController = TextEditingController(
    text: _defaultWifiUrl,
  );

  io.Socket? _socket;
  bool _socketConnected = false;
  String? _pairedSessionId;
  bool _posOnline = false;
  bool _cameraPaused = false;

  String? _lastKey;
  int _lastScanMs = 0;

  String? _bannerText;
  bool _bannerSuccess = true;
  Timer? _bannerTimer;

  final List<ScannedItemRecord> _history = [];

  @override
  void initState() {
    super.initState();
    _initPrefsAndConnect();
  }

  Future<void> _initPrefsAndConnect() async {
    final prefs = await SharedPreferences.getInstance();
    final savedSession = prefs.getString(_prefSessionKey) ?? '7EXUV4';
    // Tự động chuyển sang IP Wi-Fi nếu trước đó đang lưu localhost mặc định
    var savedServer = prefs.getString(_prefServerKey) ?? _defaultWifiUrl;
    if (savedServer == _defaultUsbUrl) {
      savedServer = _defaultWifiUrl;
      await prefs.setString(_prefServerKey, savedServer);
    }
    _sessionController.text = savedSession;
    _serverController.text = savedServer;
    _connectSocket(savedServer, autoJoinSession: savedSession);
  }

  void _connectSocket(String serverUrl, {String? autoJoinSession}) {
    _socket?.dispose();
    final socket = io.io(
      serverUrl.trim(),
      io.OptionBuilder()
          .setTransports(['websocket'])
          .enableAutoConnect()
          .enableReconnection()
          .build(),
    );

    socket.onConnect((_) {
      if (!mounted) return;
      setState(() => _socketConnected = true);
      final targetSession = _pairedSessionId ?? autoJoinSession;
      if (targetSession != null && targetSession.isNotEmpty) {
        _joinSession(targetSession);
      }
    });

    socket.onDisconnect((_) {
      if (!mounted) return;
      setState(() => _socketConnected = false);
    });

    socket.on('SESSION_STATE', (data) {
      if (!mounted || data is! Map) return;
      setState(() {
        _pairedSessionId = data['sessionId']?.toString();
        _posOnline = data['posConnected'] == true;
      });
    });

    _socket = socket;
  }

  Future<void> _joinSession(String rawCode) async {
    final code = rawCode.trim().toUpperCase();
    if (code.length != 6 || _socket == null) {
      _showFeedback('Mã phiên phải gồm 6 ký tự', success: false);
      return;
    }

    _socket!.emitWithAck(
      'JOIN_SESSION',
      {'sessionId': code, 'role': 'scanner'},
      ack: (res) async {
        if (!mounted) return;
        if (res is Map && res['ok'] == true) {
          final session = res['session'] as Map?;
          final sid = session?['sessionId']?.toString() ?? code;
          final prefs = await SharedPreferences.getInstance();
          await prefs.setString(_prefSessionKey, sid);
          setState(() {
            _pairedSessionId = sid;
            _sessionController.text = sid;
            _posOnline = session?['posConnected'] == true;
          });
          await playBeep(success: true);
          _showFeedback('Đã ghép nối phiên $sid', success: true);
        } else {
          final msg = (res is Map ? res['message'] : null)?.toString() ?? 'Không thể ghép nối';
          await playBeep(success: false);
          _showFeedback(msg, success: false);
        }
      },
    );
  }

  void _showFeedback(String text, {required bool success}) {
    _bannerTimer?.cancel();
    setState(() {
      _bannerText = text;
      _bannerSuccess = success;
    });
    _bannerTimer = Timer(const Duration(milliseconds: 2200), () {
      if (mounted) setState(() => _bannerText = null);
    });
  }

  ({
    String? sku,
    Map<String, dynamic>? qrData,
    String? pairingSession,
    String? pairingServer,
  }) _parseRawValue(String raw) {
    final trimmed = raw.trim();
    // Nếu quét mã QR ghép nối trên màn hình POS (http://.../scanner?session=XXXXXX&server=...)
    final uri = Uri.tryParse(trimmed);
    final sessionParam = uri?.queryParameters['session'];
    if (sessionParam != null && sessionParam.trim().length == 6) {
      return (
        sku: null,
        qrData: null,
        pairingSession: sessionParam.trim().toUpperCase(),
        pairingServer: uri?.queryParameters['server'],
      );
    }

    try {
      final decoded = jsonDecode(trimmed);
      if (decoded is Map) {
        final map = Map<String, dynamic>.from(decoded);
        final rawSku = (map['sku'] ?? map['barcode'] ?? map['id'])?.toString().trim().toUpperCase();
        return (sku: rawSku, qrData: map, pairingSession: null, pairingServer: null);
      }
    } catch (_) {}

    final upper = trimmed.toUpperCase();
    final valid = RegExp(r'^[A-Z0-9_-]{1,32}$').hasMatch(upper);
    return (
      sku: valid ? upper : null,
      qrData: null,
      pairingSession: null,
      pairingServer: null,
    );
  }

  Future<void> _onDetect(BarcodeCapture capture) async {
    if (_cameraPaused) return;
    for (final barcode in capture.barcodes) {
      final raw = barcode.rawValue;
      if (raw == null || raw.isEmpty) continue;

      final now = DateTime.now().millisecondsSinceEpoch;
      final parsed = _parseRawValue(raw);

      // Quét mã QR ghép nối phiên POS (tự động đổi cả IP Server nếu có)
      if (parsed.pairingSession != null) {
        if (_lastKey == parsed.pairingSession && now - _lastScanMs < _cooldownMs) return;
        _lastKey = parsed.pairingSession;
        _lastScanMs = now;
        if (parsed.pairingServer != null && parsed.pairingServer!.isNotEmpty) {
          final prefs = await SharedPreferences.getInstance();
          await prefs.setString(_prefServerKey, parsed.pairingServer!);
          _serverController.text = parsed.pairingServer!;
          _connectSocket(parsed.pairingServer!, autoJoinSession: parsed.pairingSession!);
        } else {
          await _joinSession(parsed.pairingSession!);
        }
        return;
      }

      final key = parsed.sku ?? raw;
      if (_lastKey == key && now - _lastScanMs < _cooldownMs) return;
      _lastKey = key;
      _lastScanMs = now;

      if (parsed.sku == null) {
        playBeep(success: false);
        _showFeedback('Mã QR không chứa SKU hợp lệ', success: false);
        return;
      }

      if (_pairedSessionId == null) {
        playBeep(success: false);
        _showFeedback('Vui lòng ghép nối mã phiên POS trước', success: false);
        return;
      }

      _sendScan(parsed.sku!, parsed.qrData);
      break;
    }
  }

  void _sendScan(String sku, Map<String, dynamic>? qrData) {
    if (_socket == null || !_socketConnected) {
      playBeep(success: false);
      _showFeedback('Mất kết nối tới Server POS', success: false);
      return;
    }

    _socket!.emitWithAck(
      'SCAN_ITEM',
      {'sku': sku, 'qrData': qrData},
      ack: (res) async {
        if (!mounted) return;
        if (res is Map && res['ok'] == true) {
          final product = Map<String, dynamic>.from(res['product'] as Map);
          final name = product['name']?.toString() ?? sku;
          final price = (product['price'] as num?)?.toInt() ?? 0;

          await playBeep(success: true);
          _showFeedback('✓ $name · ${formatVnd(price)}', success: true);
          setState(() {
            _history.insert(
              0,
              ScannedItemRecord(
                sku: sku,
                name: name,
                price: price,
                scannedAt: DateTime.now(),
              ),
            );
            if (_history.length > 15) _history.removeLast();
          });
        } else {
          final code = res is Map ? res['code']?.toString() : null;
          if (code == 'DUPLICATE_SCAN') return;
          final msg = (res is Map ? res['message'] : null)?.toString() ?? 'Không tìm thấy SP';
          await playBeep(success: false);
          _showFeedback(msg, success: false);
        }
      },
    );
  }

  void _openSettingsSheet() {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF0F172A),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) {
        return Padding(
          padding: EdgeInsets.only(
            left: 20,
            right: 20,
            top: 20,
            bottom: MediaQuery.of(ctx).viewInsets.bottom + 24,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                'Cấu hình kết nối (Không dây Wi-Fi / Cáp USB)',
                style: TextStyle(fontSize: 17, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 14),
              TextField(
                controller: _sessionController,
                textCapitalization: TextCapitalization.characters,
                maxLength: 6,
                decoration: const InputDecoration(
                  labelText: 'Mã phiên POS (6 ký tự)',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _serverController,
                decoration: const InputDecoration(
                  labelText: 'Địa chỉ Server Backend',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 10),
              Wrap(
                spacing: 8,
                children: [
                  ActionChip(
                    avatar: const Icon(Icons.wifi, size: 16),
                    label: const Text('Không dây Wi-Fi (192.168.1.20)'),
                    onPressed: () => _serverController.text = _defaultWifiUrl,
                  ),
                  ActionChip(
                    avatar: const Icon(Icons.usb, size: 16),
                    label: const Text('Cáp USB (localhost)'),
                    onPressed: () => _serverController.text = _defaultUsbUrl,
                  ),
                ],
              ),
              const SizedBox(height: 16),
              FilledButton.icon(
                onPressed: () async {
                  final prefs = await SharedPreferences.getInstance();
                  await prefs.setString(_prefServerKey, _serverController.text.trim());
                  if (ctx.mounted) Navigator.pop(ctx);
                  _connectSocket(
                    _serverController.text.trim(),
                    autoJoinSession: _sessionController.text.trim(),
                  );
                },
                icon: const Icon(Icons.link),
                label: const Padding(
                  padding: EdgeInsets.symmetric(vertical: 12),
                  child: Text('Lưu & Kết nối'),
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  @override
  void dispose() {
    _bannerTimer?.cancel();
    _cameraCtrl.dispose();
    _socket?.dispose();
    _sessionController.dispose();
    _serverController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final borderColor = _bannerText == null
        ? const Color(0xFF334155)
        : (_bannerSuccess ? const Color(0xFF10B981) : const Color(0xFFEF4444));

    return Scaffold(
      appBar: AppBar(
        backgroundColor: const Color(0xFF0F172A),
        title: const Row(
          children: [
            Icon(Icons.qr_code_scanner, color: Color(0xFF10B981)),
            SizedBox(width: 8),
            Flexible(
              child: Text(
                'SmartShop Scanner',
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontWeight: FontWeight.bold, fontSize: 17),
              ),
            ),
          ],
        ),
        actions: [
          IconButton(
            tooltip: 'Thử tiếng Bíp',
            onPressed: () => playBeep(success: true),
            icon: const Icon(Icons.volume_up),
          ),
          IconButton(
            tooltip: 'Đèn Flash',
            onPressed: () => _cameraCtrl.toggleTorch(),
            icon: const Icon(Icons.flash_on),
          ),
          IconButton(
            tooltip: 'Đổi phiên / Cài đặt',
            onPressed: _openSettingsSheet,
            icon: const Icon(Icons.tune),
          ),
        ],
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Thanh trạng thái phiên POS
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                decoration: BoxDecoration(
                  color: const Color(0xFF0F172A),
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: const Color(0xFF1E293B)),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Expanded(
                      child: Row(
                        children: [
                          Container(
                            width: 10,
                            height: 10,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              color:
                                  _socketConnected ? const Color(0xFF10B981) : Colors.redAccent,
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  _pairedSessionId != null
                                      ? 'Phiên POS: $_pairedSessionId'
                                      : 'Chưa ghép nối phiên',
                                  style: const TextStyle(
                                    fontWeight: FontWeight.bold,
                                    fontSize: 16,
                                    letterSpacing: 1.2,
                                  ),
                                ),
                                Text(
                                  !_socketConnected
                                      ? 'Đang kết nối ${_serverController.text}…'
                                      : (_posOnline
                                          ? '📶 Đã nối Wi-Fi · POS đang mở'
                                          : '⚠️ Đang chờ mở /pos trên máy tính'),
                                  overflow: TextOverflow.ellipsis,
                                  style: TextStyle(
                                    fontSize: 12,
                                    color: _posOnline
                                        ? const Color(0xFF34D399)
                                        : const Color(0xFFFBBF24),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                    OutlinedButton(
                      onPressed: _openSettingsSheet,
                      child: const Text('Đổi mã'),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 12),

              // Khung Camera quét QR
              Expanded(
                flex: 6,
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 180),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(22),
                    border: Border.all(color: borderColor, width: 4),
                  ),
                  clipBehavior: Clip.antiAlias,
                  child: Stack(
                    fit: StackFit.expand,
                    children: [
                      MobileScanner(
                        controller: _cameraCtrl,
                        onDetect: _onDetect,
                      ),
                      Center(
                        child: Container(
                          width: 220,
                          height: 220,
                          decoration: BoxDecoration(
                            borderRadius: BorderRadius.circular(20),
                            border: Border.all(
                              color: Colors.white.withValues(alpha: 0.65),
                              width: 2,
                            ),
                          ),
                        ),
                      ),
                      if (_bannerText != null)
                        Positioned(
                          bottom: 14,
                          left: 14,
                          right: 14,
                          child: Container(
                            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                            decoration: BoxDecoration(
                              color: _bannerSuccess
                                  ? const Color(0xEE065F46)
                                  : const Color(0xEE7F1D1D),
                              borderRadius: BorderRadius.circular(14),
                            ),
                            child: Text(
                              _bannerText!,
                              textAlign: TextAlign.center,
                              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15),
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 10),

              FilledButton.tonalIcon(
                onPressed: () async {
                  if (_cameraPaused) {
                    await _cameraCtrl.start();
                    setState(() => _cameraPaused = false);
                  } else {
                    await _cameraCtrl.stop();
                    setState(() => _cameraPaused = true);
                  }
                },
                icon: Icon(_cameraPaused ? Icons.play_arrow : Icons.pause),
                label: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 10),
                  child: Text(
                    _cameraPaused ? 'Bật lại Camera' : 'Tạm dừng Camera',
                    style: const TextStyle(fontWeight: FontWeight.bold),
                  ),
                ),
              ),
              const SizedBox(height: 10),

              Expanded(
                flex: 4,
                child: Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: const Color(0xFF0F172A),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: const Color(0xFF1E293B)),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Vừa quét (${_history.length})',
                        style: const TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.bold,
                          color: Color(0xFF94A3B8),
                        ),
                      ),
                      const SizedBox(height: 6),
                      Expanded(
                        child: _history.isEmpty
                            ? const Center(
                                child: Text(
                                  'Chĩa camera vào mã QR trên màn hình /simulator để quét (không cần cắm dây)',
                                  textAlign: TextAlign.center,
                                  style: TextStyle(color: Color(0xFF64748B), fontSize: 13),
                                ),
                              )
                            : ListView.separated(
                                itemCount: _history.length,
                                separatorBuilder: (_, _) =>
                                    const Divider(height: 10, color: Color(0xFF1E293B)),
                                itemBuilder: (context, idx) {
                                  final item = _history[idx];
                                  return Row(
                                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                    children: [
                                      Expanded(
                                        child: Text(
                                          item.name,
                                          overflow: TextOverflow.ellipsis,
                                          style: const TextStyle(
                                            fontWeight: FontWeight.w600,
                                            fontSize: 13,
                                          ),
                                        ),
                                      ),
                                      const SizedBox(width: 8),
                                      Text(
                                        formatVnd(item.price),
                                        style: const TextStyle(
                                          color: Color(0xFF34D399),
                                          fontWeight: FontWeight.bold,
                                          fontSize: 13,
                                        ),
                                      ),
                                    ],
                                  );
                                },
                              ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
