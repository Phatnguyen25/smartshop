import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api, formatVND } from '../lib/api.js';
import { socket } from '../lib/socket.js';
import { playScanErrorSound, playScanSuccessSound } from '../lib/sound.js';

const STORAGE_KEY = 'smartshop.sessionId';
const DEFAULT_SESSION = '7EXUV4'; // Khớp sẵn với phiên điện thoại đang mở để test ngay

const EMOJI = {
  COCA01: '🥤',
  THMILK01: '🥛',
  HIGHLAND01: '☕',
  AQUA01: '💧',
  BANHMI01: '🥖',
  KIMBAP01: '🍙',
  XUCXICH01: '🌭',
  HAOHAO01: '🍜',
  OMACHI01: '🍲',
  SNACK01: '🍟',
  OREO01: '🍪',
  CHINSU01: '🌶️',
  TEAPLUS01: '🍵',
  YAKULT01: '🍼',
  THOPHAT01: '🥟',
  CELANO01: '🍦',
};

// Tập luật kết hợp FP-Growth (Association Rules) gợi ý bán chéo theo giỏ hàng hiện tại
const FP_GROWTH_RULES = {
  COCA01: [
    { sku: 'SNACK01', confidence: 78, reason: 'Khách mua Coca-Cola thường mua kèm Snack khoai tây' },
    { sku: 'XUCXICH01', confidence: 64, reason: 'Combo đồ uống có gas + xúc xích ăn liền' },
  ],
  AQUA01: [
    { sku: 'BANHMI01', confidence: 72, reason: 'Khách mua nước suối hay mua kèm bánh mì ăn nhanh' },
  ],
  BANHMI01: [
    { sku: 'THMILK01', confidence: 82, reason: 'Combo bữa sáng dinh dưỡng: Bánh mì + Sữa tươi TH' },
    { sku: 'HIGHLAND01', confidence: 74, reason: 'Combo tỉnh táo buổi sáng: Bánh mì + Cà phê sữa đá' },
  ],
  KIMBAP01: [
    { sku: 'COCA01', confidence: 80, reason: 'Combo bữa trưa tiện lợi Circle K: Kimbap + Coca-Cola' },
    { sku: 'THMILK01', confidence: 68, reason: 'Khách mua Kimbap thường chọn thêm sữa tươi' },
  ],
  HAOHAO01: [
    { sku: 'XUCXICH01', confidence: 86, reason: '86% khách mua mì gói lấy thêm xúc xích ăn kèm' },
    { sku: 'CHINSU01', confidence: 62, reason: 'Mua kèm tương ớt Chin-Su dùng tại nhà' },
  ],
  OMACHI01: [
    { sku: 'XUCXICH01', confidence: 84, reason: 'Topping ăn kèm mì tô Omachi' },
    { sku: 'COCA01', confidence: 70, reason: 'Combo mì tô + nước ngọt giải khát' },
  ],
  SNACK01: [
    { sku: 'COCA01', confidence: 81, reason: 'Khách mua Snack khoai tây rất hay mua thêm Coca-Cola' },
  ],
  OREO01: [
    { sku: 'THMILK01', confidence: 85, reason: 'Combo kinh điển: Bánh quy Oreo chấm sữa tươi TH' },
  ],
};

function attachDialogLightDismiss(dialog) {
  if (!dialog || 'closedBy' in HTMLDialogElement.prototype) return () => {};
  let pressedOutside = false;
  const isOutside = (e) => {
    const r = dialog.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };
  const onDown = (e) => {
    pressedOutside = isOutside(e);
  };
  const onUp = (e) => {
    if (pressedOutside && isOutside(e)) dialog.close();
  };
  dialog.addEventListener('pointerdown', onDown);
  dialog.addEventListener('pointerup', onUp);
  return () => {
    dialog.removeEventListener('pointerdown', onDown);
    dialog.removeEventListener('pointerup', onUp);
  };
}

/**
 * Web 1 - Smart POS (Màn hình thu ngân)
 * Lắng nghe ITEM_SCANNED từ điện thoại qua Socket.io, tự động nhảy sản phẩm vào giỏ hàng,
 * gợi ý bán chéo AI (FP-Growth) và thanh toán trừ kho theo lô FEFO.
 */
