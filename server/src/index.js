import http from 'node:http';
import cors from 'cors';
import express from 'express';
import { Server } from 'socket.io';
import { pool } from './db.js';
import inventoryRouter from './routes/inventory.js';
import ordersRouter from './routes/orders.js';
import productsRouter from './routes/products.js';
import sessionsRouter from './routes/sessions.js';
import { registerSocketHandlers } from './sockets/index.js';

const PORT = Number(process.env.PORT) || 4000;

// "*" -> phản chiếu mọi origin (dev, điện thoại truy cập qua IP LAN). Production: liệt kê domain cụ thể.
const rawOrigin = process.env.CORS_ORIGIN ?? '*';
const corsOrigin = rawOrigin === '*' ? true : rawOrigin.split(',').map((o) => o.trim());

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: corsOrigin } });

app.set('io', io); // để REST routes có thể emit (vd: ORDER_COMPLETED)
app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: '100kb' }));

app.get('/api/health', async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ status: 'ok', db: 'up', uptime: process.uptime() });
});

app.use('/api/products', productsRouter);
app.use('/api/sessions', sessionsRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/inventory', inventoryRouter);

app.use((req, res) => res.status(404).json({ code: 'NOT_FOUND', message: `${req.method} ${req.path}` }));

// Express 5 tự chuyển lỗi từ async handler vào đây.
app.use((err, _req, res, _next) => {
  const status = err.status ?? 500;
  if (status >= 500) console.error('[http]', err);
  res.status(status).json({
    code: err.code ?? (status >= 500 ? 'SERVER_ERROR' : 'BAD_REQUEST'),
    message: status >= 500 ? 'Lỗi máy chủ' : err.message,
  });
});

registerSocketHandlers(io);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 SmartShop API + Socket.io: http://localhost:${PORT}`);
});

const shutdown = () => {
  console.log('Shutting down...');
  io.close(); // đóng luôn http server
  pool.end().finally(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
