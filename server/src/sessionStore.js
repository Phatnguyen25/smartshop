// Quản lý phiên ghép nối POS <-> Mobile Scanner (in-memory).
// Mỗi phiên = 1 Socket.io room "session:<ID>". POS tạo phiên, điện thoại nhập ID để join.
import { randomBytes } from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ID_LENGTH = 6;
const ID_REGEX = /^[A-Z0-9]{6}$/;
const IDLE_TTL_MS = 12 * 60 * 60 * 1000;

const sessions = new Map();

export const roomOf = (sessionId) => `session:${sessionId}`;

export const normalizeSessionId = (id) => String(id ?? '').trim().toUpperCase();

function generateId() {
  return Array.from(randomBytes(ID_LENGTH), (b) => ALPHABET[b % ALPHABET.length]).join('');
}

export function createSession(preferredId) {
  const normalized = preferredId ? normalizeSessionId(preferredId) : null;
  let id = normalized && ID_REGEX.test(normalized) ? normalized : null;
  if (!id) {
    do id = generateId();
    while (sessions.has(id));
  }

  const now = Date.now();
  const session = { id, createdAt: now, lastActiveAt: now, pos: new Set(), scanners: new Set() };
  sessions.set(id, session);
  return session;
}

export function getSession(id) {
  const session = sessions.get(normalizeSessionId(id));
  if (session) session.lastActiveAt = Date.now();
  return session;
}

/** Lấy phiên hiện có hoặc tự khôi phục nếu mã 6 ký tự hợp lệ (giúp server restart không làm đứt kết nối). */
export function getOrRestoreSession(id) {
  const code = normalizeSessionId(id);
  if (!ID_REGEX.test(code)) return null;
  return getSession(code) ?? createSession(code);
}

/** Gắn socket vào phiên theo vai trò ('pos' | 'scanner'). */
export function attach(session, role, socketId) {
  (role === 'pos' ? session.pos : session.scanners).add(socketId);
  session.lastActiveAt = Date.now();
}

export function detach(session, socketId) {
  session.pos.delete(socketId);
  session.scanners.delete(socketId);
  session.lastActiveAt = Date.now();
}

/** Dạng JSON gửi cho client (không lộ socket id). */
export const serialize = (s) => ({
  sessionId: s.id,
  createdAt: new Date(s.createdAt).toISOString(),
  posConnected: s.pos.size > 0,
  scannerCount: s.scanners.size,
});

setInterval(() => {
  const cutoff = Date.now() - IDLE_TTL_MS;
  for (const [id, s] of sessions) {
    if (s.pos.size === 0 && s.scanners.size === 0 && s.lastActiveAt < cutoff) sessions.delete(id);
  }
}, 60 * 60 * 1000).unref();
