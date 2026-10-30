// Menguji audit log (4.4): setiap keputusan akses tercatat tepat satu baris dengan
// waktu, subjek, endpoint, device, hasil, dan alasan yang benar; token dan password
// tidak boleh ikut tercatat.
//
// Prasyarat: database sudah di-seed, gateway dan kedua service berjalan.
// Jalankan: npm run test:audit
const config = require('../config');
const { openDb } = require('../../db/db');

const BASE = process.env.GATEWAY_URL || 'http://localhost:3000';
const db = openDb();
let lulus = 0;
let gagal = 0;

function cek(nama, kondisi, info = '') {
  if (kondisi) { lulus++; console.log(`  PASS  ${nama}`); }
  else { gagal++; console.log(`  FAIL  ${nama} ${info}`); }
}

async function api(method, path, { token, device, body } = {}) {
  const h = {};
  if (token) h.Authorization = `Bearer ${token}`;
  if (device) h['X-Device-ID'] = device;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, {
    method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* body kosong */ }
  return { status: res.status, data };
}

const maxId = () => db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM audit_log').get().m;

async function login(username, device) {
  const r = await api('POST', '/auth/login', { body: { username, password: 'password123' }, device });
  if (r.status !== 200) throw new Error(`Login ${username} gagal (status ${r.status}). Sudah di-seed?`);
  return r.data;
}

