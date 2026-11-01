// Smoke test end-to-end: giả lập 1 POS + 1 điện thoại quét mã, rồi thanh toán.
// Chạy khi server đang bật:  npm run smoke
import { io } from 'socket.io-client';

const BASE = process.env.API_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;
const json = async (res) => {
  const body = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(body)}`);
  return body;
};
const connect = () =>
  new Promise((resolve, reject) => {
    const s = io(BASE, { transports: ['websocket'] });
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });

// 1. POS tạo phiên
const { sessionId } = await json(await fetch(`${BASE}/api/sessions`, { method: 'POST' }));
console.log('1. Session:', sessionId);

// 2. POS + Scanner join cùng room
const pos = await connect();
const scanner = await connect();
console.log('2. POS join    :', await pos.emitWithAck('JOIN_SESSION', { sessionId, role: 'pos' }));
pos.on('SESSION_STATE', (s) => console.log('   [POS] SESSION_STATE', s));
console.log('   Scanner join:', await scanner.emitWithAck('JOIN_SESSION', { sessionId, role: 'scanner' }));

// 3. Điện thoại quét -> POS nhận ITEM_SCANNED
const received = new Promise((resolve) => pos.once('ITEM_SCANNED', resolve));
console.log('3. Scan ack    :', await scanner.emitWithAck('SCAN_ITEM', { sku: 'COCA01' }));
console.log('   [POS] ITEM_SCANNED', await received);
console.log('   Duplicate   :', await scanner.emitWithAck('SCAN_ITEM', { sku: 'COCA01' }));
console.log('   Unknown SKU :', await scanner.emitWithAck('SCAN_ITEM', { sku: 'NOPE99' }));

// 4. Thanh toán -> trừ kho FEFO, POS nhận ORDER_COMPLETED
const completed = new Promise((resolve) => pos.once('ORDER_COMPLETED', resolve));
const order = await json(
  await fetch(`${BASE}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, items: [{ sku: 'COCA01', quantity: 2 }, { sku: 'SNACK01', quantity: 1 }] }),
  }),
);
console.log('4. Order:', JSON.stringify(order, null, 2));
console.log('   [POS] ORDER_COMPLETED #', (await completed).orderId);

pos.close();
scanner.close();
console.log('✅ Smoke test passed');
