// Menguji PEP dan proxy lewat HTTP. Gateway harus sedang berjalan (npm start).
// Skrip ini menjalankan "service palsu" di port 3001/3002 untuk merekam request yang
// sampai ke service. Jika port itu sudah dipakai (service asli berjalan), pemeriksaan
// yang memerlukan rekaman dilewati. Jalankan: npm run test:pep
const http = require('http');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { openDb } = require('../../db/db');

const BASE = process.env.GATEWAY_URL || 'http://localhost:3000';
const ISSUER = 'sistem-nilai-gateway';
let lulus = 0;
let gagal = 0;
let dilewati = 0;

function cek(nama, kondisi, info = '') {
  if (kondisi) { lulus++; console.log(`  PASS  ${nama}`); }
  else { gagal++; console.log(`  FAIL  ${nama} ${info}`); }
}
function lewati(nama, alasan) {
  dilewati++;
  console.log(`  SKIP  ${nama} (${alasan})`);
}

async function api(method, path, { token, device, body, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if (device) h['X-Device-ID'] = device;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, {
    method,
    headers: h,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* body kosong */ }
  return { status: res.status, data };
}

async function login(username, device) {
  const r = await api('POST', '/auth/login', { body: { username, password: 'password123' }, device });
  if (r.status !== 200) throw new Error(`Login ${username} gagal (status ${r.status}). Sudah di-seed?`);
  return r.data;
}

// Service palsu: merekam setiap request yang sampai
function mulaiUpstream(url, nama) {
  const port = Number(new URL(url).port);
  return new Promise((resolve) => {
    const terima = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        terima.push({ method: req.method, url: req.url, headers: req.headers, body });
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ upstream: nama, ok: true }));
      });
    });
    server.once('error', () => resolve(null));
    server.listen(port, () => resolve({ server, terima }));
  });
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const diteruskan = (status) => status !== 401 && status !== 403;

