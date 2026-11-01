import { QRCodeSVG } from 'qrcode.react';
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

// Bộ sản phẩm tham khảo từ Bách Hóa Xanh / GS25 (mặc định chưa có trong DB).
// Khi quét mã QR của các SP này bằng điện thoại, Backend sẽ tự động biến tấu & nạp vào PostgreSQL!
const EXTERNAL_CATALOG = [
  {
    sku: 'TEAPLUS01',
    barcode: '8934588590115',
    name: 'Trà Ô Long Tea+ Plus chai 450ml',
    brand: 'Suntory PepsiCo',
    category: 'Đồ uống',
    unit: 'Chai',
    price: 11000,
  },
  {
    sku: 'YAKULT01',
    barcode: '8936025210011',
    name: 'Sữa chua uống lên men Yakult lốc 5 chai x 65ml',
    brand: 'Yakult',
    category: 'Sữa & Chế phẩm',
    unit: 'Lốc',
    price: 26500,
  },
  {
    sku: 'THOPHAT01',
    barcode: '8936045120088',
    name: 'Bánh bao thịt heo trứng cút Thọ Phát 150g',
    brand: 'Thọ Phát',
    category: 'Đồ ăn nhanh',
    unit: 'Cái',
    price: 18000,
  },
  {
    sku: 'CELANO01',
    barcode: '8936011770222',
    name: 'Kem ốc quế Celano Classic hương Vani 68g',
    brand: 'Kido',
    category: 'Snack & Bánh kẹo',
    unit: 'Cây',
    price: 19000,
  },
];

function buildQrPayload(product) {
  return JSON.stringify({
    sku: product.sku,
    barcode: product.barcode,
    name: product.name,
    brand: product.brand,
    category: product.category,
    unit: product.unit,
    price: product.price,
  });
}

/**
 * Web 2 - Product QR Simulator
 * Kệ hàng siêu thị mini (WinMart+ / Circle K) + Kệ mở rộng ngoài DB (Bách Hóa Xanh / GS25).
 */
