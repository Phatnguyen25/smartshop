import { io } from 'socket.io-client';

// Cùng origin với trang (Vite proxy /socket.io -> backend:4000), nên chạy được cả trên PC lẫn điện thoại.
// autoConnect: false -> mỗi trang tự connect/disconnect theo vòng đời component.
export const socket = io({ autoConnect: false });
