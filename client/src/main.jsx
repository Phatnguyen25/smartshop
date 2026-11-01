import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router';
import './index.css';
import Admin from './pages/Admin.jsx';
import ComingSoon from './pages/ComingSoon.jsx';
import Home from './pages/Home.jsx';
import Pos from './pages/Pos.jsx';
import Scanner from './pages/Scanner.jsx';
import Simulator from './pages/Simulator.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/simulator" element={<Simulator />} />
        <Route path="/scanner" element={<Scanner />} />
        <Route path="/pos" element={<Pos />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="*" element={<ComingSoon title="404 - Không tìm thấy trang" />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