export default function Simulator() {
  const [products, setProducts] = useState([]);
  const [customExternal, setCustomExternal] = useState([]);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('Tất cả');
  const [search, setSearch] = useState('');
  const [focusedProduct, setFocusedProduct] = useState(null);
  const dialogRef = useRef(null);

  const loadProducts = (signal) =>
    api('/products', { signal })
      .then((data) => {
        setProducts(data);
        setStatus('ready');
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setError(err.message);
        setStatus('error');
      });

  useEffect(() => {
    const controller = new AbortController();
    loadProducts(controller.signal);

    const refresh = () => loadProducts();
    socket.on('PRODUCTS_UPDATED', refresh);
    socket.on('INVENTORY_UPDATED', refresh);
    socket.connect();

    return () => {
      controller.abort();
      socket.off('PRODUCTS_UPDATED', refresh);
      socket.off('INVENTORY_UPDATED', refresh);
    };
  }, []);

  // Fallback light-dismiss cho <dialog closedby="any"> trên trình duyệt chưa hỗ trợ native closedBy
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || 'closedBy' in HTMLDialogElement.prototype) return;
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
  }, []);

  const dbSkuSet = useMemo(() => new Set(products.map((p) => p.sku)), [products]);

  const categories = useMemo(
    () => ['Tất cả', ...new Set(products.map((p) => p.category).filter(Boolean))],
    [products],
  );

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (selectedCategory !== 'Tất cả' && p.category !== selectedCategory) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.brand && p.brand.toLowerCase().includes(q)) ||
        (p.barcode && p.barcode.includes(q))
      );
    });
  }, [products, selectedCategory, search]);

  const externalItems = useMemo(
    () => [...customExternal, ...EXTERNAL_CATALOG],
    [customExternal],
  );

  const openZoom = (product) => {
    setFocusedProduct(product);
    dialogRef.current?.showModal();
  };

  function handleAddCustomQr(e) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const sku = String(fd.get('sku') ?? '').trim().toUpperCase();
    const name = String(fd.get('name') ?? '').trim();
    const price = Number(fd.get('price') ?? 0);
    if (!sku || !name || price <= 0) return;

    const item = {
      sku,
      barcode: String(fd.get('barcode') || `893${Date.now().toString().slice(-10)}`),
      name,
      brand: String(fd.get('brand') || 'Tự chọn').trim(),
      category: String(fd.get('category') || 'Đồ uống').trim(),
      unit: String(fd.get('unit') || 'Cái').trim(),
      price,
    };
    setCustomExternal((prev) => [item, ...prev.filter((x) => x.sku !== item.sku)]);
    e.currentTarget.reset();
    openZoom(item);
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link to="/" className="text-sm text-slate-400 hover:text-slate-200">
            ← Trang chủ
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold">🏪 Kệ Hàng QR — WinMart+ &amp; Circle K</h1>
            <span className="rounded-full border border-emerald-700/60 bg-emerald-950/60 px-3 py-1 text-xs font-semibold text-emerald-300">
              {products.length} SP trong DB
            </span>
          </div>
          <p className="mt-1 text-slate-400">
            Mở <Link to="/scanner" className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-emerald-300 hover:underline">/scanner</Link> trên điện thoại và chĩa camera vào tem QR. Bấm vào nút <strong>Phóng to QR</strong> để quét 1 mã thật chuẩn.
          </p>
        </div>

        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Tìm tên SP, SKU, thương hiệu, barcode…"
          aria-label="Tìm kiếm sản phẩm"
          className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm outline-none focus:border-emerald-500 sm:w-80"
        />
      </header>

      {/* Bộ lọc ngành hàng */}
      <nav aria-label="Ngành hàng" className="mb-6 flex flex-wrap gap-2">
        {categories.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setSelectedCategory(cat)}
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
              selectedCategory === cat
                ? 'bg-emerald-600 text-white'
                : 'border border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-700'
            }`}
          >
            {cat}
          </button>
        ))}
      </nav>

      {status === 'loading' && <p className="text-slate-400">Đang tải danh mục cửa hàng…</p>}

      {status === 'error' && (
        <p role="alert" className="rounded-lg border border-red-800 bg-red-950/50 p-4 text-red-300">
          Không tải được sản phẩm: {error}. Kiểm tra backend đang chạy ở cổng 4000.
        </p>
      )}

      {status === 'ready' && (
        <>
          <section className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-5">
            {filteredProducts.map((p) => (
              <ProductCard key={p.sku} product={p} inDb onZoom={() => openZoom(p)} />
            ))}
          </section>

          {/* Kệ hàng mở rộng ngoài DB -> tự động biến tấu & nạp vào DB khi quét */}
          <section className="mt-12 rounded-3xl border border-amber-800/40 bg-slate-900/60 p-6">
            <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-amber-300">
                  🌐 Kệ hàng tham khảo ngoài DB (Bách Hóa Xanh / GS25)
                </h2>
                <p className="mt-1 text-sm text-slate-400">
                  Các mã QR dưới đây chứa đầy đủ JSON sản phẩm. Nếu chưa có trong PostgreSQL, ngay khi điện thoại quét trúng, Backend sẽ <strong>tự động biến tấu &amp; thêm vào DB kèm lô tồn kho</strong> để POS tính tiền ngay!
                </p>
              </div>
            </div>

            <div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-5">
              {externalItems.map((item) => (
                <ProductCard
                  key={item.sku}
                  product={item}
                  inDb={dbSkuSet.has(item.sku)}
                  onZoom={() => openZoom(item)}
                />
              ))}
            </div>

            <details className="mt-6 rounded-2xl border border-slate-800 bg-slate-950 p-4">
              <summary className="cursor-pointer font-semibold text-emerald-400">
                + Tự tạo tem QR sản phẩm bất kỳ (biến tấu dữ liệu mới)
              </summary>
              <form onSubmit={handleAddCustomQr} className="mt-4 grid gap-3 sm:grid-cols-3">
                <input
                  name="sku"
                  required
                  pattern="[A-Za-z0-9_-]{2,32}"
                  placeholder="Mã SKU (VD: MILO01)"
                  className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm uppercase"
                />
                <input
                  name="name"
                  required
                  placeholder="Tên sản phẩm (VD: Sữa lúa mạch Milo 180ml)"
                  className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm sm:col-span-2"
                />
                <input
                  name="price"
                  type="number"
                  required
                  min={1000}
                  step={500}
                  placeholder="Giá bán VNĐ (VD: 8500)"
                  className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                />
                <input
                  name="brand"
                  placeholder="Thương hiệu (VD: Nestlé)"
                  className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                />
                <input
                  name="unit"
                  placeholder="Đơn vị (Hộp / Lon / Gói)"
                  className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                />
                <button
                  type="submit"
                  className="rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 sm:col-span-3"
                >
                  Sinh mã QR &amp; Phóng to để quét ngay
                </button>
              </form>
            </details>
          </section>
        </>
      )}

      {/* Modal phóng to 1 mã QR để quét bằng điện thoại cực nhạy, không dính mã kế bên */}
      <dialog
        ref={dialogRef}
        {...{ closedby: 'any' }}
        onClose={() => {
          if (dialogRef.current) dialogRef.current.returnValue = '';
        }}
        className="m-auto w-full max-w-md rounded-3xl border border-slate-700 bg-slate-900 p-6 text-slate-100 shadow-2xl backdrop:bg-black/80"
      >
        {focusedProduct && (
          <div className="flex flex-col items-center gap-4 text-center">
            <span className="rounded-full bg-slate-800 px-3 py-1 text-xs font-medium text-emerald-300">
              {focusedProduct.brand} · {focusedProduct.category}
            </span>
            <h2 className="text-xl font-bold">{focusedProduct.name}</h2>
            <div className="rounded-2xl bg-white p-5 shadow-inner">
              <QRCodeSVG
                value={buildQrPayload(focusedProduct)}
                size={280}
                level="M"
                marginSize={2}
                bgColor="#ffffff"
                fgColor="#000000"
                title={`Mã QR của ${focusedProduct.name}`}
              />
            </div>
            <p className="text-2xl font-bold text-emerald-400">
              {formatVND(focusedProduct.price)}{' '}
              <span className="text-sm font-normal text-slate-400">/ {focusedProduct.unit ?? 'Cái'}</span>
            </p>
            <code className="rounded bg-slate-800 px-2.5 py-1 text-xs text-slate-300">
              SKU: {focusedProduct.sku} {focusedProduct.barcode ? `· EAN: ${focusedProduct.barcode}` : ''}
            </code>
            <form method="dialog" className="w-full">
              <button
                type="submit"
                className="w-full rounded-xl bg-slate-800 py-3 font-semibold text-slate-200 hover:bg-slate-700"
              >
                Đóng (Esc)
              </button>
            </form>
          </div>
        )}
      </dialog>
    </main>
  );
}

function ProductCard({ product, inDb, onZoom }) {
  const payload = buildQrPayload(product);

  return (
    <article className="row-span-4 grid grid-rows-subgrid gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-lg">
      <QRCodeSVG
        value={payload}
        size={220}
        level="M"
        marginSize={2}
        bgColor="#ffffff"
        fgColor="#000000"
        title={`Mã QR của ${product.name}`}
        className="aspect-square h-auto w-full rounded-xl"
      />

      <header className="flex items-start gap-2.5">
        <span aria-hidden="true" className="text-2xl">
          {EMOJI[product.sku] ?? '🛒'}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold leading-snug">{product.name}</h3>
          <p className="mt-0.5 text-xs text-slate-400">
            {product.brand ?? 'WinMart+'} · {product.category}
          </p>
        </div>
      </header>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between">
          <span className="text-xl font-bold text-emerald-400">
            {formatVND(product.price)}
            <span className="text-xs font-normal text-slate-400">/{product.unit ?? 'Cái'}</span>
          </span>
          <code className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300">{product.sku}</code>
        </div>
        <div className="flex items-center justify-between text-xs">
          {inDb ? (
            <span className="text-emerald-400">
              ✓ Trong DB {typeof product.stock === 'number' ? `· Tồn: ${product.stock}` : ''}
            </span>
          ) : (
            <span className="text-amber-300">⚡ Ngoài DB · Quét để tự nạp</span>
          )}
          {product.barcode && <span className="font-mono text-slate-500">{product.barcode}</span>}
        </div>
      </div>

      <footer className="flex items-center gap-2">
        <button
          type="button"
          onClick={onZoom}
          className="flex-1 rounded-xl border border-slate-700 bg-slate-800/80 py-2 text-xs font-semibold text-slate-200 hover:border-emerald-500 hover:text-white"
        >
          🔍 Phóng to QR để quét
        </button>
      </footer>
    </article>
  );
}
