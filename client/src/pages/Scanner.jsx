import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api, formatVND } from '../lib/api.js';
import { socket } from '../lib/socket.js';
import { playScanErrorSound, playScanSuccessSound } from '../lib/sound.js';

const READER_ID = 'qr-reader';
const COOLDOWN_MS = 1500;
const ACK_TIMEOUT_MS = 5000;
const STORAGE_KEY = 'smartshop.sessionId';

/**
 * Đọc mã QR: hỗ trợ cả JSON đầy đủ { sku, name, price, brand, category, unit, barcode }
 * (từ kệ hàng trong DB hoặc ngoài DB) lẫn chuỗi SKU / Barcode thô.
 */
function parseQrText(text) {
  try {
    const obj = JSON.parse(text);
    if (obj && typeof obj === 'object') {
      const rawSku = obj.sku ?? obj.barcode ?? obj.id;
      const sku = typeof rawSku === 'string' ? rawSku.trim().toUpperCase() : null;
      return { sku, qrData: obj };
    }
  } catch {
    /* không phải JSON -> coi là mã SKU/barcode thô */
  }
  const raw = String(text ?? '').trim().toUpperCase();
  const sku = /^[A-Z0-9_-]{1,32}$/.test(raw) ? raw : null;
  return { sku, qrData: null };
}

const vibrate = (pattern) => navigator.vibrate?.(pattern);

function cameraErrorMessage(err) {
  const msg = String(err?.message ?? err);
  if (/NotAllowed|Permission/i.test(msg))
    return 'Bạn đã chặn quyền camera. Vào cài đặt trang web của Chrome để cho phép.';
  if (/NotFound|Requested device not found/i.test(msg))
    return 'Không tìm thấy camera trên thiết bị.';
  if (/secure context|https/i.test(msg))
    return 'Camera chỉ hoạt động trên HTTPS hoặc localhost.';
  return `Không bật được camera: ${msg}`;
}

/**
 * Mobile Scanner: ghép nối với POS qua mã phiên, bật camera quét QR -> emit SCAN_ITEM { sku, qrData }.
 * Hỗ trợ thêm nút "Bắn nhanh mã SP" để test ngay cả khi chưa bật camera.
 */
