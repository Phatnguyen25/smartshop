import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { HttpError } from '../httpError.js';
import { normalizeSku } from '../services/productService.js';
import { getSession, normalizeSessionId, roomOf } from '../sessionStore.js';

const router = Router();

/** Validate + gộp các dòng trùng SKU: [{sku, quantity}] -> Map<sku, qty> */
function parseItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpError(400, 'items phải là mảng không rỗng dạng [{ sku, quantity }]', 'INVALID_ITEMS');
  }
  const merged = new Map();
  for (const item of items) {
    const sku = normalizeSku(item?.sku);
    const qty = Number(item?.quantity ?? 1);
    if (!sku || !Number.isInteger(qty) || qty <= 0) {
      throw new HttpError(400, `Dòng hàng không hợp lệ: ${JSON.stringify(item)}`, 'INVALID_ITEMS');
    }
    merged.set(sku, (merged.get(sku) ?? 0) + qty);
  }
  return merged;
}

// POST /api/orders  body: { sessionId?, items: [{ sku, quantity }] }
// Thanh toán: trừ kho theo FEFO (lô hết hạn sớm nhất trước, bỏ qua lô đã hết hạn).
router.post('/', async (req, res) => {
  const wanted = parseItems(req.body?.items);
  const sessionId = req.body?.sessionId ? normalizeSessionId(req.body.sessionId) : null;

  const order = await withTransaction(async (client) => {
    // Khoá theo thứ tự product id để tránh deadlock khi nhiều quầy thanh toán đồng thời.
    const { rows: products } = await client.query(
      'SELECT id, sku, name, price FROM products WHERE sku = ANY($1) ORDER BY id FOR UPDATE',
      [[...wanted.keys()]],
    );
    const missing = [...wanted.keys()].filter((sku) => !products.some((p) => p.sku === sku));
    if (missing.length) {
      throw new HttpError(404, `Không tìm thấy sản phẩm: ${missing.join(', ')}`, 'PRODUCT_NOT_FOUND');
    }

    const lines = [];
    for (const product of products) {
      const quantity = wanted.get(product.sku);
      const { rows: batches } = await client.query(
        `SELECT id, batch_code, quantity, expiry_date::text AS expiry_date
           FROM inventory_batches
          WHERE product_id = $1 AND quantity > 0 AND expiry_date >= CURRENT_DATE
          ORDER BY expiry_date ASC, id ASC
          FOR UPDATE`,
        [product.id],
      );

      let remaining = quantity;
      const allocations = [];
      for (const batch of batches) {
        if (remaining === 0) break;
        const take = Math.min(batch.quantity, remaining);
        await client.query('UPDATE inventory_batches SET quantity = quantity - $1 WHERE id = $2', [
          take,
          batch.id,
        ]);
        allocations.push({ batchCode: batch.batch_code, expiryDate: batch.expiry_date, quantity: take });
        remaining -= take;
      }
      if (remaining > 0) {
        throw new HttpError(
          409,
          `Không đủ tồn kho còn hạn cho ${product.sku}: cần ${quantity}, còn ${quantity - remaining}`,
          'INSUFFICIENT_STOCK',
        );
      }

      lines.push({ ...product, quantity, lineTotal: product.price * quantity, allocations });
    }

    const totalAmount = lines.reduce((sum, l) => sum + l.lineTotal, 0);
    const { rows: [orderRow] } = await client.query(
      'INSERT INTO orders (session_id, total_amount) VALUES ($1, $2) RETURNING id, created_at',
      [sessionId, totalAmount],
    );
    await client.query(
      `INSERT INTO order_items (order_id, product_id, quantity, unit_price)
       SELECT $1, * FROM UNNEST($2::int[], $3::int[], $4::int[])`,
      [orderRow.id, lines.map((l) => l.id), lines.map((l) => l.quantity), lines.map((l) => l.price)],
    );

    return {
      orderId: orderRow.id,
      sessionId,
      totalAmount,
      createdAt: orderRow.created_at,
      items: lines.map(({ id, price, ...line }) => ({ ...line, unitPrice: price })),
    };
  });

  const io = req.app.get('io');
  if (sessionId && getSession(sessionId)) io.to(roomOf(sessionId)).emit('ORDER_COMPLETED', order);
  io.emit('INVENTORY_UPDATED', { skus: [...wanted.keys()], at: new Date().toISOString() }); // cho Admin (Bước 5)

  res.status(201).json(order);
});

// GET /api/orders?limit=20 -> đơn gần nhất kèm chi tiết
router.get('/', async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  const { rows } = await query(
    `SELECT o.id AS "orderId", o.session_id AS "sessionId", o.total_amount AS "totalAmount",
            o.created_at AS "createdAt",
            json_agg(json_build_object('sku', p.sku, 'name', p.name,
                     'quantity', oi.quantity, 'unitPrice', oi.unit_price) ORDER BY oi.id) AS items
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       JOIN products p ON p.id = oi.product_id
      GROUP BY o.id
      ORDER BY o.created_at DESC
      LIMIT $1`,
    [limit],
  );
  res.json(rows);
});

export default router;
