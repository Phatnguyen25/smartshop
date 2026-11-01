// =====================================================================
// Giao thức Socket.io
//
//  Client -> Server
//    JOIN_SESSION  { sessionId, role: 'pos' | 'scanner' }   ack({ ok, session } | { ok:false, code, message })
//    SCAN_ITEM     { sku, qrData? }                          ack({ ok, product } | { ok:false, code, message })
//
//  Server -> Room "session:<ID>"
//    SESSION_STATE   { sessionId, posConnected, scannerCount, createdAt }
//    ITEM_SCANNED    { scanId, product, quantity, scannedAt }
//    SCAN_ERROR      { sku, code, message }
//    ORDER_COMPLETED { orderId, totalAmount, items, ... }   (phát từ REST /api/orders)
// =====================================================================
import { randomUUID } from 'node:crypto';
import {
  findProductBySku,
  normalizeSku,
  upsertProductFromQr,
} from '../services/productService.js';
import {
  attach,
  detach,
  getOrRestoreSession,
  getSession,
  roomOf,
  serialize,
} from '../sessionStore.js';

const ROLES = new Set(['pos', 'scanner']);
const SCAN_COOLDOWN_MS = Number(process.env.SCAN_COOLDOWN_MS ?? 1500);

const fail = (code, message) => ({ ok: false, code, message });

export function registerSocketHandlers(io) {
  const broadcastState = (session) => io.to(roomOf(session.id)).emit('SESSION_STATE', serialize(session));

  /** Rời phiên hiện tại (khi join phiên khác hoặc disconnect). */
  const leaveCurrent = (socket) => {
    const session = socket.data.sessionId && getSession(socket.data.sessionId);
    if (!session) return;
    detach(session, socket.id);
    socket.leave(roomOf(session.id));
    socket.data = {};
    broadcastState(session);
  };

  io.on('connection', (socket) => {
    socket.on('JOIN_SESSION', (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      const role = payload?.role;
      if (!ROLES.has(role)) return reply(fail('INVALID_ROLE', "role phải là 'pos' hoặc 'scanner'"));

      const session = getOrRestoreSession(payload?.sessionId);
      if (!session) return reply(fail('SESSION_NOT_FOUND', 'Mã phiên phải gồm 6 chữ/số'));

      leaveCurrent(socket);
      socket.join(roomOf(session.id));
      socket.data = { sessionId: session.id, role, lastScan: null };
      attach(session, role, socket.id);

      console.log(`[socket] ${role} ${socket.id} joined ${session.id}`);
      reply({ ok: true, session: serialize(session) });
      broadcastState(session);
    });

    socket.on('SCAN_ITEM', async (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      const session = socket.data.sessionId && getSession(socket.data.sessionId);
      if (!session) return reply(fail('NOT_IN_SESSION', 'Chưa ghép nối với máy POS'));

      const sku = normalizeSku(payload?.sku ?? payload?.qrData?.sku ?? payload?.qrData?.barcode);
      if (!sku) return reply(fail('INVALID_SKU', 'Mã QR không chứa SKU hợp lệ'));

      // html5-qrcode bắn callback liên tục khi camera còn nhìn thấy mã -> chặn quét trùng.
      const now = Date.now();
      const last = socket.data.lastScan;
      if (last && last.sku === sku && now - last.at < SCAN_COOLDOWN_MS) {
        return reply(fail('DUPLICATE_SCAN', 'Vừa quét sản phẩm này'));
      }
      socket.data.lastScan = { sku, at: now };

      try {
        let product = await findProductBySku(sku);
        // Nếu SP quét từ QR ngoài chưa có trong DB nhưng QR chứa đủ tên + giá -> tự động đồng bộ vào DB!
        if (!product && payload?.qrData) {
          product = await upsertProductFromQr({ ...payload.qrData, sku });
        }
        if (!product) {
          const error = fail('PRODUCT_NOT_FOUND', `Không tìm thấy sản phẩm ${sku}`);
          io.to(roomOf(session.id)).emit('SCAN_ERROR', { sku, ...error });
          return reply(error);
        }

        io.to(roomOf(session.id)).emit('ITEM_SCANNED', {
          scanId: randomUUID(),
          product,
          quantity: 1,
          scannedAt: new Date(now).toISOString(),
        });
        reply({ ok: true, product });
      } catch (err) {
        console.error('[socket] SCAN_ITEM error:', err);
        reply(fail('SERVER_ERROR', 'Lỗi máy chủ, vui lòng thử lại'));
      }
    });

    socket.on('disconnect', () => leaveCurrent(socket));
  });
}
