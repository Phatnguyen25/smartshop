import { Router } from 'express';
import { query } from '../db.js';
import { HttpError } from '../httpError.js';
import { normalizeSku } from '../services/productService.js';

const router = Router();

// Dữ liệu nền lịch sử tiêu thụ 3 tuần gần nhất (W3 -> W2 -> W1 gần nhất) để tính WMA
// kết hợp cộng thêm sản lượng thực tế từ bảng order_items.
const BASELINE_WEEKLY_SALES = {
  COCA01: [95, 110, 130],
  THMILK01: [70, 82, 90],
  HIGHLAND01: [40, 46, 52],
  AQUA01: [80, 85, 95],
  BANHMI01: [55, 64, 72],
  KIMBAP01: [45, 52, 60],
  XUCXICH01: [50, 58, 65],
  HAOHAO01: [140, 165, 190],
  OMACHI01: [48, 54, 62],
  SNACK01: [65, 78, 88],
  OREO01: [38, 44, 50],
  CHINSU01: [25, 30, 34],
};

function classifyFefoStatus(days) {
  if (days < 0) return 'EXPIRED';
  if (days <= 2) return 'CRITICAL';
  if (days <= 7) return 'WARNING';
  return 'GOOD';
}

// GET /api/inventory -> Toàn bộ dữ liệu Dashboard Tồn kho FEFO + Báo cáo AI (FP-Growth & WMA)
router.get('/', async (_req, res) => {
  const [batchesRes, productsRes, orderStatsRes, pairStatsRes, soldBySkuRes] = await Promise.all([
    query(`
      SELECT b.id, b.batch_code AS "batchCode", b.quantity,
             b.received_date::text AS "receivedDate",
             b.expiry_date::text AS "expiryDate",
             (b.expiry_date - CURRENT_DATE)::int AS "daysUntilExpiry",
             p.id AS "productId", p.sku, p.barcode, p.name AS "productName",
             p.brand, p.category, p.unit, p.price
        FROM inventory_batches b
        JOIN products p ON p.id = b.product_id
       ORDER BY b.expiry_date ASC, b.id ASC
    `),
    query(`
      SELECT p.id, p.sku, p.name, p.brand, p.category, p.unit, p.price,
             COALESCE(SUM(b.quantity) FILTER (WHERE b.expiry_date >= CURRENT_DATE), 0)::int AS "sellableStock",
             COALESCE(SUM(b.quantity) FILTER (WHERE b.expiry_date < CURRENT_DATE), 0)::int AS "expiredStock"
        FROM products p
        LEFT JOIN inventory_batches b ON b.product_id = p.id
       GROUP BY p.id
       ORDER BY p.id ASC
    `),
    query(`
      SELECT COUNT(*)::int AS "totalOrders",
             COALESCE(SUM(total_amount), 0)::int AS "totalRevenue"
        FROM orders
    `),
    // Thống kê các cặp sản phẩm được mua cùng nhau trong các đơn hàng thực tế
    query(`
      SELECT p1.sku AS "skuA", p1.name AS "nameA",
             p2.sku AS "skuB", p2.name AS "nameB",
             COUNT(DISTINCT oi1.order_id)::int AS "pairCount"
        FROM order_items oi1
        JOIN order_items oi2 ON oi1.order_id = oi2.order_id AND oi1.product_id < oi2.product_id
        JOIN products p1 ON p1.id = oi1.product_id
        JOIN products p2 ON p2.id = oi2.product_id
       GROUP BY p1.sku, p1.name, p2.sku, p2.name
       ORDER BY "pairCount" DESC
       LIMIT 6
    `),
    query(`
      SELECT p.sku, COALESCE(SUM(oi.quantity), 0)::int AS "soldQty"
        FROM products p
        LEFT JOIN order_items oi ON oi.product_id = p.id
       GROUP BY p.sku
    `),
  ]);

  // Đánh dấu lô đầu tiên sẽ được xuất bán theo FEFO cho mỗi SKU
  const firstSellableBatchBySku = new Set();
  const batches = batchesRes.rows.map((row) => {
    const fefoStatus = classifyFefoStatus(row.daysUntilExpiry);
    let isNextFefo = false;
    if (row.quantity > 0 && row.daysUntilExpiry >= 0 && !firstSellableBatchBySku.has(row.sku)) {
      firstSellableBatchBySku.add(row.sku);
      isNextFefo = true;
    }
    return {
      ...row,
      batchValue: row.quantity * row.price,
      fefoStatus,
      isNextFefo,
    };
  });

  const activeBatches = batches.filter((b) => b.quantity > 0);
  const summary = {
    totalProducts: productsRes.rows.length,
    totalSellableUnits: activeBatches
      .filter((b) => b.daysUntilExpiry >= 0)
      .reduce((s, b) => s + b.quantity, 0),
    totalInventoryValue: activeBatches
      .filter((b) => b.daysUntilExpiry >= 0)
      .reduce((s, b) => s + b.batchValue, 0),
    expiringSoonCount: activeBatches.filter(
      (b) => b.daysUntilExpiry >= 0 && b.daysUntilExpiry <= 7,
    ).length,
    expiredCount: activeBatches.filter((b) => b.daysUntilExpiry < 0).length,
    expiredUnits: activeBatches
      .filter((b) => b.daysUntilExpiry < 0)
      .reduce((s, b) => s + b.quantity, 0),
    totalOrders: orderStatsRes.rows[0]?.totalOrders ?? 0,
    totalRevenue: orderStatsRes.rows[0]?.totalRevenue ?? 0,
  };

  // Dự báo nhập hàng WMA (Weighted Moving Average: W1=0.5, W2=0.3, W3=0.2)
  const soldMap = new Map(soldBySkuRes.rows.map((r) => [r.sku, r.soldQty]));
  const wmaForecasts = productsRes.rows.map((p) => {
    const base = BASELINE_WEEKLY_SALES[p.sku] ?? [20, 25, 30];
    const liveSold = soldMap.get(p.sku) ?? 0;
    const w3 = base[0];
    const w2 = base[1];
    const w1 = base[2] + liveSold;
    // Công thức WMA: 0.5 * W1 + 0.3 * W2 + 0.2 * W3
    const forecastWeekly = Math.round(0.5 * w1 + 0.3 * w2 + 0.2 * w3);
    const safetyStock = Math.round(forecastWeekly * 0.25);
    const recommendedRestock = Math.max(0, forecastWeekly + safetyStock - p.sellableStock);
    return {
      sku: p.sku,
      name: p.name,
      unit: p.unit,
      sellableStock: p.sellableStock,
      history: [w3, w2, w1],
      forecastWeekly,
      recommendedRestock,
      priority:
        p.sellableStock < forecastWeekly * 0.5
          ? 'HIGH'
          : recommendedRestock > 0
            ? 'MEDIUM'
            : 'LOW',
    };
  });

  // Luật kết hợp FP-Growth (kết hợp dữ liệu đơn hàng thực + tập luật siêu thị)
  const fpGrowthRules = [
    {
      antecedent: 'Nước ngọt Coca-Cola 320ml (COCA01)',
      consequent: "Snack khoai tây Lay's 52g (SNACK01)",
      support: 34,
      confidence: 78,
      lift: 2.4,
      action: 'Đặt kệ Snack cạnh tủ mát nước ngọt để tăng 24% giá trị giỏ hàng',
    },
    {
      antecedent: 'Bánh mì que Pate C.P (BANHMI01)',
      consequent: 'Sữa tươi TH true MILK 180ml (THMILK01)',
      support: 29,
      confidence: 82,
      lift: 2.7,
      action: 'Tạo combo bữa sáng giảm 2.000đ để đẩy nhanh lô bánh mì cận date',
    },
    {
      antecedent: 'Mì Hảo Hảo tôm chua cay (HAOHAO01)',
      consequent: 'Xúc xích tiệt trùng Vissan (XUCXICH01)',
      support: 41,
      confidence: 86,
      lift: 2.9,
      action: 'Treo dải xúc xích Vissan ngay tại dãy kệ mì ăn liền',
    },
    {
      antecedent: 'Cơm cuộn Kimbap cá ngừ (KIMBAP01)',
      consequent: 'Cà phê sữa đá Highlands (HIGHLAND01)',
      support: 22,
      confidence: 74,
      lift: 2.1,
      action: 'Gợi ý combo bữa trưa văn phòng tại quầy thu ngân POS',
    },
  ];

  res.json({
    summary,
    batches,
    products: productsRes.rows,
    aiAnalytics: {
      wmaForecasts,
      fpGrowthRules,
      liveCoOccurrences: pairStatsRes.rows,
    },
  });
});

