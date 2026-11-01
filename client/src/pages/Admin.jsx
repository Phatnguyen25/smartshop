import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { api, formatVND } from '../lib/api.js';
import { socket } from '../lib/socket.js';

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

const STATUS_META = {
  EXPIRED: {
    title: '🚫 Đã hết hạn — Cấm bán',
    shortDesc: 'Hệ thống đã tự khoá không cho tính tiền món này. Hãy bỏ khỏi kệ ngay!',
    badgeCls: 'border-red-600 bg-red-950 text-red-200',
    cardCls: 'border-red-700/80 bg-red-950/25',
    barCls: 'bg-red-500',
  },
  CRITICAL: {
    title: '🔥 Sắp hết hạn (1–2 ngày nữa)',
    shortDesc: 'Cần đẩy ra đầu kệ hoặc giảm giá bán gấp trong hôm nay!',
    badgeCls: 'border-orange-500 bg-orange-950 text-orange-200',
    cardCls: 'border-orange-600/70 bg-orange-950/20',
    barCls: 'bg-orange-500',
  },
  WARNING: {
    title: '⚠️ Cận hạn (3–7 ngày nữa)',
    shortDesc: 'Hệ thống đang ưu tiên trừ kho đợt hàng này trước.',
    badgeCls: 'border-amber-500 bg-amber-950 text-amber-200',
    cardCls: 'border-amber-600/60 bg-amber-950/15',
    barCls: 'bg-amber-400',
  },
  GOOD: {
    title: '🟢 Hạn còn dài (An toàn)',
    shortDesc: 'Hàng mới, yên tâm bảo quản và bán bình thường.',
    badgeCls: 'border-emerald-700 bg-emerald-950 text-emerald-200',
    cardCls: 'border-slate-800 bg-slate-900',
    barCls: 'bg-emerald-500',
  },
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

function defaultExpiryDate(daysAhead = 60) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

/** Đổi ngày YYYY-MM-DD sang DD/MM/YYYY thân thiện người Việt */
function formatVNDate(isoDate) {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-');
  return d && m && y ? `${d}/${m}/${y}` : isoDate;
}

/** Tính % độ tươi của lô hàng (0% -> 100%) để vẽ thanh màu trực quan */
function freshnessPercent(daysUntilExpiry) {
  if (daysUntilExpiry < 0) return 100;
  if (daysUntilExpiry <= 2) return 18;
  if (daysUntilExpiry <= 7) return 42;
  return Math.min(100, Math.round(50 + (daysUntilExpiry / 180) * 50));
}

/**
 * Web 3 - Trang Quản lý Cửa hàng (Thiết kế thân thiện, dễ hiểu cho mọi chủ tiệm)
 */
export default function Admin() {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('EXPIRY'); // EXPIRY | RESTOCK | TIPS
  const [expiryFilter, setExpiryFilter] = useState('ALL'); // ALL | ATTENTION | EXPIRED | GOOD
  const [viewMode, setViewMode] = useState('GROUPED'); // GROUPED (theo từng món) | BATCHES (theo từng đợt)
  const [submitting, setSubmitting] = useState(false);

  const restockDialogRef = useRef(null);
  const [restockForm, setRestockForm] = useState({
    sku: 'COCA01',
    batchCode: `DOT-${new Date().toISOString().slice(5, 10).replace('-', '')}`,
    quantity: 48,
    expiryDate: defaultExpiryDate(90),
  });

  const loadInventory = (signal) =>
    api('/inventory', { signal })
      .then((res) => {
        setData(res);
        setStatus('ready');
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setError(err.message);
        setStatus('error');
      });

  useEffect(() => {
    const controller = new AbortController();
    loadInventory(controller.signal);

    const refresh = () => loadInventory();
    socket.on('INVENTORY_UPDATED', refresh);
    socket.on('PRODUCTS_UPDATED', refresh);
    socket.connect();

    return () => {
      controller.abort();
      socket.off('INVENTORY_UPDATED', refresh);
      socket.off('PRODUCTS_UPDATED', refresh);
    };
  }, []);

  useEffect(() => attachDialogLightDismiss(restockDialogRef.current), []);

  const activeBatches = useMemo(
    () => (data?.batches ?? []).filter((b) => b.quantity > 0),
    [data],
  );

  const expiredBatches = useMemo(
    () => activeBatches.filter((b) => b.fefoStatus === 'EXPIRED'),
    [activeBatches],
  );

  const urgentBatches = useMemo(
    () => activeBatches.filter((b) => b.fefoStatus === 'CRITICAL' || b.fefoStatus === 'WARNING'),
    [activeBatches],
  );

  const filteredBatches = useMemo(() => {
    if (expiryFilter === 'ATTENTION') {
      return activeBatches.filter(
        (b) => b.fefoStatus === 'CRITICAL' || b.fefoStatus === 'WARNING',
      );
    }
    if (expiryFilter === 'EXPIRED') {
      return activeBatches.filter((b) => b.fefoStatus === 'EXPIRED');
    }
    if (expiryFilter === 'GOOD') {
      return activeBatches.filter((b) => b.fefoStatus === 'GOOD');
    }
    return activeBatches;
  }, [activeBatches, expiryFilter]);

  // Gom các đợt nhập theo từng món hàng để người không rành nhìn phát hiểu ngay:
  // "Món này có mấy đợt hàng? Đợt nào đang lấy bán trước? Đợt nào để dành bán sau?"
  const groupedProducts = useMemo(() => {
    const bySku = new Map();
    for (const b of filteredBatches) {
      if (!bySku.has(b.sku)) {
        bySku.set(b.sku, {
          sku: b.sku,
          productName: b.productName,
          brand: b.brand,
          category: b.category,
          unit: b.unit,
          price: b.price,
          totalSellable: 0,
          batches: [],
        });
      }
      const group = bySku.get(b.sku);
      if (b.daysUntilExpiry >= 0) group.totalSellable += b.quantity;
      group.batches.push(b);
    }
    return [...bySku.values()];
  }, [filteredBatches]);

  const needRestockList = useMemo(
    () => (data?.aiAnalytics?.wmaForecasts ?? []).filter((f) => f.recommendedRestock > 0),
    [data],
  );

  async function handleDisposeBatch(batchId, productName) {
    try {
      await api(`/inventory/batches/${batchId}/dispose`, { method: 'POST' });
      await loadInventory();
    } catch (err) {
      alert(`Không thể bỏ đợt hàng ${productName}: ${err.message}`);
    }
  }

  function openRestockModal(prefillSku, recommendedQty) {
    const targetSku = prefillSku || data?.products?.[0]?.sku || 'COCA01';
    setRestockForm({
      sku: targetSku,
      batchCode: `${targetSku}-DOT-${Date.now().toString().slice(-3)}`,
      quantity: recommendedQty && recommendedQty > 0 ? recommendedQty : 48,
      expiryDate: defaultExpiryDate(60),
    });
    restockDialogRef.current?.showModal();
  }

  async function handleRestockSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api('/inventory/batches', {
        method: 'POST',
        body: JSON.stringify({
          ...restockForm,
          quantity: Number(restockForm.quantity),
        }),
      });
      restockDialogRef.current?.close();
      await loadInventory();
    } catch (err) {
      alert(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const summary = data?.summary;

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      {/* Đầu trang thân thiện */}
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link to="/" className="text-sm text-slate-400 hover:text-slate-200">
            ← Về trang chủ
          </Link>
          <h1 className="mt-1 text-3xl font-bold">🏪 Sổ Quản Lý Kho &amp; Trợ Lý Cửa Hàng</h1>
          <p className="mt-1 text-sm text-slate-300">
            Tự động nhắc món nào <strong>sắp hết hạn cần bán trước</strong>, món nào <strong>sắp hết cần nhập thêm</strong>.
          </p>
        </div>

        <div className="flex flex-wrap gap-2.5">
          <Link
            to="/pos"
            className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:border-slate-500"
          >
            🖥️ Mở Quầy Tính Tiền
          </Link>
          <button
            type="button"
            onClick={() => openRestockModal('COCA01', 48)}
            className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg hover:bg-emerald-500"
          >
            ➕ Nhập thêm hàng mới vào kho
          </button>
        </div>
      </header>

      {status === 'loading' && (
        <p className="rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center text-slate-300">
          ⏳ Đang kiểm tra kho hàng…
        </p>
      )}

      {status === 'error' && (
        <p role="alert" className="rounded-2xl border border-red-800 bg-red-950/60 p-4 text-red-300">
          Không tải được dữ liệu kho: {error}
        </p>
      )}

      {status === 'ready' && data && (
        <>
          {/* HỘP NHẮC VIỆC HÔM NAY — Ai nhìn vào cũng biết cần làm gì ngay */}
          <section
            aria-label="Việc cần chú ý hôm nay"
            className="mb-8 rounded-3xl border border-slate-800 bg-slate-900/90 p-5 shadow-xl"
          >
            <h2 className="mb-3 flex items-center gap-2 text-lg font-bold text-white">
              <span>🔔</span> Tóm tắt tình hình cửa hàng hôm nay
            </h2>

            <div className="grid gap-3 md:grid-cols-3">
              {/* Cảnh báo 1: Hàng đã hết hạn */}
              <div
                className={`flex flex-col justify-between rounded-2xl border p-4 ${
                  expiredBatches.length > 0
                    ? 'border-red-600/80 bg-red-950/40'
                    : 'border-slate-800 bg-slate-950'
                }`}
              >
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-red-300">
                    1. Hàng quá hạn sử dụng
                  </span>
                  {expiredBatches.length > 0 ? (
                    <>
                      <p className="mt-1 text-base font-bold text-red-200">
                        Có {expiredBatches.length} đợt hàng ({summary.expiredUnits} món) đã quá hạn!
                      </p>
                      <p className="mt-1 text-xs text-red-200/80">
                        Gồm:{' '}
                        {expiredBatches
                          .map((b) => `${b.productName} (${b.quantity} ${b.unit})`)
                          .join(', ')}
                        . Máy tính tiền đã tự khoá không cho bán.
                      </p>
                    </>
                  ) : (
                    <p className="mt-2 text-sm font-semibold text-emerald-400">
                      ✓ Tuyệt vời! Không có món nào bị quá hạn.
                    </p>
                  )}
                </div>
                {expiredBatches.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('EXPIRY');
                      setExpiryFilter('EXPIRED');
                    }}
                    className="mt-3 rounded-xl bg-red-600 py-2 text-xs font-bold text-white hover:bg-red-500"
                  >
                    Xem &amp; Bỏ khỏi kho ngay →
                  </button>
                )}
              </div>

              {/* Cảnh báo 2: Hàng sắp hết hạn trong tuần */}
              <div
                className={`flex flex-col justify-between rounded-2xl border p-4 ${
                  urgentBatches.length > 0
                    ? 'border-amber-600/80 bg-amber-950/30'
                    : 'border-slate-800 bg-slate-950'
                }`}
              >
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-amber-300">
                    2. Hàng sắp hết hạn (1–7 ngày tới)
                  </span>
                  <p className="mt-1 text-base font-bold text-amber-200">
                    Có {urgentBatches.length} đợt hàng sắp hết hạn
                  </p>
                  <p className="mt-1 text-xs text-slate-300">
                    Máy tính tiền đang <strong>tự động trừ các đợt hàng cũ này trước</strong>. Bạn nên xếp chúng ra phía ngoài kệ để khách lấy trước.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('EXPIRY');
                    setExpiryFilter('ATTENTION');
                  }}
                  className="mt-3 rounded-xl border border-amber-500/60 bg-amber-900/40 py-2 text-xs font-bold text-amber-200 hover:bg-amber-800/50"
                >
                  Xem {urgentBatches.length} đợt sắp hết hạn →
                </button>
              </div>

              {/* Cảnh báo 3: Hàng sắp cạn kho + Tiền bán hàng */}
              <div className="flex flex-col justify-between rounded-2xl border border-slate-800 bg-slate-950 p-4">
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-sky-300">
                    3. Tiền bán hàng &amp; Nhập kho
                  </span>
                  <p className="mt-1 text-base font-bold text-emerald-400">
                    Đã bán: {formatVND(summary.totalRevenue)} ({summary.totalOrders} đơn)
                  </p>
                  <p className="mt-1 text-xs text-slate-300">
                    Tổng hàng còn tốt trong kho:{' '}
                    <strong>{summary.totalSellableUnits.toLocaleString('vi-VN')} món</strong> (trị giá{' '}
                    {formatVND(summary.totalInventoryValue)}). Có{' '}
                    <strong className="text-amber-300">{needRestockList.length} món</strong> sắp thiếu cho tuần tới.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('RESTOCK')}
                  className="mt-3 rounded-xl border border-sky-700/60 bg-sky-950/60 py-2 text-xs font-bold text-sky-200 hover:bg-sky-900/60"
                >
                  Xem gợi ý nhập hàng ({needRestockList.length} món) →
                </button>
              </div>
            </div>
          </section>

          {/* 3 NÚT CHUYỂN MỤC LỚN — Rõ ràng, không dùng từ chuyên ngành */}
          <nav
            aria-label="Các mục quản lý"
            className="mb-6 grid gap-3 sm:grid-cols-3"
          >
            {[
              {
                id: 'EXPIRY',
                icon: '📦',
                title: '1. Kiểm tra Hạn sử dụng',
                subtitle: 'Xem món nào cần bán trước, món nào quá hạn',
              },
              {
                id: 'RESTOCK',
                icon: '🚚',
                title: '2. Gợi ý Nhập thêm hàng',
                subtitle: `Dự báo tuần tới (${needRestockList.length} món nên nhập thêm)`,
              },
              {
                id: 'TIPS',
                icon: '💡',
                title: '3. Mẹo Bày kệ & Bán kèm',
                subtitle: 'Gợi ý ghép đôi sản phẩm giúp tăng doanh thu',
              },
            ].map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-start gap-3 rounded-2xl border p-4 text-left transition ${
                    active
                      ? 'border-emerald-500 bg-emerald-950/40 shadow-lg'
                      : 'border-slate-800 bg-slate-900 hover:border-slate-700'
                  }`}
                >
                  <span aria-hidden="true" className="text-2xl">
                    {tab.icon}
                  </span>
                  <div>
                    <div className="font-bold text-white">{tab.title}</div>
                    <div className="mt-0.5 text-xs text-slate-400">{tab.subtitle}</div>
                  </div>
                </button>
              );
            })}
          </nav>

          {/* ================================================================= */}
          {/* MỤC 1: KIỂM TRA HẠN SỬ DỤNG & TỒN KHO (FEFO DỄ HIỂU)              */}
          {/* ================================================================= */}
          {activeTab === 'EXPIRY' && (
            <section className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
                <div className="flex flex-wrap gap-2">
                  {[
                    { id: 'ALL', label: `Tất cả (${activeBatches.length} đợt hàng)` },
                    {
                      id: 'ATTENTION',
                      label: `⚠️ Sắp hết hạn (${urgentBatches.length})`,
                    },
                    {
                      id: 'EXPIRED',
                      label: `🚫 Đã quá hạn (${expiredBatches.length})`,
                    },
                    { id: 'GOOD', label: '🟢 Hạn còn dài' },
                  ].map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setExpiryFilter(f.id)}
                      className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition ${
                        expiryFilter === f.id
                          ? 'bg-emerald-600 text-white'
                          : 'border border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 p-1 text-xs">
                  <button
                    type="button"
                    onClick={() => setViewMode('GROUPED')}
                    className={`rounded-lg px-3 py-1.5 font-semibold ${
                      viewMode === 'GROUPED' ? 'bg-slate-800 text-white' : 'text-slate-400'
                    }`}
                  >
                    Xem gom theo từng món
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('BATCHES')}
                    className={`rounded-lg px-3 py-1.5 font-semibold ${
                      viewMode === 'BATCHES' ? 'bg-slate-800 text-white' : 'text-slate-400'
                    }`}
                  >
                    Xem theo thứ tự hết hạn
                  </button>
                </div>
              </div>

              {filteredBatches.length === 0 ? (
                <p className="py-12 text-center text-slate-400">
                  Không có đợt hàng nào trong mục này.
                </p>
              ) : viewMode === 'GROUPED' ? (
                /* CHẾ ĐỘ 1: GOM THEO TỪNG SẢN PHẨM — Rất dễ nhìn cho chủ tiệm */
                <div className="grid gap-4 md:grid-cols-2">
                  {groupedProducts.map((item) => (
                    <article
                      key={item.sku}
                      className="flex flex-col justify-between rounded-2xl border border-slate-800 bg-slate-950 p-4"
                    >
                      <div>
                        <header className="flex items-start justify-between gap-3 border-b border-slate-800/80 pb-3">
                          <div className="flex items-center gap-3">
                            <span aria-hidden="true" className="text-3xl">
                              {EMOJI[item.sku] ?? '📦'}
                            </span>
                            <div>
                              <h3 className="text-base font-bold text-white">
                                {item.productName}
                              </h3>
                              <p className="text-xs text-slate-400">
                                {item.brand} · Giá bán: {formatVND(item.price)}/{item.unit}
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-xs text-slate-400">Tổng còn bán được</div>
                            <div className="text-lg font-bold text-emerald-400">
                              {item.totalSellable} {item.unit}
                            </div>
                          </div>
                        </header>

                        {/* Danh sách các đợt nhập của món này */}
                        <ul className="mt-3 flex flex-col gap-2.5">
                          {item.batches.map((b, idx) => {
                            const meta = STATUS_META[b.fefoStatus] ?? STATUS_META.GOOD;
                            const pct = freshnessPercent(b.daysUntilExpiry);
                            return (
                              <li
                                key={b.id}
                                className={`rounded-xl border p-3 ${meta.cardCls}`}
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span
                                    className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${meta.badgeCls}`}
                                  >
                                    {meta.title}
                                  </span>
                                  <span className="text-sm font-bold text-white">
                                    Số lượng: {b.quantity} {b.unit}
                                  </span>
                                </div>

                                {/* Thanh màu biểu thị hạn dùng */}
                                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-800">
                                  <div
                                    className={`h-full rounded-full ${meta.barCls}`}
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>

                                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                                  <span className="text-slate-300">
                                    Hạn dùng: <strong>{formatVNDate(b.expiryDate)}</strong> (
                                    {b.daysUntilExpiry < 0 ? (
                                      <strong className="text-red-300">
                                        Đã quá hạn {-b.daysUntilExpiry} ngày
                                      </strong>
                                    ) : b.daysUntilExpiry === 0 ? (
                                      <strong className="text-orange-300">Hết hạn hôm nay!</strong>
                                    ) : (
                                      <strong>còn {b.daysUntilExpiry} ngày</strong>
                                    )}
                                    )
                                  </span>

                                  {b.isNextFefo && (
                                    <span className="rounded-md bg-emerald-700/80 px-2 py-0.5 font-semibold text-white">
                                      👆 Đang lấy bán trước
                                    </span>
                                  )}
                                  {!b.isNextFefo && b.daysUntilExpiry >= 0 && idx > 0 && (
                                    <span className="text-slate-400">
                                      ⏳ Để dành bán sau đợt trên
                                    </span>
                                  )}
                                </div>

                                {b.fefoStatus === 'EXPIRED' && (
                                  <div className="mt-2.5 flex items-center justify-between border-t border-red-800/50 pt-2">
                                    <span className="text-xs text-red-200">
                                      {meta.shortDesc}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleDisposeBatch(b.id, b.productName)
                                      }
                                      className="shrink-0 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-500"
                                    >
                                      🗑️ Bỏ lô hết hạn này
                                    </button>
                                  </div>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                /* CHẾ ĐỘ 2: BẢNG SẮP XẾP THEO HẠN DÙNG TỪ GẦN NHẤT -> XA NHẤT */
                <div
                  tabIndex={0}
                  role="region"
                  aria-label="Bảng các đợt hàng theo hạn sử dụng"
                  className="max-h-[500px] max-w-full overflow-auto rounded-2xl border border-slate-800"
                >
                  <table className="w-full border-separate border-spacing-0 text-left text-sm">
                    <thead className="sticky top-0 z-10 bg-slate-950 text-xs uppercase text-slate-400">
                      <tr>
                        <th scope="col" className="px-4 py-3">
                          Món hàng
                        </th>
                        <th scope="col" className="px-3 py-3 text-right">
                          Số lượng còn
                        </th>
                        <th scope="col" className="px-3 py-3">
                          Hạn sử dụng
                        </th>
                        <th scope="col" className="px-4 py-3">
                          Tình trạng &amp; Thứ tự bán
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/80">
                      {filteredBatches.map((b) => {
                        const meta = STATUS_META[b.fefoStatus] ?? STATUS_META.GOOD;
                        return (
                          <tr key={b.id} className="bg-slate-900 hover:bg-slate-800/50">
                            <th
                              scope="row"
                              className="sticky left-0 bg-inherit px-4 py-3 font-semibold text-white"
                            >
                              <div className="flex items-center gap-2.5">
                                <span aria-hidden="true" className="text-xl">
                                  {EMOJI[b.sku] ?? '📦'}
                                </span>
                                <div>
                                  <div>{b.productName}</div>
                                  <div className="text-xs font-normal text-slate-400">
                                    Đợt nhập ngày {formatVNDate(b.receivedDate)} · Mã lô:{' '}
                                    <code>{b.batchCode}</code>
                                  </div>
                                </div>
                              </div>
                            </th>
                            <td className="px-3 py-3 text-right font-bold text-white">
                              {b.quantity} {b.unit}
                            </td>
                            <td className="px-3 py-3">
                              <div className="font-semibold text-slate-200">
                                {formatVNDate(b.expiryDate)}
                              </div>
                              <div className="text-xs text-slate-400">
                                {b.daysUntilExpiry < 0
                                  ? `Quá hạn ${-b.daysUntilExpiry} ngày`
                                  : `Còn ${b.daysUntilExpiry} ngày`}
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span
                                    className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${meta.badgeCls}`}
                                  >
                                    {meta.title}
                                  </span>
                                  {b.isNextFefo && (
                                    <span className="rounded bg-emerald-700 px-2 py-0.5 text-xs font-semibold text-white">
                                      👆 Đang lấy bán trước
                                    </span>
                                  )}
                                </div>
                                {b.fefoStatus === 'EXPIRED' && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleDisposeBatch(b.id, b.productName)
                                    }
                                    className="rounded-lg bg-red-600 px-3 py-1 text-xs font-bold text-white hover:bg-red-500"
                                  >
                                    🗑️ Bỏ lô này
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {/* ================================================================= */}
          {/* MỤC 2: GỢI Ý NHẬP THÊM HÀNG (DỰ BÁO DỄ HIỂU)                      */}
          {/* ================================================================= */}
          {activeTab === 'RESTOCK' && (
            <section className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
              <div className="mb-5">
                <h2 className="text-xl font-bold text-white">
                  🚚 Trợ lý Gợi ý Nhập hàng cho Tuần tới
                </h2>
                <p className="mt-1 text-sm text-slate-400">
                  Dựa trên lượng hàng khách đã mua trong 3 tuần gần đây (ưu tiên tuần gần nhất), hệ thống tính sẵn món nào sắp thiếu để bạn nhập kịp thời.
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                {data.aiAnalytics.wmaForecasts.map((f) => {
                  const needMore = f.recommendedRestock > 0;
                  const maxBar = Math.max(...f.history, f.forecastWeekly, f.sellableStock, 1);
                  const stockRatio = Math.min(
                    100,
                    Math.round((f.sellableStock / Math.max(f.forecastWeekly, 1)) * 100),
                  );

                  return (
                    <article
                      key={f.sku}
                      className={`flex flex-col justify-between rounded-2xl border p-4 ${
                        needMore
                          ? 'border-amber-600/70 bg-amber-950/15'
                          : 'border-slate-800 bg-slate-950'
                      }`}
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2.5">
                            <span aria-hidden="true" className="text-2xl">
                              {EMOJI[f.sku] ?? '📦'}
                            </span>
                            <div>
                              <h3 className="font-bold text-white">{f.name}</h3>
                              <p className="text-xs text-slate-400">
                                Lượng mua 3 tuần qua: {f.history[0]} → {f.history[1]} →{' '}
                                <strong className="text-slate-200">
                                  {f.history[2]} {f.unit}/tuần
                                </strong>
                              </p>
                            </div>
                          </div>
                          {needMore ? (
                            <span className="shrink-0 rounded-full border border-amber-500 bg-amber-950 px-2.5 py-0.5 text-xs font-bold text-amber-200">
                              Cần nhập thêm
                            </span>
                          ) : (
                            <span className="shrink-0 rounded-full border border-emerald-700 bg-emerald-950 px-2.5 py-0.5 text-xs font-bold text-emerald-300">
                              ✓ Kho vẫn đủ bán
                            </span>
                          )}
                        </div>

                        {/* So sánh trực quan: Kho hiện còn vs Khách sẽ mua tuần tới */}
                        <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-slate-900 p-3 text-xs">
                          <div>
                            <div className="text-slate-400">Trong kho hiện còn</div>
                            <div className="mt-0.5 text-lg font-bold text-white">
                              {f.sellableStock} {f.unit}
                            </div>
                          </div>
                          <div>
                            <div className="text-slate-400">Khách thường mua / tuần</div>
                            <div className="mt-0.5 text-lg font-bold text-sky-400">
                              ~{f.forecastWeekly} {f.unit}
                            </div>
                          </div>
                        </div>

                        {/* Thanh tỷ lệ đáp ứng */}
                        <div className="mt-3">
                          <div className="mb-1 flex justify-between text-xs">
                            <span className="text-slate-400">Mức đủ hàng cho tuần tới</span>
                            <span className="font-bold text-slate-200">
                              {Math.round((f.sellableStock / Math.max(f.forecastWeekly, 1)) * 100)}%
                            </span>
                          </div>
                          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                            <div
                              className={`h-full rounded-full ${
                                needMore ? 'bg-amber-400' : 'bg-emerald-500'
                              }`}
                              style={{ width: `${stockRatio}%` }}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 flex items-center justify-between border-t border-slate-800/80 pt-3">
                        {needMore ? (
                          <>
                            <span className="text-xs text-amber-200">
                              👉 Gợi ý nhập thêm ít nhất{' '}
                              <strong>
                                {f.recommendedRestock} {f.unit}
                              </strong>{' '}
                              (đã tính dư 25% dự phòng)
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                openRestockModal(f.sku, f.recommendedRestock)
                              }
                              className="shrink-0 rounded-xl bg-amber-500 px-3.5 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400"
                            >
                              ➕ Nhập ngay {f.recommendedRestock} {f.unit}
                            </button>
                          </>
                        ) : (
                          <>
                            <span className="text-xs text-slate-400">
                              Lượng tồn kho hiện tại dư sức bán hết tuần tới (tối đa {maxBar}{' '}
                              {f.unit}).
                            </span>
                            <button
                              type="button"
                              onClick={() => openRestockModal(f.sku, 24)}
                              className="shrink-0 rounded-xl border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500"
                            >
                              Nhập thêm tuỳ ý
                            </button>
                          </>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          )}

          {/* ================================================================= */}
          {/* MỤC 3: MẸO BÀY KỆ & BÁN KÈM (AI BÁN CHÉO DỄ HIỂU)                 */}
          {/* ================================================================= */}
          {activeTab === 'TIPS' && (
            <section className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
              <div className="mb-5">
                <h2 className="text-xl font-bold text-white">
                  💡 Mẹo Xếp Kệ Hàng &amp; Mời Khách Mua Kèm
                </h2>
                <p className="mt-1 text-sm text-slate-400">
                  Hệ thống tự động thống kê thói quen mua sắm của khách để chỉ ra những cặp món hàng hay được mua chung nhất.
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                {data.aiAnalytics.fpGrowthRules.map((rule, idx) => (
                  <article
                    key={idx}
                    className="flex flex-col justify-between rounded-2xl border border-slate-800 bg-slate-950 p-5"
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="rounded-full bg-emerald-950 px-3 py-1 text-xs font-bold text-emerald-300">
                          🔥 Cứ 10 khách mua thì ~{Math.round(rule.confidence / 10)} người mua kèm ({rule.confidence}%)
                        </span>
                      </div>

                      <div className="mt-4 flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-900 p-3.5 text-sm">
                        <div>
                          <span className="text-xs text-slate-400">Khi khách chọn mua:</span>
                          <div className="font-bold text-sky-300">{rule.antecedent}</div>
                        </div>
                        <div className="text-xs font-bold text-emerald-400">
                          ⬇️ Khách rất hay lấy thêm:
                        </div>
                        <div>
                          <div className="font-bold text-emerald-300">{rule.consequent}</div>
                        </div>
                      </div>
                    </div>

                    <p className="mt-4 rounded-xl bg-emerald-950/30 p-3 text-xs text-emerald-200">
                      <strong>💡 Lời khuyên cho chủ tiệm:</strong> {rule.action}.
                    </p>
                  </article>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {/* Hộp thoại nhập thêm đợt hàng mới */}
      <dialog
        ref={restockDialogRef}
        {...{ closedby: 'any' }}
        onClose={() => {
          if (restockDialogRef.current) restockDialogRef.current.returnValue = '';
        }}
        className="m-auto w-full max-w-md rounded-3xl border border-slate-700 bg-slate-900 p-6 text-slate-100 shadow-2xl backdrop:bg-black/80"
      >
        <h2 className="text-lg font-bold">➕ Nhập thêm hàng mới vào kho</h2>
        <p className="mt-1 text-xs text-slate-400">
          Hệ thống sẽ tự động xếp đợt hàng nào có hạn dùng gần hơn để bán trước.
        </p>
        <form onSubmit={handleRestockSubmit} className="mt-4 flex flex-col gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-slate-300">Chọn món hàng</span>
            <select
              value={restockForm.sku}
              onChange={(e) => setRestockForm((f) => ({ ...f, sku: e.target.value }))}
              className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5"
            >
              {(data?.products ?? []).map((p) => (
                <option key={p.sku} value={p.sku}>
                  {p.name} ({p.sku})
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-slate-300">Số lượng nhập thêm</span>
              <input
                type="number"
                required
                min={1}
                value={restockForm.quantity}
                onChange={(e) => setRestockForm((f) => ({ ...f, quantity: e.target.value }))}
                className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 font-bold"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-slate-300">Ngày hết hạn (trên bao bì)</span>
              <input
                type="date"
                required
                value={restockForm.expiryDate}
                onChange={(e) => setRestockForm((f) => ({ ...f, expiryDate: e.target.value }))}
                className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-400">Mã đợt nhập (tự động điền, không cần sửa)</span>
            <input
              required
              value={restockForm.batchCode}
              onChange={(e) =>
                setRestockForm((f) => ({ ...f, batchCode: e.target.value.toUpperCase() }))
              }
              className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-xs uppercase text-slate-400"
            />
          </label>

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => restockDialogRef.current?.close()}
              className="flex-1 rounded-xl bg-slate-800 py-2.5 font-semibold hover:bg-slate-700"
            >
              Đóng
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 rounded-xl bg-emerald-600 py-2.5 font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {submitting ? 'Đang lưu…' : '✓ Lưu vào kho'}
            </button>
          </div>
        </form>
      </dialog>
    </main>
  );
}
