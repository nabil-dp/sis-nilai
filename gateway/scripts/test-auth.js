// Menguji endpoint /auth/*. Jalankan gateway dulu (npm start), lalu: npm run test:auth
const jwt = require('jsonwebtoken');
const { openDb } = require('../../db/db');

const BASE = process.env.GATEWAY_URL || 'http://localhost:3000';
let lulus = 0;
let gagal = 0;

function cek(nama, kondisi, info = '') {
  if (kondisi) {
    lulus++;
    console.log(`  PASS  ${nama}`);
  } else {
    gagal++;
    console.log(`  FAIL  ${nama} ${info}`);
  }
}

async function post(path, body, headers = {}) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch { /* body kosong */ }
  return { status: res.status, data };
}

(async () => {
  console.log(`Menguji gateway di ${BASE}\n`);
  const DEV = 'DEV-MHS1-01';
  const login = { username: 'mhs1', password: 'password123' };

  console.log('[Login]');
  let r = await post('/auth/login', login, { 'X-Device-ID': DEV });
  cek('Login valid -> 200', r.status === 200, `(status ${r.status})`);
  const { access_token, refresh_token } = r.data || {};
  const payload = jwt.decode(access_token) || {};
  cek('Access token berisi sub dan role', Boolean(payload.sub) && payload.role === 'mahasiswa');
  cek('Access token berlaku 10 menit', payload.exp - payload.iat === 600);
  cek('Refresh token diterima', typeof refresh_token === 'string' && refresh_token.length > 0);

  r = await post('/auth/login', { ...login, password: 'salah' }, { 'X-Device-ID': DEV });
  cek('Password salah -> 401', r.status === 401, `(status ${r.status})`);

  r = await post('/auth/login', { ...login, username: 'tidak-ada' }, { 'X-Device-ID': DEV });
  cek('Username tidak ada -> 401', r.status === 401, `(status ${r.status})`);

  r = await post('/auth/login', login, { 'X-Device-ID': 'DEV-ASING-99' });
  cek('Device tidak terdaftar -> 403', r.status === 403, `(status ${r.status})`);

  r = await post('/auth/login', login, { 'X-Device-ID': 'DEV-DOSEN1-01' });
  cek('Device milik user lain -> 403', r.status === 403, `(status ${r.status})`);

  r = await post('/auth/login', login);
  cek('Tanpa X-Device-ID -> 400', r.status === 400, `(status ${r.status})`);

  console.log('\n[Refresh dan Logout]');
  r = await post('/auth/refresh', { refresh_token });
  cek('Refresh valid -> 200 + access token baru', r.status === 200 && Boolean(r.data?.access_token), `(status ${r.status})`);

  r = await post('/auth/refresh', { refresh_token: 'token-ngawur' });
  cek('Refresh token ngawur -> 401', r.status === 401, `(status ${r.status})`);

  r = await post('/auth/logout', { refresh_token });
  cek('Logout -> 200', r.status === 200, `(status ${r.status})`);

  r = await post('/auth/refresh', { refresh_token });
  cek('Refresh setelah logout -> 401', r.status === 401, `(status ${r.status})`);

  r = await post('/auth/logout', { refresh_token });
  cek('Logout dua kali -> 401', r.status === 401, `(status ${r.status})`);

  console.log('\n[Token service]');
  r = await post('/auth/service', { client_id: 'service-nilai', client_secret: 'rahasia-service-nilai' });
  cek('Service valid -> 200', r.status === 200, `(status ${r.status})`);
  const sp = jwt.decode(r.data?.access_token) || {};
  cek('Token service role=service', sp.role === 'service');
  cek('Token service berlaku 5 menit', sp.exp - sp.iat === 300);

  r = await post('/auth/service', { client_id: 'service-nilai', client_secret: 'salah' });
  cek('Secret service salah -> 401', r.status === 401, `(status ${r.status})`);

  console.log(`\nHasil: ${lulus} lulus, ${gagal} gagal\n`);

  console.log('Audit log terakhir:');
  const db = openDb();
  console.table(
    db.prepare(
      'SELECT waktu, subjek, endpoint, device, hasil, alasan FROM audit_log ORDER BY id DESC LIMIT 15'
    ).all()
  );
  db.close();

  process.exit(gagal ? 1 : 0);
})().catch((err) => {
  console.error('Tidak bisa terhubung ke gateway. Sudah dijalankan? ->', err.message);
  process.exit(1);
});
