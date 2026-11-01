/** fetch JSON từ backend (qua Vite proxy). Ném Error kèm message từ server nếu lỗi. */
export async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.message ?? `HTTP ${res.status}`);
  return body;
}

const vnd = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' });
export const formatVND = (amount) => vnd.format(amount);
