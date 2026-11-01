// Khởi tạo schema + seed (idempotent). Dùng Node thay vì psql để không phụ thuộc client cài trên máy.
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pool } from '../src/db.js';

const dir = path.join(import.meta.dirname, '..', 'db');
const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();

try {
  for (const file of files) {
    await pool.query(await readFile(path.join(dir, file), 'utf8'));
    console.log(`✔ ${file}`);
  }
} catch (err) {
  console.error('✖ db:init failed:', err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