(async () => {
  console.log(`Menguji PEP dan proxy di ${BASE}\n`);

  const upNilai = await mulaiUpstream(config.nilaiUrl, 'nilai');
  const upTranskrip = await mulaiUpstream(config.transkripUrl, 'transkrip');
  if (!upNilai || !upTranskrip) {
    console.log('Catatan: port service sudah dipakai; pemeriksaan rekaman upstream dilewati.\n');
  }

  const db = openDb();
  const kelasDosen2 = db.prepare(
    "SELECT id FROM kelas WHERE dosen_id = (SELECT id FROM users WHERE username = 'dosen2')"
  ).get().id;
  db.close();

  const mhs1 = await login('mhs1', 'DEV-MHS1-01');
  const dosen1 = await login('dosen1', 'DEV-DOSEN1-01');
  const admin = await login('admin', 'DEV-ADMIN-01');
  const rs = await api('POST', '/auth/service', {
    body: { client_id: 'service-nilai', client_secret: 'rahasia-service-nilai' },
  });
  const tokenService = rs.data.access_token;

  const D_MHS1 = 'DEV-MHS1-01';
  const D_DOSEN1 = 'DEV-DOSEN1-01';
  const D_ADMIN = 'DEV-ADMIN-01';
  let r;

  // ---------------------------------------------------------------
  console.log('[Autentikasi di PEP -> 401]');
  r = await api('GET', '/nilai', { device: D_MHS1 });
  cek('Tanpa token', r.status === 401, `(status ${r.status})`);

  r = await api('GET', '/nilai', { device: D_MHS1, headers: { Authorization: 'Basic abc123' } });
  cek('Skema Authorization bukan Bearer', r.status === 401, `(status ${r.status})`);

  r = await api('GET', '/nilai', { token: 'bukan.jwt.valid', device: D_MHS1 });
  cek('Token ngawur', r.status === 401, `(status ${r.status})`);

  const kedaluwarsa = jwt.sign(
    { sub: String(mhs1.user.id), role: 'mahasiswa', exp: Math.floor(Date.now() / 1000) - 60 },
    config.jwtSecret, { algorithm: 'HS256', issuer: ISSUER }
  );
  r = await api('GET', '/nilai', { token: kedaluwarsa, device: D_MHS1 });
  cek('Token kedaluwarsa', r.status === 401, `(status ${r.status})`);

  const kunciLain = jwt.sign(
    { sub: String(mhs1.user.id), role: 'mahasiswa' },
    'kunci-lain-yang-salah-0123456789abcdef', { algorithm: 'HS256', expiresIn: '10m', issuer: ISSUER }
  );
  r = await api('GET', '/nilai', { token: kunciLain, device: D_MHS1 });
  cek('Token ditandatangani kunci lain', r.status === 401, `(status ${r.status})`);

  const noneToken =
    `${b64({ alg: 'none', typ: 'JWT' })}.` +
    `${b64({ sub: String(admin.user.id), role: 'admin', iss: ISSUER, exp: Math.floor(Date.now() / 1000) + 600 })}.`;
  r = await api('GET', '/transkrip/2210001', { token: noneToken, device: D_ADMIN });
  cek('Token alg=none (tanpa tanda tangan)', r.status === 401, `(status ${r.status})`);

  r = await api('GET', '/nilai', { token: mhs1.refresh_token, device: D_MHS1 });
  cek('Refresh token dipakai sebagai access token', r.status === 401, `(status ${r.status})`);

  // ---------------------------------------------------------------
  console.log('\n[Keputusan policy di PEP -> 403]');
  r = await api('GET', '/nilai', { token: mhs1.access_token, device: 'DEV-ASING-99' });
  cek('Device tidak terdaftar', r.status === 403, `(status ${r.status})`);

  r = await api('GET', '/nilai', { token: mhs1.access_token });
  cek('Tanpa X-Device-ID', r.status === 403, `(status ${r.status})`);

  r = await api('GET', '/admin', { token: admin.access_token, device: D_ADMIN });
  cek('Endpoint tidak dikenal (default deny)', r.status === 403, `(status ${r.status})`);

  r = await api('GET', '/NILAI', { token: mhs1.access_token, device: D_MHS1 });
  cek('Path huruf besar /NILAI', r.status === 403, `(status ${r.status})`);

  r = await api('GET', '//nilai', { token: mhs1.access_token, device: D_MHS1 });
  cek('Path ganda //nilai', r.status === 403, `(status ${r.status})`);

  r = await api('GET', '/nilai?nim=2210002', { token: mhs1.access_token, device: D_MHS1 });
  cek('Mahasiswa meminta nilai NIM lain', r.status === 403, `(status ${r.status})`);

  r = await api('GET', '/transkrip/2210002', { token: mhs1.access_token, device: D_MHS1 });
  cek('Mahasiswa meminta transkrip NIM lain', r.status === 403, `(status ${r.status})`);

  r = await api('GET', `/nilai?kelas_id=${kelasDosen2}`, { token: dosen1.access_token, device: D_DOSEN1 });
  cek('Dosen1 meminta nilai kelas dosen2', r.status === 403, `(status ${r.status})`);

  r = await api('POST', '/transkrip/sinkron', { token: dosen1.access_token, device: D_DOSEN1, body: {} });
  cek('Token dosen ke /transkrip/sinkron', r.status === 403, `(status ${r.status})`);

  r = await api('POST', '/transkrip/sinkron', { token: admin.access_token, device: D_ADMIN, body: {} });
  cek('Token admin ke /transkrip/sinkron', r.status === 403, `(status ${r.status})`);

  r = await api('GET', '/nilai', { token: tokenService });
  cek('Token service ke GET /nilai', r.status === 403, `(status ${r.status})`);

  if (upNilai && upTranskrip) {
    cek('Request yang ditolak tidak pernah sampai ke service',
      upNilai.terima.length === 0 && upTranskrip.terima.length === 0,
      `(nilai: ${upNilai.terima.length}, transkrip: ${upTranskrip.terima.length})`);
  } else {
    lewati('Request yang ditolak tidak sampai ke service', 'service palsu tidak aktif');
  }

  // ---------------------------------------------------------------
  console.log('\n[Request yang diizinkan diteruskan]');
  r = await api('GET', '/nilai?nim=2210001', {
    token: mhs1.access_token, device: D_MHS1, headers: { 'X-Gateway-Secret': 'secret-palsu-dari-klien' },
  });
  cek('Mahasiswa meminta nilai miliknya', diteruskan(r.status), `(status ${r.status})`);

  r = await api('GET', '/transkrip/2210001', { token: admin.access_token, device: D_ADMIN });
  cek('Admin meminta transkrip', diteruskan(r.status), `(status ${r.status})`);

  const bodySinkron = { kelas_id: 1, data: [{ nim: '2210001', nilai: 85 }] };
  r = await api('POST', '/transkrip/sinkron', { token: tokenService, body: bodySinkron });
  cek('Token service ke /transkrip/sinkron', diteruskan(r.status), `(status ${r.status})`);

  // ---------------------------------------------------------------
  console.log('\n[Isi request yang sampai ke service]');
  if (upNilai && upTranskrip) {
    const kNilai = upNilai.terima[0];
    cek('Request ke Service Nilai sampai', Boolean(kNilai));
    cek('X-Gateway-Secret asli ditambahkan gateway',
      kNilai?.headers['x-gateway-secret'] === config.gatewaySecret);
    cek('X-Gateway-Secret palsu dari klien ditimpa',
      kNilai?.headers['x-gateway-secret'] !== 'secret-palsu-dari-klien');
    cek('Authorization diteruskan utuh', kNilai?.headers.authorization === `Bearer ${mhs1.access_token}`);
    cek('X-Device-ID diteruskan', kNilai?.headers['x-device-id'] === D_MHS1);
    cek('Query string diteruskan', kNilai?.url === '/nilai?nim=2210001', `(url: ${kNilai?.url})`);

    const kTrans = upTranskrip.terima.find((x) => x.method === 'POST');
    cek('Request POST ke Service Transkrip sampai', Boolean(kTrans));
    cek('Body JSON diteruskan utuh', kTrans?.body === JSON.stringify(bodySinkron), `(body: ${kTrans?.body})`);
    cek('Token service diteruskan', kTrans?.headers.authorization === `Bearer ${tokenService}`);
    cek('Gateway secret ikut pada request service', kTrans?.headers['x-gateway-secret'] === config.gatewaySecret);
  } else {
    lewati('Pemeriksaan header dan body di sisi service', 'service palsu tidak aktif');
  }

  console.log(`\nHasil: ${lulus} lulus, ${gagal} gagal, ${dilewati} dilewati\n`);

  console.log('Audit log terakhir:');
  const db2 = openDb();
  console.table(
    db2.prepare(
      'SELECT waktu, subjek, endpoint, device, hasil, alasan FROM audit_log ORDER BY id DESC LIMIT 20'
    ).all()
  );
  db2.close();

  upNilai?.server.close();
  upTranskrip?.server.close();
  process.exit(gagal ? 1 : 0);
})().catch((err) => {
  console.error('Uji gagal dijalankan:', err.message);
  process.exit(1);
});
