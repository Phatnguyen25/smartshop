import { Router } from 'express';
import { HttpError } from '../httpError.js';
import { createSession, getSession, serialize } from '../sessionStore.js';

const router = Router();

// POST /api/sessions -> POS gọi khi mở màn hình thu ngân, nhận về sessionId để hiển thị cho điện thoại
router.post('/', (_req, res) => {
  res.status(201).json(serialize(createSession()));
});

// GET /api/sessions/:id -> điện thoại kiểm tra mã phiên trước khi kết nối socket
router.get('/:id', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) throw new HttpError(404, 'Phiên không tồn tại hoặc đã hết hạn', 'SESSION_NOT_FOUND');
  res.json(serialize(session));
});

export default router;
