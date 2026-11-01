-- =====================================================================
-- Dữ liệu cửa hàng thực tế: Cửa hàng tiện lợi WinMart+ / Circle K Việt Nam
-- Giá bán lẻ thực tế (VNĐ), mã vạch EAN-13 thật, đơn vị tính & thương hiệu.
-- Hạn dùng tính tương đối theo CURRENT_DATE để kịch bản FEFO luôn chuẩn.
-- =====================================================================

INSERT INTO products (sku, barcode, name, brand, category, unit, price) VALUES
    -- Đồ uống & Sữa
    ('COCA01',     '8935049501509', 'Nước ngọt Coca-Cola Original lon 320ml',        'Coca-Cola',     'Đồ uống',            'Lon',  10000),
    ('THMILK01',   '8935217410022', 'Sữa tươi tiệt trùng TH true MILK ít đường 180ml','TH true MILK',  'Sữa & Chế phẩm',     'Hộp',   9500),
    ('HIGHLAND01', '8936087820014', 'Cà phê sữa đá Highlands Coffee lon 235ml',       'Highlands',     'Đồ uống',            'Lon',  16000),
    ('AQUA01',     '8934588063053', 'Nước tinh khiết Aquafina chai 500ml',            'PepsiCo',       'Đồ uống',            'Chai',  6000),
    -- Đồ ăn nhanh & Tươi sống (hạn ngắn -> rất quan trọng cho FEFO)
    ('BANHMI01',   '8936012340011', 'Bánh mì que Pate chà bông C.P 90g',              'C.P',           'Đồ ăn nhanh',        'Cái',  22000),
    ('KIMBAP01',   '8936099880123', 'Cơm cuộn Kimbap cá ngừ Mayo 160g',               'Circle K Fresh','Đồ ăn nhanh',        'Phần', 28000),
    ('XUCXICH01',  '8934572001122', 'Xúc xích tiệt trùng Vissan heo gói 4 cây',       'Vissan',        'Đồ ăn nhanh',        'Gói',  19000),
    -- Mì ăn liền & Thực phẩm khô
    ('HAOHAO01',   '8934563138165', 'Mì Hảo Hảo tôm chua cay gói 75g',                'Acecook',       'Mì & Thực phẩm khô', 'Gói',   4500),
    ('OMACHI01',   '8936017362056', 'Mì khoai tây Omachi xốt bò hầm tô 113g',         'Masan',         'Mì & Thực phẩm khô', 'Tô',   18500),
    -- Snack & Bánh kẹo
    ('SNACK01',    '8936036020456', 'Snack khoai tây Lay''s vị tự nhiên gói 52g',     'Lay''s',        'Snack & Bánh kẹo',   'Gói',  12000),
    ('OREO01',     '7622210658128', 'Bánh quy Oreo socola kem vani 119.6g',           'Mondelez',      'Snack & Bánh kẹo',   'Cây',  17500),
    -- Gia vị & Nhu yếu phẩm
    ('CHINSU01',   '8936017360014', 'Tương ớt Chin-Su chai 250g',                     'Masan',         'Gia vị & Nhu yếu',   'Chai', 15000)
ON CONFLICT (sku) DO UPDATE SET
    barcode  = EXCLUDED.barcode,
    name     = EXCLUDED.name,
    brand    = EXCLUDED.brand,
    category = EXCLUDED.category,
    unit     = EXCLUDED.unit,
    price    = EXCLUDED.price;

INSERT INTO inventory_batches (product_id, batch_code, quantity, received_date, expiry_date)
SELECT p.id, b.batch_code, b.quantity, CURRENT_DATE - b.received_ago, CURRENT_DATE + b.expires_in
FROM (VALUES
    -- sku,          batch_code,             qty, nhập cách đây (ngày), hết hạn sau (ngày)
    ('COCA01',     'COCA01-LOT-A',           24,  60,    5),   -- cận date -> FEFO xuất trước
    ('COCA01',     'COCA01-LOT-B',          120,  10,  180),
    ('THMILK01',   'THMILK01-LOT-A',         18,  40,    4),   -- sữa cận date 4 ngày
    ('THMILK01',   'THMILK01-LOT-B',         96,   5,  120),
    ('HIGHLAND01', 'HIGHLAND01-LOT-A',       48,  20,  150),
    ('AQUA01',     'AQUA01-LOT-A',          100,  15,  365),
    ('BANHMI01',   'BANHMI01-LOT-A',         10,   2,    1),   -- bánh mì tươi hết hạn ngày mai!
    ('BANHMI01',   'BANHMI01-LOT-B',         15,   0,    3),
    ('KIMBAP01',   'KIMBAP01-LOT-A',          8,   1,    1),   -- kimbap hết hạn ngày mai!
    ('KIMBAP01',   'KIMBAP01-LOT-B',         12,   0,    2),
    ('XUCXICH01',  'XUCXICH01-LOT-A',        35,  30,   60),
    ('HAOHAO01',   'HAOHAO01-LOT-A',        200,  25,  140),
    ('OMACHI01',   'OMACHI01-LOT-A',         60,  20,  110),
    ('SNACK01',    'SNACK01-LOT-A',          30, 200,   -2),   -- ĐÃ HẾT HẠN -> khoá không bán
    ('SNACK01',    'SNACK01-LOT-B',          80,  15,   90),
    ('OREO01',     'OREO01-LOT-A',           14, 150,    6),   -- cận date 6 ngày
    ('OREO01',     'OREO01-LOT-B',           50,  10,  210),
    ('CHINSU01',   'CHINSU01-LOT-A',         45,  30,  240)
) AS b(sku, batch_code, quantity, received_ago, expires_in)
JOIN products p ON p.sku = b.sku
ON CONFLICT (product_id, batch_code) DO NOTHING;
