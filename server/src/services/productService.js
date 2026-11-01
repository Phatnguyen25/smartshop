import { query, withTransaction } from '../db.js';

// Tồn kho "bán được" = tổng số lượng các lô CHƯA hết hạn.
const PRODUCT_SELECT = `
  SELECT p.id, p.sku, p.barcode, p.name, p.brand, p.category, p.unit, p.price,
         COALESCE(SUM(b.quantity) FILTER (WHERE b.expiry_date >= CURRENT_DATE), 0)::int AS stock
  FROM products p
  LEFT JOIN inventory_batches b ON b.product_id = p.id
`;

const SKU_PATTERN = /^[A-Z0-9_-]{1,32}$/;

/** Chuẩn hoá SKU; trả về null nếu không hợp lệ. */
export function normalizeSku(raw) {
  const sku = String(raw ?? '').trim().toUpperCase();
  return SKU_PATTERN.test(sku) ? sku : null;
}

export async function listProducts() {
  const { rows } = await query(`${PRODUCT_SELECT} GROUP BY p.id ORDER BY p.category, p.id`);
  return rows;
}

export async function findProductBySku(sku) {
  const { rows } = await query(`${PRODUCT_SELECT} WHERE p.sku = $1 GROUP BY p.id`, [sku]);
  return rows[0] ?? null;
}

/**
 * Tự động biến tấu & đồng bộ sản phẩm từ mã QR ngoài DB (hoặc bộ dữ liệu cửa hàng khác)
 * vào PostgreSQL kèm 1 lô tồn kho mặc định để POS quét & thanh toán được ngay.
 */
export async function upsertProductFromQr(raw) {
  const sku = normalizeSku(raw?.sku ?? raw?.barcode ?? raw?.id);
  const name = String(raw?.name ?? raw?.title ?? '').trim();
  const price = Math.round(Number(raw?.price ?? 0));
  if (!sku || !name || !Number.isFinite(price) || price < 0) return null;

  const brand = String(raw?.brand ?? 'WinMart+ Select').trim().slice(0, 100);
  const category = String(raw?.category ?? 'Hàng tiêu dùng').trim().slice(0, 100);
  const unit = String(raw?.unit ?? 'Cái').trim().slice(0, 40);
  const barcode = raw?.barcode ? String(raw.barcode).trim().slice(0, 32) : null;
  const initialQty = Math.max(1, Math.round(Number(raw?.stock ?? 50)));
  const expiresInDays = Math.max(1, Math.round(Number(raw?.expiresInDays ?? 90)));

  await withTransaction(async (client) => {
    const { rows: [p] } = await client.query(
      `INSERT INTO products (sku, barcode, name, brand, category, unit, price)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (sku) DO UPDATE SET
         name     = EXCLUDED.name,
         brand    = COALESCE(EXCLUDED.brand, products.brand),
         category = COALESCE(EXCLUDED.category, products.category),
         unit     = COALESCE(EXCLUDED.unit, products.unit),
         price    = EXCLUDED.price
       RETURNING id`,
      [sku, barcode, name, brand, category, unit, price],
    );

    await client.query(
      `INSERT INTO inventory_batches (product_id, batch_code, quantity, received_date, expiry_date)
       VALUES ($1, $2, $3, CURRENT_DATE, CURRENT_DATE + ($4 || ' days')::interval)
       ON CONFLICT (product_id, batch_code) DO NOTHING`,
      [p.id, `${sku}-AUTO`, initialQty, String(expiresInDays)],
    );
  });

  return findProductBySku(sku);
}
