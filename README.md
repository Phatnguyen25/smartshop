# 🛒 SmartShop POS — Hệ thống POS Bán lẻ Thông minh & Mobile Scanner

Hệ thống quản lý bán lẻ thời gian thực biến điện thoại di động (App Flutter & Web PWA) thành máy quét mã vạch/QR không dây kết nối trực tiếp với màn hình thu ngân (POS), quản lý tồn kho theo nguyên tắc **FEFO (First Expired, First Out)** và tích hợp gợi ý bán kèm **FP-Growth** cùng dự báo nhập hàng **WMA**.

## 1. Kiến trúc 4 thành phần
- **Web 1 — Smart POS (`/pos`)**: Màn hình thu ngân nhận sản phẩm quét từ điện thoại theo thời gian thực qua WebSocket (`Socket.io`), phát âm thanh "BÍP!" siêu thị, gợi ý bán kèm AI và thanh toán trừ lô FEFO.
- **Web 2 — QR Simulator (`/simulator`)**: Kệ hàng giả lập chuỗi cửa hàng tiện lợi (**WinMart+ / Circle K**) và kệ mở rộng ngoài DB (**Bách Hóa Xanh / GS25** — tự động biến tấu & đồng bộ vào PostgreSQL ngay khi quét).
- **Web 3 — Admin & Inventory (`/admin`)**: Sổ quản lý kho trực quan, cảnh báo hàng quá hạn / sắp hết hạn theo màu sắc, dự báo nhập hàng tuần tới và mẹo bày kệ bán kèm.
- **Mobile Scanner (`scanner_app/` & `/scanner`)**:
  - **App Flutter Android (`scanner_app/`)**: Quét QR/Barcode bằng phần cứng MLKit (`mobile_scanner`), phát âm "BÍP-BÍP!" phần cứng (`ToneGenerator`) và kết nối không dây qua Wi-Fi hoặc cáp USB.
  - **Web Scanner (`/scanner`)**: Phiên bản quét chạy trực tiếp trên trình duyệt di động bằng `html5-qrcode`.

## 2. Cách chạy nhanh

```bash
# 1. Khởi động PostgreSQL 16 (cổng 5433)
docker compose up -d

# 2. Chạy Backend API + Socket.io (cổng 4000)
cd server
cp -n .env.example .env
npm install
npm run db:init
npm run dev

# 3. Chạy Frontend React + Vite (cổng 5173)
cd ../client
npm install
npm run dev
```

### Chạy App Flutter trên điện thoại Android (`scanner_app/`)
```bash
cd scanner_app
flutter pub get
flutter run
```