(async () => {
  console.log(`Menguji audit log lewat gateway di ${BASE}\n`);

  // Persiapan (tidak ikut diperiksa)
  const mhs1 = await login('mhs1', 'DEV-MHS1-01');
  const dosen1 = await login('dosen1', 'DEV-DOSEN1-01');
  const uMhs1 = `user:${mhs1.user.id}`;
  const uDosen1 = `user:${dosen1.user.id}`;

  let refreshUji = null;
  let tokenService = null;

  const kasus = [
    { nama: 'Login valid',
      run: async () => { const r = await api('POST', '/auth/login', { body: { username: 'mhs1', password: 'password123' }, device: 'DEV-MHS1-01' }); refreshUji = r.data.refresh_token; },
      hasil: 'allow', subjek: uMhs1, endpoint: 'POST /auth/login', device: 'DEV-MHS1-01', alasan: 'login berhasil' },
    { nama: 'Login password salah',
      run: () => api('POST', '/auth/login', { body: { username: 'mhs1', password: 'salah' }, device: 'DEV-MHS1-01' }),
      hasil: 'deny', subjek: uMhs1, endpoint: 'POST /auth/login', device: 'DEV-MHS1-01', alasan: 'password salah' },
    { nama: 'Login username tidak ada',
      run: () => api('POST', '/auth/login', { body: { username: 'hantu', password: 'x' }, device: 'DEV-MHS1-01' }),
      hasil: 'deny', subjek: 'anonymous', endpoint: 'POST /auth/login', device: 'DEV-MHS1-01', alasan: 'username tidak ditemukan' },
    { nama: 'Login device tidak terdaftar',
      run: () => api('POST', '/auth/login', { body: { username: 'mhs1', password: 'password123' }, device: 'DEV-ASING-99' }),
      hasil: 'deny', subjek: uMhs1, endpoint: 'POST /auth/login', device: 'DEV-ASING-99', alasan: 'device tidak terdaftar' },
    { nama: 'GET /nilai tanpa token',
      run: () => api('GET', '/nilai', { device: 'DEV-MHS1-01' }),
      hasil: 'deny', subjek: 'anonymous', endpoint: 'GET /nilai', device: 'DEV-MHS1-01', alasan: 'Authorization' },
    { nama: 'GET /nilai token ngawur',
      run: () => api('GET', '/nilai', { token: 'bukan.jwt.valid', device: 'DEV-MHS1-01' }),
      hasil: 'deny', subjek: 'anonymous', endpoint: 'GET /nilai', device: 'DEV-MHS1-01', alasan: 'token tidak valid' },
    { nama: 'GET /nilai mahasiswa (allow)',
      run: () => api('GET', '/nilai', { token: mhs1.access_token, device: 'DEV-MHS1-01' }),
      hasil: 'allow', subjek: uMhs1, endpoint: 'GET /nilai', device: 'DEV-MHS1-01', alasan: 'mahasiswa melihat nilai miliknya' },
    { nama: 'GET /nilai?nim=lain (query tidak ikut di endpoint)',
      run: () => api('GET', '/nilai?nim=2210002', { token: mhs1.access_token, device: 'DEV-MHS1-01' }),
      hasil: 'deny', subjek: uMhs1, endpoint: 'GET /nilai', device: 'DEV-MHS1-01', alasan: 'nilai miliknya sendiri' },
    { nama: 'GET /transkrip/NIM lain',
      run: () => api('GET', '/transkrip/2210002', { token: mhs1.access_token, device: 'DEV-MHS1-01' }),
      hasil: 'deny', subjek: uMhs1, endpoint: 'GET /transkrip/2210002', device: 'DEV-MHS1-01', alasan: 'transkrip miliknya' },
    { nama: 'POST /auth/service valid',
      run: async () => { const r = await api('POST', '/auth/service', { body: { client_id: 'service-nilai', client_secret: 'rahasia-service-nilai' } }); tokenService = r.data.access_token; },
      hasil: 'allow', subjek: 'service:service-nilai', endpoint: 'POST /auth/service', device: null, alasan: 'token service diterbitkan' },
    { nama: 'POST /transkrip/sinkron token service (diteruskan)',
      run: () => api('POST', '/transkrip/sinkron', { token: tokenService, body: { kelas_id: 1, nilai: [] } }),
      hasil: 'allow', subjek: 'service:service-nilai', endpoint: 'POST /transkrip/sinkron', device: null, alasan: 'token service valid' },
    { nama: 'POST /transkrip/sinkron token dosen',
      run: () => api('POST', '/transkrip/sinkron', { token: dosen1.access_token, device: 'DEV-DOSEN1-01', body: {} }),
      hasil: 'deny', subjek: uDosen1, endpoint: 'POST /transkrip/sinkron', device: 'DEV-DOSEN1-01', alasan: 'role dosen tidak diizinkan' },
    { nama: 'Logout',
      run: () => api('POST', '/auth/logout', { body: { refresh_token: refreshUji } }),
      hasil: 'allow', subjek: uMhs1, endpoint: 'POST /auth/logout', device: null, alasan: 'dicabut' },
    { nama: 'Refresh setelah logout',
      run: () => api('POST', '/auth/refresh', { body: { refresh_token: refreshUji } }),
      hasil: 'deny', subjek: uMhs1, endpoint: 'POST /auth/refresh', device: null, alasan: 'sudah dicabut' },
  ];

  console.log('[Satu request = satu baris audit dengan isi yang benar]');
  for (const k of kasus) {
    const sebelum = maxId();
    await k.run();
    const baru = db.prepare('SELECT * FROM audit_log WHERE id > ? ORDER BY id').all(sebelum);
    const b = baru[0] || {};
    const salah = [];
    if (baru.length !== 1) salah.push(`jumlah baris ${baru.length}, seharusnya 1`);
    if (b.hasil !== k.hasil) salah.push(`hasil=${b.hasil}`);
    if (b.subjek !== k.subjek) salah.push(`subjek=${b.subjek}`);
    if (b.endpoint !== k.endpoint) salah.push(`endpoint=${b.endpoint}`);
    if ((b.device ?? null) !== (k.device ?? null)) salah.push(`device=${b.device}`);
    if (!b.alasan || !b.alasan.includes(k.alasan)) salah.push(`alasan="${b.alasan}"`);
    const t = Date.parse(b.waktu);
    if (Number.isNaN(t) || Math.abs(Date.now() - t) > 60000) salah.push(`waktu=${b.waktu}`);
    cek(k.nama, salah.length === 0, `-> ${salah.join('; ')}`);
  }

  console.log('\n[Rahasia tidak boleh masuk audit log]');
  const semua = JSON.stringify(db.prepare('SELECT * FROM audit_log').all());
  const rahasia = {
    'access token mahasiswa': mhs1.access_token,
    'access token dosen': dosen1.access_token,
    'refresh token': refreshUji,
    'token service': tokenService,
    'password': 'password123',
    'JWT_SECRET': config.jwtSecret,
    'GATEWAY_SECRET': config.gatewaySecret,
  };
  for (const [nama, nilai] of Object.entries(rahasia)) {
    cek(`Audit log tidak memuat ${nama}`, Boolean(nilai) && !semua.includes(nilai));
  }

  console.log(`\nHasil: ${lulus} lulus, ${gagal} gagal\n`);
  db.close();
  process.exit(gagal ? 1 : 0);
})().catch((err) => {
  console.error('Uji gagal dijalankan. Pastikan gateway dan service berjalan:', err.cause?.code || err.message);
  process.exit(1);
});
