# ĐẶC TẢ CÔNG NGHỆ VÀ HỆ THỐNG (Cập nhật: Điện thoại làm máy quét mã SP)
**Dự án:** Hệ thống Quản lý Bán lẻ Thông minh (POS, Mobile Scanner, QR Simulator & Admin Analytics)

## 1. Kiến trúc Hệ thống (System Architecture)
Hệ thống được thiết kế theo mô hình 4 thành phần tương tác thời gian thực (Real-time), bao gồm:

1. **Web 1 - Smart POS (Màn hình Thu ngân):** Giao diện máy tính tiền chạy trên trình duyệt. Không cần cắm máy quét mã vạch vật lý. Nó sẽ mở kết nối WebSocket lắng nghe sự kiện. Khi có sản phẩm được quét từ điện thoại, sản phẩm sẽ tự động "nhảy" vào giỏ hàng trên màn hình này.
2. **Web 2 - Product QR Simulator (Mô phỏng Sản phẩm):** Một trang web đơn giản hiển thị danh sách sản phẩm. Mỗi sản phẩm đi kèm một mã QR (chứa thông tin `SKU`, `Tên`, `Giá`). Trang này dùng để mô phỏng việc bạn đang cầm các sản phẩm vật lý có dán tem QR trên tay.
3. **Mobile Scanner (Điện thoại quét mã):** Ứng dụng Web PWA hoặc Mobile App mở trên điện thoại của nhân viên thu ngân. Dùng Camera để quét mã QR từ **Web 2**. Khi quét thành công, nó gửi tín hiệu lên Server.
4. **Web 3 - Admin & Analytics (Quản trị & Phân tích):** Trang Dashboard dành cho chủ cửa hàng để: Kiểm kê kho (theo nguyên tắc FEFO), xem báo cáo phân tích AI (luật bán chéo FP-Growth) và xem dự báo nhập hàng (WMA).

## 2. Luồng xử lý Cốt lõi (Scanning Workflow)
- **Bước 1:** Thu ngân mở **Web 1 (POS)** trên máy tính. Hệ thống tạo một `Session_ID` (phiên làm việc) và kết nối WebSocket.
- **Bước 2:** Thu ngân mở **Mobile Scanner** trên điện thoại, nhập `Session_ID` đó để ghép nối (Pairing) điện thoại với màn hình POS.
- **Bước 3:** Thu ngân chĩa Camera điện thoại vào **Web 2 (Simulator)** để quét mã QR của sản phẩm (VD: Lon Coca).
- **Bước 4:** Điện thoại đọc được `SKU: COCA01`, lập tức bắn sự kiện qua WebSocket: `SCAN_ITEM {sku: "COCA01", session: "..."}`.
- **Bước 5:** Backend nhận tín hiệu, truy xuất thông tin lon Coca và đẩy (emit) về **Web 1 (POS)**. Lon Coca lập tức hiện trong giỏ hàng trên màn hình máy tính. Đồng thời, AI gợi ý "Nên mời khách mua thêm Snack" (FP-Growth).

## 3. Tech Stack (Công nghệ sử dụng)
- **Backend & Real-time:** Node.js (Express + Socket.io) hoặc Python (FastAPI + WebSockets).
- **Database:** PostgreSQL (quản lý FEFO, Inventory_Batches).
- **Frontend (Web 1, Web 2, Web 3):** ReactJS (TailwindCSS). Sử dụng thư viện `qrcode.react` cho Web 2.
- **Scanner (Mobile):** ReactJS (PWA) với thư viện `html5-qrcode` để bật Camera điện thoại.
