// Bộ phát âm thanh máy quét siêu thị (Web Audio API) dùng chung cho POS & Web Scanner.
// Tự động mở khoá (resume) AudioContext ngay ở tương tác đầu tiên của người dùng.

let audioCtx = null;

function getContext() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = new Ctx();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

// Mở khoá sẵn AudioContext ngay khi người dùng chạm/click/gõ phím lần đầu trên trang
if (typeof window !== 'undefined') {
  const unlock = () => {
    getContext();
  };
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('keydown', unlock, { passive: true });
}

/** Tiếng "BÍP!" cao & rõ chuẩn máy quét mã vạch siêu thị (2400Hz -> 2800Hz) */
export function playScanSuccessSound() {
  try {
    const ctx = getContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'square';
    osc.frequency.setValueAtTime(2400, now);
    osc.frequency.setValueAtTime(2850, now + 0.055);

    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.14);
  } catch {
    /* ignore */
  }
}

/** Tiếng báo lỗi trầm 2 nhịp khi quét mã không hợp lệ */
export function playScanErrorSound() {
  try {
    const ctx = getContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.setValueAtTime(220, now + 0.12);

    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.26);
  } catch {
    /* ignore */
  }
}
