import { Router } from 'express';
import { HttpError } from '../httpError.js';
import {
  findProductBySku,
  listProducts,
  normalizeSku,
  upsertProductFromQr,
} from '../services/productService.js';

const router = Router();

// GET /api/products  -> danh sách SP (dùng cho Simulator, POS)
router.get('/', async (_req, res) => {
  res.json(await listProducts());
});

// POST /api/products  -> thêm nhanh / đồng bộ sản phẩm từ nguồn ngoài vào DB
router.post('/', async (req, res) => {
  const product = await upsertProductFromQr(req.body);
  if (!product) {
    throw new HttpError(400, 'Cần có sku, name và price hợp lệ', 'INVALID_PRODUCT');
  }
  req.app.get('io')?.emit('PRODUCTS_UPDATED', product);
  res.status(201).json(product);
});

// GET /api/products/:sku
router.get('/:sku', async (req, res) => {
  const sku = normalizeSku(req.params.sku);
  if (!sku) throw new HttpError(400, 'SKU không hợp lệ', 'INVALID_SKU');

  const product = await findProductBySku(sku);
  if (!product) throw new HttpError(404, `Không tìm thấy sản phẩm ${sku}`, 'PRODUCT_NOT_FOUND');
  res.json(product);
});

export default router;