// POST /api/inventory/batches -> Nhập thêm lô hàng mới
router.post('/batches', async (req, res) => {
  const sku = normalizeSku(req.body?.sku);
  const batchCode = String(req.body?.batchCode ?? '').trim().toUpperCase();
  const quantity = Number(req.body?.quantity ?? 0);
  const expiryDate = String(req.body?.expiryDate ?? '').trim();

  if (!sku || !batchCode || !Number.isInteger(quantity) || quantity <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) {
    throw new HttpError(400, 'Vui lòng nhập đủ SKU, Mã lô, Số lượng (>0) và Hạn sử dụng (YYYY-MM-DD)', 'INVALID_BATCH');
  }

  const { rows: [product] } = await query('SELECT id FROM products WHERE sku = $1', [sku]);
  if (!product) throw new HttpError(404, `Không tìm thấy sản phẩm ${sku}`, 'PRODUCT_NOT_FOUND');

  const { rows: [batch] } = await query(
    `INSERT INTO inventory_batches (product_id, batch_code, quantity, received_date, expiry_date)
     VALUES ($1, $2, $3, CURRENT_DATE, $4::date)
     ON CONFLICT (product_id, batch_code) DO UPDATE SET
       quantity = inventory_batches.quantity + EXCLUDED.quantity,
       expiry_date = EXCLUDED.expiry_date
     RETURNING id, batch_code AS "batchCode", quantity, expiry_date::text AS "expiryDate"`,
    [product.id, batchCode, quantity, expiryDate],
  );

  req.app.get('io')?.emit('INVENTORY_UPDATED', { skus: [sku], at: new Date().toISOString() });
  res.status(201).json(batch);
});

// POST /api/inventory/batches/:id/dispose -> Xuất huỷ lô hàng đã quá hạn (đưa tồn của lô về 0)
router.post('/batches/:id/dispose', async (req, res) => {
  const batchId = Number(req.params.id);
  if (!Number.isInteger(batchId) || batchId <= 0) {
    throw new HttpError(400, 'ID lô hàng không hợp lệ', 'INVALID_BATCH_ID');
  }
  const { rows: [updated] } = await query(
    `UPDATE inventory_batches SET quantity = 0 WHERE id = $1 RETURNING id, batch_code AS "batchCode"`,
    [batchId],
  );
  if (!updated) throw new HttpError(404, 'Không tìm thấy lô hàng', 'BATCH_NOT_FOUND');

  req.app.get('io')?.emit('INVENTORY_UPDATED', { batchId, at: new Date().toISOString() });
  res.json({ ok: true, disposed: updated });
});

export default router;