export default function Scanner() {
  const [searchParams] = useSearchParams();
  const querySession = searchParams.get('session');

  const [code, setCode] = useState(() => querySession ?? localStorage.getItem(STORAGE_KEY) ?? '');
  const [session, setSession] = useState(null);
  const [connected, setConnected] = useState(socket.connected);
  const [pairing, setPairing] = useState(false);
  const [pairError, setPairError] = useState('');
  const [cameraOn, setCameraOn] = useState(false);
  const [toast, setToast] = useState(null);
  const [history, setHistory] = useState([]);
  const [quickProducts, setQuickProducts] = useState([]);

  const sessionIdRef = useRef(null);
  const scannerRef = useRef(null);
  const wakeLockRef = useRef(null);
  const lastScanRef = useRef({ sku: null, at: 0 });
  const toastTimerRef = useRef(null);

  const showToast = (type, text) => {
    clearTimeout(toastTimerRef.current);
    setToast({ type, text });
    toastTimerRef.current = setTimeout(() => setToast(null), 2000);
  };

  async function joinSession(sessionId) {
    const res = await socket.timeout(ACK_TIMEOUT_MS).emitWithAck('JOIN_SESSION', {
      sessionId,
      role: 'scanner',
    });
    if (!res.ok) throw new Error(res.message);
    return res.session;
  }

  async function pair(rawCode) {
    const sessionId = rawCode.trim().toUpperCase();
    setPairing(true);
    setPairError('');
    try {
      const joined = await joinSession(sessionId);
      sessionIdRef.current = joined.sessionId;
      localStorage.setItem(STORAGE_KEY, joined.sessionId);
      setSession(joined);
      vibrate(50);
    } catch (err) {
      setPairError(
        err.message === 'operation has timed out' ? 'Không kết nối được server' : err.message,
      );
    } finally {
      setPairing(false);
    }
  }

  async function unpair() {
    await stopCamera();
    sessionIdRef.current = null;
    setSession(null);
    setHistory([]);
    socket.disconnect().connect();
  }

  useEffect(() => {
    api('/products')
      .then(setQuickProducts)
      .catch(() => {});
  }, []);

  // --- Vòng đời socket ---------------------------------------------------
  useEffect(() => {
    const onConnect = async () => {
      setConnected(true);
      if (!sessionIdRef.current) return;
      try {
        setSession(await joinSession(sessionIdRef.current));
      } catch {
        sessionIdRef.current = null;
        setSession(null);
        setPairError('Phiên cũ đã hết hạn, vui lòng nhập mã mới.');
      }
    };
    const onDisconnect = () => setConnected(false);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('SESSION_STATE', setSession);
    socket.connect();

    if (querySession) pair(querySession);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('SESSION_STATE', setSession);
      socket.disconnect();
      clearTimeout(toastTimerRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(
    () => () => {
      if (scannerRef.current?.isScanning) scannerRef.current.stop().catch(() => {});
      wakeLockRef.current?.release().catch(() => {});
    },
    [],
  );

  // --- Xử lý quét & gửi lên Server ---------------------------------------
  async function sendScan(sku, qrData = null) {
    const now = Date.now();
    try {
      const res = await socket.timeout(ACK_TIMEOUT_MS).emitWithAck('SCAN_ITEM', { sku, qrData });
      if (res.ok) {
        playScanSuccessSound();
        vibrate(80);
        showToast('success', `✓ ${res.product.name} (${formatVND(res.product.price)})`);
        setHistory((h) => [{ key: `${sku}-${now}`, product: res.product, at: now }, ...h].slice(0, 12));
      } else if (res.code !== 'DUPLICATE_SCAN') {
        playScanErrorSound();
        vibrate([80, 60, 80]);
        showToast('error', res.message);
      }
    } catch {
      playScanErrorSound();
      vibrate([80, 60, 80]);
      showToast('error', 'Mất kết nối server');
    }
  }

  async function onDecoded(text) {
    const { sku, qrData } = parseQrText(text);
    const now = Date.now();
    const key = sku ?? text;
    if (lastScanRef.current.sku === key && now - lastScanRef.current.at < COOLDOWN_MS) return;
    lastScanRef.current = { sku: key, at: now };

    if (!sku) {
      playScanErrorSound();
      vibrate([80, 60, 80]);
      return showToast('error', 'Mã QR không chứa SKU hợp lệ');
    }
    await sendScan(sku, qrData);
  }

  async function startCamera() {
    try {
      scannerRef.current ??= new Html5Qrcode(READER_ID, {
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
        experimentalFeatures: { useBarCodeDetectorIfSupported: true },
        verbose: false,
      });
      await scannerRef.current.start(
        { facingMode: 'environment' },
        {
          fps: 12,
          qrbox: (w, h) => {
            const size = Math.floor(Math.min(w, h) * 0.72);
            return { width: size, height: size };
          },
        },
        onDecoded,
        () => {},
      );
      setCameraOn(true);
      wakeLockRef.current = await navigator.wakeLock?.request('screen').catch(() => null);
    } catch (err) {
      showToast('error', cameraErrorMessage(err));
    }
  }

  async function stopCamera() {
    if (scannerRef.current?.isScanning) await scannerRef.current.stop().catch(() => {});
    await wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
    setCameraOn(false);
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-4 py-4">
      <header className="flex items-center justify-between">
        <Link to="/" className="text-lg font-bold">
          📱 Mobile Scanner
        </Link>
        <span className="flex items-center gap-2 text-sm text-slate-400">
          <span className={`size-2.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-red-500'}`} />
          {connected ? 'Online' : 'Mất kết nối'}
        </span>
      </header>

      {!session ? (
        <form
          className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            pair(code);
          }}
        >
          <label htmlFor="session-code" className="font-semibold">
            Mã phiên POS
          </label>
          <input
            id="session-code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            required
            minLength={6}
            maxLength={6}
            pattern="[A-Za-z0-9]{6}"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            aria-describedby="session-hint"
            placeholder="VD: 7EXUV4"
            className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-center font-mono text-2xl tracking-[0.4em] uppercase outline-none focus:border-emerald-500"
          />
          <p id="session-hint" className="text-sm text-slate-400">
            Mã 6 ký tự hiển thị trên màn hình thu ngân (/pos).
          </p>
          {pairError && (
            <p role="alert" className="text-sm text-red-400">
              {pairError}
            </p>
          )}
          <button
            type="submit"
            disabled={pairing || !connected}
            className="rounded-xl bg-emerald-600 py-3 font-semibold hover:bg-emerald-500 disabled:opacity-50"
          >
            {pairing ? 'Đang ghép nối…' : 'Ghép nối'}
          </button>
        </form>
      ) : (
        <section className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3">
          <div>
            <p className="text-sm text-slate-400">Đã ghép nối phiên</p>
            <p className="font-mono text-xl font-bold tracking-widest">{session.sessionId}</p>
            <p className={`text-sm ${session.posConnected ? 'text-emerald-400' : 'text-amber-400'}`}>
              {session.posConnected ? '🖥️ POS đang mở' : '⚠️ POS chưa mở / đã đóng'}
            </p>
          </div>
          <button
            type="button"
            onClick={unpair}
            className="rounded-lg border border-slate-700 px-3 py-2 text-sm"
          >
            Đổi phiên
          </button>
        </section>
      )}

      {/* Vùng camera luôn có trong DOM để html5-qrcode gắn thẻ <video> */}
      <section hidden={!session} className="flex flex-col gap-3">
        <div
          className={`relative overflow-hidden rounded-2xl border-4 bg-black transition-colors ${
            toast?.type === 'success'
              ? 'border-emerald-400'
              : toast?.type === 'error'
                ? 'border-red-500'
                : 'border-slate-800'
          }`}
        >
          <div id={READER_ID} className="aspect-square w-full [&_video]:object-cover" />
          {!cameraOn && (
            <p className="absolute inset-0 grid place-items-center text-slate-500">Camera đang tắt</p>
          )}
        </div>

        <button
          type="button"
          onClick={cameraOn ? stopCamera : startCamera}
          className={`rounded-xl py-4 text-lg font-semibold ${
            cameraOn ? 'bg-slate-700' : 'bg-emerald-600 hover:bg-emerald-500'
          }`}
        >
          {cameraOn ? '⏹ Tắt camera' : '📷 Bật camera quét QR'}
        </button>

        <p
          role="status"
          aria-live="polite"
          className={`min-h-6 text-center font-medium ${
            toast?.type === 'error' ? 'text-red-400' : 'text-emerald-400'
          }`}
        >
          {toast?.text}
        </p>

        {/* Bàn phím chọn nhanh SP trên điện thoại khi lười đưa camera */}
        {quickProducts.length > 0 && (
          <details className="rounded-xl border border-slate-800 bg-slate-900 p-3">
            <summary className="cursor-pointer text-sm font-medium text-slate-300">
              ⚡ Bấm chọn nhanh SP (không cần bật camera)
            </summary>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {quickProducts.map((p) => (
                <button
                  key={p.sku}
                  type="button"
                  onClick={() => sendScan(p.sku, p)}
                  className="rounded-lg border border-slate-800 bg-slate-950 p-2 text-left text-xs hover:border-emerald-500"
                >
                  <div className="truncate font-semibold text-slate-200">{p.name}</div>
                  <div className="mt-0.5 text-emerald-400">{formatVND(p.price)}</div>
                </button>
              ))}
            </div>
          </details>
        )}

        {history.length > 0 && (
          <section>
            <h2 className="mb-2 text-sm font-semibold text-slate-400">Vừa quét ({history.length})</h2>
            <ul className="flex flex-col gap-2">
              {history.map((item) => (
                <li
                  key={item.key}
                  className="flex justify-between rounded-lg bg-slate-900 px-3 py-2 text-sm"
                >
                  <span className="truncate pr-2">{item.product.name}</span>
                  <span className="shrink-0 text-emerald-400">{formatVND(item.product.price)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </section>
    </main>
  );
}
