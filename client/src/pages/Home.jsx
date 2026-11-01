import { Link } from 'react-router';

const APPS = [
  { to: '/pos', icon: '🖥️', title: 'Web 1 · Smart POS', desc: 'Màn hình thu ngân, nhận SP quét từ điện thoại.' },
  { to: '/simulator', icon: '🏷️', title: 'Web 2 · QR Simulator', desc: 'Danh sách SP kèm mã QR để quét thử.' },
  { to: '/admin', icon: '📊', title: 'Web 3 · Admin', desc: 'Tồn kho theo lô (FEFO) & báo cáo AI.' },
  { to: '/scanner', icon: '📱', title: 'Mobile Scanner', desc: 'Mở trên điện thoại để quét mã.' },
];

export default function Home() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-12">
      <h1 className="text-3xl font-bold">🛒 SmartShop POS</h1>
      <p className="mt-2 text-slate-400">Hệ thống POS bán lẻ dùng điện thoại làm máy quét mã.</p>

      <nav className="mt-8 grid gap-4 sm:grid-cols-2">
        {APPS.map((app) => (
          <Link
            key={app.to}
            to={app.to}
            className="rounded-2xl border border-slate-800 bg-slate-900 p-5 transition hover:border-emerald-600 focus-visible:outline-2 focus-visible:outline-emerald-500"
          >
            <article>
              <h2 className="text-lg font-semibold">
                <span aria-hidden="true">{app.icon}</span> {app.title}
              </h2>
              <p className="mt-1 text-sm text-slate-400">{app.desc}</p>
            </article>
          </Link>
        ))}
      </nav>
    </main>
  );
}
