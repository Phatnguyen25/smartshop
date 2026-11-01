// "POS giả" trên terminal: tạo phiên, in link cho điện thoại, log mọi sự kiện nhận được.
// Dùng để test Mobile Scanner khi chưa có (hoặc không muốn mở) màn hình /pos.
//   npm run pos:listen
import { io } from 'socket.io-client';

const BASE = process.env.API_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;
const CLIENT = process.env.CLIENT_URL ?? 'http://localhost:5173';

const { sessionId } = await (await fetch(`${BASE}/api/sessions`, { method: 'POST' })).json();
const socket = io(BASE);

socket.on('connect', async () => {
  const res = await socket.emitWithAck('JOIN_SESSION', { sessionId, role: 'pos' });
  console.log(res.ok ? `\n🖥️  POS giả đã mở phiên: ${sessionId}` : res);
  console.log(`📱 Mở trên điện thoại: ${CLIENT}/scanner?session=${sessionId}\n`);
});
socket.on('SESSION_STATE', (s) => console.log(`[SESSION_STATE] scanner: ${s.scannerCount}`));
socket.on('ITEM_SCANNED', (e) => console.log(`[ITEM_SCANNED] ${e.product.sku} · ${e.product.name} · ${e.product.price}đ`));
socket.on('SCAN_ERROR', (e) => console.log(`[SCAN_ERROR] ${e.sku}: ${e.message}`));
socket.on('disconnect', () => console.log('[disconnect]'));
