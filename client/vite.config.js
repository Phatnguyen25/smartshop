import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const BACKEND = 'http://localhost:4000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true, // cố định cổng vì đã `adb reverse tcp:5173`
    host: true, // cho phép truy cập qua IP LAN (phương án dự phòng cho Wi-Fi)
    // Proxy: frontend và backend chung 1 origin -> không lo CORS / mixed-content trên điện thoại
    proxy: {
      '/api': BACKEND,
      '/socket.io': { target: BACKEND, ws: true },
    },
  },
});
