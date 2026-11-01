-- =====================================================================
-- SmartShop POS - Database schema (idempotent)
-- Mô phỏng dữ liệu chuỗi cửa hàng tiện lợi (WinMart+ / Circle K / Bách Hóa Xanh)
-- Tiền tệ: VND -> lưu INTEGER (không có phần thập phân).
-- =====================================================================

CREATE TABLE IF NOT EXISTS products (
    id          SERIAL PRIMARY KEY,
    sku         VARCHAR(32)  NOT NULL UNIQUE,
    barcode     VARCHAR(32),
    name        VARCHAR(255) NOT NULL,
    brand       VARCHAR(100),
    category    VARCHAR(100),
    unit        VARCHAR(40)  NOT NULL DEFAULT 'Cái',
    price       INTEGER      NOT NULL CHECK (price >= 0),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Bổ sung cột nếu bảng đã được tạo từ phiên bản trước
ALTER TABLE products ADD COLUMN IF NOT EXISTS barcode  VARCHAR(32);
ALTER TABLE products ADD COLUMN IF NOT EXISTS brand    VARCHAR(100);
ALTER TABLE products ADD COLUMN IF NOT EXISTS unit     VARCHAR(40) NOT NULL DEFAULT 'Cái';

-- Mỗi lần nhập hàng = 1 lô (batch) với hạn sử dụng riêng -> nền tảng cho FEFO
-- (First Expired, First Out): khi bán, trừ kho từ lô có expiry_date sớm nhất.
CREATE TABLE IF NOT EXISTS inventory_batches (
    id             SERIAL PRIMARY KEY,
    product_id     INTEGER     NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    batch_code     VARCHAR(50) NOT NULL,
    quantity       INTEGER     NOT NULL CHECK (quantity >= 0),
    received_date  DATE        NOT NULL DEFAULT CURRENT_DATE,
    expiry_date    DATE        NOT NULL,
    UNIQUE (product_id, batch_code)
);

CREATE INDEX IF NOT EXISTS idx_batches_product_expiry
    ON inventory_batches (product_id, expiry_date);

CREATE TABLE IF NOT EXISTS orders (
    id            SERIAL PRIMARY KEY,
    session_id    VARCHAR(16),
    total_amount  INTEGER     NOT NULL CHECK (total_amount >= 0),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_items (
    id          SERIAL PRIMARY KEY,
    order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id  INTEGER NOT NULL REFERENCES products(id),
    quantity    INTEGER NOT NULL CHECK (quantity > 0),
    unit_price  INTEGER NOT NULL CHECK (unit_price >= 0)
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items (order_id);
