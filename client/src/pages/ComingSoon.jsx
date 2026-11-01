import { Link } from 'react-router';

export default function ComingSoon({ title, step }) {
  return (
    <main className="mx-auto max-w-xl px-4 py-24 text-center">
      <h1 className="text-2xl font-bold">{title}</h1>
      {step && <p className="mt-2 text-slate-400">Sẽ được xây dựng ở Bước {step}.</p>}
      <Link to="/" className="mt-6 inline-block text-emerald-400 hover:underline">
        ← Về trang chủ
      </Link>
    </main>
  );
}