export default function Pos() {
  const [searchParams] = useSearchParams();
  const initialSession =
    searchParams.get('session')?.toUpperCase() ||
    localStorage.getItem(STORAGE_KEY) ||
    DEFAULT_SESSION;

  const [sessionId, setSessionId] = useState(initialSession);
  const [sessionState, setSessionState] = useState({
    sessionId: initialSession,
    posConnected: false,
    scannerCount: 0,
  });
  const [connected, setConnected] = useState(socket.connected);
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]); // [{ product, quantity }]
  const [lastScanned, setLastScanned] = useState(null); // { sku, scanId, at }
  const [scanError, setScanError] = useState('');
  const [checkingOut, setCheckingOut] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');
  const [receipt, setReceipt] = useState(null);

  const seenScanIdsRef = useRef(new Set());
  const pairDialogRef = useRef(null);
  const receiptDialogRef = useRef(null);

  const loadProducts = () =>
    api('/products')
      .then(setProducts)
      .catch(() => {});

  useEffect(() => {
    loadProducts();
  }, []);

  useEffect(() => attachDialogLightDismiss(pairDialogRef.current), []);
  useEffect(() => attachDialogLightDismiss(receiptDialogRef.current), []);

  // Thêm 1 sản phẩm vào giỏ hàng (dùng chung cho cả quét điện thoại & bấm trên màn hình POS)
  const addToCart = (product, qty = 1, scanId = null) => {
    setCheckoutError('');
    setScanError('');
    setCart((prev) => {
      const idx = prev.findIndex((item) => item.product.sku === product.sku);
      if (idx === -1) return [{ product, quantity: qty }, ...prev];
      return prev.map((item, i) =>
        i === idx ? { product, quantity: item.quantity + qty } : item,
      );
    });
    setLastScanned({ sku: product.sku, scanId: scanId ?? `${product.sku}-${Date.now()}` });
    // Nếu là SP mới tự đồng bộ từ QR ngoài DB -> cập nhật danh sách kệ hàng bên dưới
    setProducts((prev) =>
      prev.some((p) => p.sku === product.sku) ? prev : [product, ...prev],
    );
  };

  // --- Lắng nghe WebSocket (JOIN_SESSION & ITEM_SCANNED) -----------------
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, sessionId);

    const joinRoom = async () => {
      setConnected(true);
      try {
        const res = await socket.timeout(5000).emitWithAck('JOIN_SESSION', {
          sessionId,
          role: 'pos',
        });
        if (res?.ok) setSessionState(res.session);
      } catch {
        /* tự thử lại ở lần reconnect tiếp theo */
      }
    };

    const onDisconnect = () => setConnected(false);

    const onItemScanned = ({ scanId, product, quantity = 1 }) => {
      if (scanId && seenScanIdsRef.current.has(scanId)) return;
      if (scanId) seenScanIdsRef.current.add(scanId);
      playScanSuccessSound();
      addToCart(product, quantity, scanId);
    };

    const onScanError = ({ message }) => {
      playScanErrorSound();
      setScanError(message || 'Không nhận diện được sản phẩm');
    };

    socket.on('connect', joinRoom);
    socket.on('disconnect', onDisconnect);
    socket.on('SESSION_STATE', setSessionState);
    socket.on('ITEM_SCANNED', onItemScanned);
    socket.on('SCAN_ERROR', onScanError);
    socket.on('PRODUCTS_UPDATED', loadProducts);
    socket.on('INVENTORY_UPDATED', loadProducts);

    if (socket.connected) joinRoom();
    else socket.connect();

    return () => {
      socket.off('connect', joinRoom);
      socket.off('disconnect', onDisconnect);
      socket.off('SESSION_STATE', setSessionState);
      socket.off('ITEM_SCANNED', onItemScanned);
      socket.off('SCAN_ERROR', onScanError);
      socket.off('PRODUCTS_UPDATED', loadProducts);
      socket.off('INVENTORY_UPDATED', loadProducts);
    };
  }, [sessionId]);

  async function handleNewSession() {
    try {
      const created = await api('/sessions', { method: 'POST' });
      setSessionId(created.sessionId);
    } catch (err) {
      setScanError(err.message);
    }
  }

  function updateQuantity(sku, delta) {
    setCart((prev) =>
      prev
        .map((item) =>
          item.product.sku === sku ? { ...item, quantity: item.quantity + delta } : item,
        )
        .filter((item) => item.quantity > 0),
    );
  }

  function removeItem(sku) {
    setCart((prev) => prev.filter((item) => item.product.sku !== sku));
  }

  const totalItems = useMemo(
    () => cart.reduce((sum, item) => sum + item.quantity, 0),
    [cart],
  );
  const totalAmount = useMemo(
    () => cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0),
    [cart],
  );

  // Tính toán gợi ý bán chéo (FP-Growth) từ các SP đang có trong giỏ
  const suggestions = useMemo(() => {
    const inCartSkus = new Set(cart.map((i) => i.product.sku));
    const byProduct = new Map(products.map((p) => [p.sku, p]));
    const picked = new Map();

    for (const item of cart) {
      const rules = FP_GROWTH_RULES[item.product.sku] ?? [];
      for (const rule of rules) {
        if (inCartSkus.has(rule.sku) || picked.has(rule.sku)) continue;
        const target = byProduct.get(rule.sku);
        if (target && target.stock > 0) {
          picked.set(rule.sku, { ...rule, product: target });
        }
      }
    }
    return [...picked.values()].sort((a, b) => b.confidence - a.confidence).slice(0, 3);
  }, [cart, products]);

  async function handleCheckout() {
    if (cart.length === 0 || checkingOut) return;
    setCheckingOut(true);
    setCheckoutError('');
    try {
      const order = await api('/orders', {
        method: 'POST',
        body: JSON.stringify({
          sessionId,
          items: cart.map((i) => ({ sku: i.product.sku, quantity: i.quantity })),
        }),
      });
      setCart([]);
      setLastScanned(null);
      setReceipt(order);
      receiptDialogRef.current?.showModal();
      loadProducts();
    } catch (err) {
      setCheckoutError(err.message);
    } finally {
      setCheckingOut(false);
    }
  }

  const scannerUrl = `http://192.168.1.20:5173/scanner?session=${sessionId}&server=${encodeURIComponent('http://192.168.1.20:4000')}`;

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      {/* Thanh trạng thái quầy thu ngân & phiên ghép nối */}
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-900 px-5 py-4">
        <div>
          <Link to="/" className="text-xs text-slate-400 hover:text-slate-200">
            ← Trang chủ
          </Link>
          <div className="mt-0.5 flex items-center gap-3">
            <h1 className="text-2xl font-bold">🖥️ Smart POS — Quầy Thu Ngân</h1>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
                connected
                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-700/60'
                  : 'bg-red-950 text-red-300 border border-red-800'
              }`}
            >
              <span className={`size-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-red-400'}`} />
              {connected ? 'Socket Online' : 'Mất kết nối'}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-2">
            <div className="text-[11px] uppercase tracking-wider text-slate-400">Mã phiên ghép nối</div>
            <div className="flex items-center gap-2.5">
              <span className="font-mono text-2xl font-bold tracking-widest text-emerald-400">
                {sessionId}
              </span>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  sessionState.scannerCount > 0
                    ? 'bg-emerald-900/60 text-emerald-300'
                    : 'bg-amber-950 text-amber-300'
                }`}
              >
                📱 {sessionState.scannerCount} điện thoại
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={playScanSuccessSound}
            className="rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2.5 text-xs font-semibold hover:border-emerald-500"
          >
            🔊 Thử tiếng Bíp
          </button>
          <button
            type="button"
            onClick={() => pairDialogRef.current?.showModal()}
            className="rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2.5 text-xs font-semibold hover:border-emerald-500"
          >
            📲 QR Ghép nối ĐT
          </button>
          <button
            type="button"
            onClick={handleNewSession}
            className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs text-slate-300 hover:border-slate-600"
          >
            Tạo mã mới
          </button>
        </div>
      </header>

      {scanError && (
        <p
          role="alert"
          className="mb-4 rounded-xl border border-red-800 bg-red-950/60 px-4 py-3 text-sm text-red-300"
        >
          ⚠️ {scanError}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Cột trái (8/12): Giỏ hàng real-time + AI Cross-sell */}
        <section className="flex flex-col gap-5 lg:col-span-8">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 id="cart-table-caption" className="text-lg font-bold">
                🛒 Giỏ hàng hiện tại ({totalItems} món)
              </h2>
              {cart.length > 0 && (
                <button
                  type="button"
                  onClick={() => setCart([])}
                  className="text-xs text-slate-400 hover:text-red-400"
                >
                  Xoá trống giỏ
                </button>
              )}
            </div>

            {cart.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-800 py-14 text-center">
                <p className="text-4xl">📱➔🖥️</p>
                <p className="mt-3 font-medium text-slate-300">
                  Chưa có sản phẩm nào trong giỏ hàng
                </p>
                <p className="mt-1 text-sm text-slate-400">
                  Dùng điện thoại mở <code className="text-emerald-300">/scanner?session={sessionId}</code> quét mã QR từ{' '}
                  <Link to="/simulator" target="_blank" className="text-emerald-400 underline">
                    /simulator
                  </Link>
                  , sản phẩm sẽ tự động nhảy vào đây!
                </p>
              </div>
            ) : (
              <div
                tabIndex={0}
                role="region"
                aria-labelledby="cart-table-caption"
                className="max-h-[420px] max-w-full overflow-auto rounded-xl border border-slate-800"
              >
                <table className="w-full border-separate border-spacing-0 text-left text-sm">
                  <thead className="sticky top-0 z-10 bg-slate-950 text-xs uppercase text-slate-400">
                    <tr>
                      <th scope="col" className="px-4 py-3">
                        Sản phẩm
                      </th>
                      <th scope="col" className="px-3 py-3 text-right">
                        Đơn giá
                      </th>
                      <th scope="col" className="px-3 py-3 text-center">
                        Số lượng
                      </th>
                      <th scope="col" className="px-4 py-3 text-right">
                        Thành tiền
                      </th>
                      <th scope="col" className="px-3 py-3 text-center">
                        Xoá
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80">
                    {cart.map(({ product, quantity }) => {
                      const isJustScanned = lastScanned?.sku === product.sku;
                      return (
                        <tr
                          key={product.sku}
                          className={`transition-colors ${
                            isJustScanned ? 'bg-emerald-950/40' : 'bg-slate-900'
                          }`}
                        >
                          <th
                            scope="row"
                            className="sticky left-0 bg-inherit px-4 py-3 font-medium text-slate-100"
                          >
                            <div className="flex items-center gap-2.5">
                              <span aria-hidden="true" className="text-xl">
                                {EMOJI[product.sku] ?? '📦'}
                              </span>
                              <div>
                                <div className="font-semibold">
                                  {product.name}{' '}
                                  {isJustScanned && (
                                    <span className="ml-1.5 rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
                                      Vừa quét
                                    </span>
                                  )}
                                </div>
                                <div className="text-xs font-normal text-slate-400">
                                  <code>{product.sku}</code> · {product.unit ?? 'Cái'} · Tồn:{' '}
                                  {product.stock ?? '—'}
                                </div>
                              </div>
                            </div>
                          </th>
                          <td className="px-3 py-3 text-right text-slate-300">
                            {formatVND(product.price)}
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex items-center justify-center gap-2">
                              <button
                                type="button"
                                aria-label={`Giảm số lượng ${product.name}`}
                                onClick={() => updateQuantity(product.sku, -1)}
                                className="size-7 rounded-lg border border-slate-700 bg-slate-800 font-bold hover:border-slate-500"
                              >
                                −
                              </button>
                              <span className="w-7 text-center font-mono font-bold">
                                {quantity}
                              </span>
                              <button
                                type="button"
                                aria-label={`Tăng số lượng ${product.name}`}
                                onClick={() => updateQuantity(product.sku, 1)}
                                className="size-7 rounded-lg border border-slate-700 bg-slate-800 font-bold hover:border-slate-500"
                              >
                                +
                              </button>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right font-semibold text-emerald-400">
                            {formatVND(product.price * quantity)}
                          </td>
                          <td className="px-3 py-3 text-center">
                            <button
                              type="button"
                              aria-label={`Xoá ${product.name} khỏi giỏ`}
                              onClick={() => removeItem(product.sku)}
                              className="text-slate-500 hover:text-red-400"
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Gợi ý bán chéo AI (FP-Growth) */}
          {suggestions.length > 0 && (
            <section className="rounded-2xl border border-emerald-800/50 bg-emerald-950/20 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-bold text-emerald-300">
                  🤖 AI Gợi ý bán kèm (Thuật toán FP-Growth)
                </h3>
                <span className="text-xs text-slate-400">Nên mời khách mua thêm</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {suggestions.map(({ product, confidence, reason }) => (
                  <article
                    key={product.sku}
                    className="flex flex-col justify-between gap-2 rounded-xl border border-slate-800 bg-slate-900 p-3"
                  >
                    <div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="rounded bg-emerald-900/60 px-2 py-0.5 font-semibold text-emerald-300">
                          Độ tin cậy {confidence}%
                        </span>
                        <span className="font-bold text-emerald-400">
                          {formatVND(product.price)}
                        </span>
                      </div>
                      <h4 className="mt-1.5 text-sm font-semibold">
                        {EMOJI[product.sku] ?? '🛒'} {product.name}
                      </h4>
                      <p className="mt-1 text-xs text-slate-400">{reason}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => addToCart(product, 1)}
                      className="mt-1 rounded-lg bg-emerald-600/90 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
                    >
                      + Thêm vào giỏ
                    </button>
                  </article>
                ))}
              </div>
            </section>
          )}

          {/* Chọn nhanh sản phẩm tại quầy (phòng khi thu ngân muốn bấm tay) */}
          <details className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
            <summary className="cursor-pointer text-sm font-semibold text-slate-300">
              ⌨️ Bấm chọn nhanh sản phẩm tại quầy ({products.length} SP)
            </summary>
            <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {products.map((p) => (
                <button
                  key={p.sku}
                  type="button"
                  disabled={p.stock <= 0}
                  onClick={() => addToCart(p, 1)}
                  className="flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-950 p-3 text-left text-xs transition hover:border-emerald-500 disabled:opacity-40"
                >
                  <div>
                    <div className="font-semibold text-slate-100">
                      {EMOJI[p.sku] ?? '🛒'} {p.name}
                    </div>
                    <div className="mt-1 text-[11px] text-slate-400">
                      <code>{p.sku}</code> · Tồn: {p.stock}
                    </div>
                  </div>
                  <div className="mt-2 font-bold text-emerald-400">{formatVND(p.price)}</div>
                </button>
              ))}
            </div>
          </details>
        </section>

        {/* Cột phải (4/12): Tổng tiền & Thanh toán FEFO */}
        <aside className="flex flex-col gap-4 lg:col-span-4">
          <div className="sticky top-6 rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <h2 className="text-lg font-bold">💳 Thanh toán đơn hàng</h2>
            <p className="mt-1 text-xs text-slate-400">
              Hệ thống tự động trừ kho theo nguyên tắc <strong>FEFO</strong> (Lô hết hạn sớm nhất xuất trước, tự động bỏ qua lô đã quá hạn).
            </p>

            <dl className="mt-5 space-y-2.5 border-y border-slate-800 py-4 text-sm">
              <div className="flex justify-between text-slate-400">
                <dt>Số mặt hàng</dt>
                <dd className="font-mono text-slate-200">{cart.length}</dd>
              </div>
              <div className="flex justify-between text-slate-400">
                <dt>Tổng số lượng</dt>
                <dd className="font-mono text-slate-200">{totalItems}</dd>
              </div>
              <div className="flex items-baseline justify-between pt-2 text-base font-bold">
                <dt>Tổng thanh toán</dt>
                <dd className="text-2xl text-emerald-400">{formatVND(totalAmount)}</dd>
              </div>
            </dl>

            {checkoutError && (
              <p
                role="alert"
                className="mt-3 rounded-xl border border-red-800 bg-red-950/60 p-3 text-xs text-red-300"
              >
                {checkoutError}
              </p>
            )}

            <button
              type="button"
              disabled={cart.length === 0 || checkingOut}
              onClick={handleCheckout}
              className="mt-5 w-full rounded-xl bg-emerald-600 py-4 text-base font-bold text-white shadow-lg transition hover:bg-emerald-500 disabled:opacity-40"
            >
              {checkingOut ? 'Đang xử lý FEFO…' : `Thanh toán ${formatVND(totalAmount)}`}
            </button>
          </div>
        </aside>
      </div>

      {/* Modal QR ghép nối điện thoại */}
      <dialog
        ref={pairDialogRef}
        {...{ closedby: 'any' }}
        onClose={() => {
          if (pairDialogRef.current) pairDialogRef.current.returnValue = '';
        }}
        className="m-auto w-full max-w-sm rounded-3xl border border-slate-700 bg-slate-900 p-6 text-center text-slate-100 shadow-2xl backdrop:bg-black/80"
      >
        <h2 className="text-lg font-bold">📲 Ghép nối Điện thoại với POS</h2>
        <p className="mt-1 text-xs text-slate-400">
          Nhập mã <strong className="text-emerald-300">{sessionId}</strong> tại trang <code>/scanner</code> hoặc quét mã dưới đây:
        </p>
        <div className="mx-auto my-4 inline-block rounded-2xl bg-white p-4">
          <QRCodeSVG value={scannerUrl} size={220} level="M" marginSize={2} />
        </div>
        <p className="mb-4 break-all font-mono text-xs text-slate-400">{scannerUrl}</p>
        <form method="dialog">
          <button
            type="submit"
            className="w-full rounded-xl bg-slate-800 py-2.5 text-sm font-semibold hover:bg-slate-700"
          >
            Đóng
          </button>
        </form>
      </dialog>

      {/* Modal Hoá đơn & Chi tiết trừ lô FEFO */}
      <dialog
        ref={receiptDialogRef}
        {...{ closedby: 'any' }}
        onClose={() => {
          if (receiptDialogRef.current) receiptDialogRef.current.returnValue = '';
        }}
        className="m-auto w-full max-w-lg rounded-3xl border border-slate-700 bg-slate-900 p-6 text-slate-100 shadow-2xl backdrop:bg-black/80"
      >
        {receipt && (
          <div>
            <div className="flex items-center justify-between">
              <span className="rounded-full bg-emerald-900/60 px-3 py-1 text-xs font-semibold text-emerald-300">
                ✓ Thanh toán thành công
              </span>
              <span className="font-mono text-xs text-slate-400">Đơn #{receipt.orderId}</span>
            </div>
            <h2 className="mt-2 text-xl font-bold">Hoá đơn &amp; Chi tiết xuất lô (FEFO)</h2>
            <ul className="mt-4 divide-y divide-slate-800 border-y border-slate-800 py-3 text-sm">
              {receipt.items.map((item) => (
                <li key={item.sku} className="py-2.5">
                  <div className="flex justify-between font-semibold">
                    <span>
                      {item.name} × {item.quantity}
                    </span>
                    <span className="text-emerald-400">{formatVND(item.lineTotal)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-slate-400">
                    {item.allocations.map((alloc) => (
                      <span
                        key={alloc.batchCode}
                        className="rounded bg-slate-800 px-2 py-0.5 font-mono text-[11px]"
                      >
                        Lô {alloc.batchCode} (-{alloc.quantity}, HSD: {alloc.expiryDate})
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex justify-between text-lg font-bold">
              <span>Tổng cộng</span>
              <span className="text-emerald-400">{formatVND(receipt.totalAmount)}</span>
            </div>
            <form method="dialog" className="mt-5">
              <button
                type="submit"
                className="w-full rounded-xl bg-emerald-600 py-3 font-semibold text-white hover:bg-emerald-500"
              >
                Hoàn tất &amp; Bán đơn tiếp theo
              </button>
            </form>
          </div>
        )}
      </dialog>
    </main>
  );
}
