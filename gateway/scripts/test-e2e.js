// Uji end-to-end: gateway (3000) + Service Nilai (3001) + Service Transkrip (3002).
//
// Prasyarat:
//   - database sudah di-seed (npm run seed di folder db)
//   - ketiga proses berjalan
//   - jam akses saat ini diizinkan di gateway/.env (mis. JAM_MULAI=0, JAM_SELESAI=24),
//     karena uji mengubah dan memfinalisasi nilai
//
// PERHATIAN: di awal, skrip mereset status final semua nilai dan MENGHAPUS isi tabel
// transkrip agar bisa dijalankan berulang. Jalankan hanya pada database latihan.
//
// Jalankan: npm run test:e2e
const jwt = require('jsonwebtoken');
const config = require('../config');
const { dalamJamAkses } = require('../policy');
const { openDb } = require('../../db/db');

const GW = process.env.GATEWAY_URL || 'http://localhost:3000';
const NILAI = config.nilaiUrl;
const TRANSKRIP = config.transkripUrl;

let lulus = 0;
let gagal = 0;

function cek(nama, kondisi, info = '') {
  if (kondisi) { lulus++; console.log(`  PASS  ${nama}`); }
  else { gagal++; console.log(`  FAIL  ${nama} ${info}`); }
}

async function kirim(base, method, path, { token, device, secret, body } = {}) {
  const h = {};
  if (token) h.Authorization = `Bearer ${token}`;
  if (device) h['X-Device-ID'] = device;
  if (secret) h['X-Gateway-Secret'] = secret;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(base + path, {
    method,
    headers: h,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* body kosong */ }
  return { status: res.status, data };
}

const gw = (method, path, opsi) => kirim(GW, method, path, opsi);
// Langsung ke service dengan gateway secret yang benar (mensimulasikan gateway yang dilewati)
const langsung = (base, method, path, opsi) =>
  kirim(base, method, path, { secret: config.gatewaySecret, ...opsi });

async function login(username, device) {
  const r = await gw('POST', '/auth/login', { body: { username, password: 'password123' }, device });
  if (r.status !== 200) throw new Error(`Login ${username} gagal (status ${r.status}). Sudah di-seed?`);
  return r.data.access_token;
}

(async () => {
  if (!dalamJamAkses()) {
    console.error(
      'Saat ini di luar jam akses gateway. Set JAM_MULAI=0 dan JAM_SELESAI=24 di gateway/.env,\n' +
      'restart gateway, lalu jalankan ulang uji ini.'
    );
    process.exit(1);
  }

  // Reset state agar uji bisa diulang
  const db = openDb();
  db.prepare('UPDATE nilai SET status_final = 0').run();
  db.prepare('DELETE FROM transkrip').run();

  const idDosen = (u) => db.prepare('SELECT id FROM users WHERE username = ?').get(u).id;
  const k1 = db.prepare('SELECT id FROM kelas WHERE dosen_id = ?').get(idDosen('dosen1')).id;
  const k2 = db.prepare('SELECT id FROM kelas WHERE dosen_id = ?').get(idDosen('dosen2')).id;
  const nilaiId = (k, nim) => db.prepare('SELECT id FROM nilai WHERE kelas_id = ? AND nim = ?').get(k, nim).id;
  const nilaiMhs1K1 = nilaiId(k1, '2210001');
  const nilaiMhs1K2 = nilaiId(k2, '2210001');

  const tMhs1 = await login('mhs1', 'DEV-MHS1-01');
  const tDosen1 = await login('dosen1', 'DEV-DOSEN1-01');
  const tDosen2 = await login('dosen2', 'DEV-DOSEN2-01');
  const tAdmin = await login('admin', 'DEV-ADMIN-01');
  const D = { mhs1: 'DEV-MHS1-01', dosen1: 'DEV-DOSEN1-01', dosen2: 'DEV-DOSEN2-01', admin: 'DEV-ADMIN-01' };
  let r;

  // ---------------------------------------------------------------
  console.log('[Akses langsung ke service (melewati gateway)]');
  r = await kirim(NILAI, 'GET', '/nilai');
  cek('Service Nilai tanpa secret dan token -> 403', r.status === 403, `(status ${r.status})`);

  r = await kirim(TRANSKRIP, 'GET', '/transkrip/2210001');
  cek('Service Transkrip tanpa secret dan token -> 403', r.status === 403, `(status ${r.status})`);

  r = await kirim(NILAI, 'GET', '/nilai', { token: tMhs1 });
  cek('Token valid tanpa gateway secret -> 403', r.status === 403, `(status ${r.status})`);

  r = await kirim(NILAI, 'GET', '/nilai', { token: tMhs1, secret: 'secret-yang-salah' });
  cek('Gateway secret salah -> 403', r.status === 403, `(status ${r.status})`);

  r = await kirim(NILAI, 'GET', '/nilai', { secret: config.gatewaySecret });
  cek('Gateway secret benar tanpa token -> 401', r.status === 401, `(status ${r.status})`);

  const kedaluwarsa = jwt.sign(
    { sub: '4', role: 'mahasiswa', exp: Math.floor(Date.now() / 1000) - 60 },
    config.jwtSecret, { algorithm: 'HS256', issuer: 'sistem-nilai-gateway' }
  );
  r = await langsung(NILAI, 'GET', '/nilai', { token: kedaluwarsa });
  cek('Gateway secret benar + token kedaluwarsa -> 401', r.status === 401, `(status ${r.status})`);

  const kunciLain = jwt.sign(
    { sub: '4', role: 'mahasiswa' }, 'kunci-lain-yang-salah-0123456789abcdef',
    { algorithm: 'HS256', expiresIn: '10m', issuer: 'sistem-nilai-gateway' }
  );
  r = await langsung(NILAI, 'GET', '/nilai', { token: kunciLain });
  cek('Gateway secret benar + tanda tangan salah -> 401', r.status === 401, `(status ${r.status})`);

  // ---------------------------------------------------------------
  console.log('\n[Mahasiswa]');
  r = await gw('GET', '/nilai', { token: tMhs1, device: D.mhs1 });
  cek('mhs1 melihat nilai -> 200', r.status === 200, `(status ${r.status})`);
  cek('Hanya nilai milik mhs1 (2 baris, NIM 2210001)',
    r.data?.jumlah === 2 && r.data.data.every((x) => x.nim === '2210001'));

  r = await gw('GET', '/transkrip/2210001', { token: tMhs1, device: D.mhs1 });
  cek('mhs1 melihat transkrip sendiri -> 200 (masih kosong)',
    r.status === 200 && r.data?.jumlah_mk === 0, `(status ${r.status})`);

  r = await gw('GET', '/transkrip/2210002', { token: tMhs1, device: D.mhs1 });
  cek('mhs1 melihat transkrip mhs2 -> 403', r.status === 403, `(status ${r.status})`);

  r = await gw('PUT', `/nilai/${nilaiMhs1K1}`, { token: tMhs1, device: D.mhs1, body: { nilai: 100 } });
  cek('mhs1 mengubah nilai -> 403', r.status === 403, `(status ${r.status})`);

  // ---------------------------------------------------------------
  console.log('\n[Dosen: melihat dan mengubah nilai]');
  r = await gw('GET', '/nilai', { token: tDosen1, device: D.dosen1 });
  cek('dosen1 melihat nilai -> hanya kelasnya (3 baris)',
    r.status === 200 && r.data?.jumlah === 3 && r.data.data.every((x) => x.kelas_id === k1), `(status ${r.status})`);

  r = await gw('GET', '/nilai', { token: tDosen2, device: D.dosen2 });
  cek('dosen2 melihat nilai -> hanya kelasnya (3 baris)',
    r.status === 200 && r.data?.jumlah === 3 && r.data.data.every((x) => x.kelas_id === k2), `(status ${r.status})`);

  r = await gw('GET', `/nilai?kelas_id=${k2}`, { token: tDosen1, device: D.dosen1 });
  cek('dosen1 meminta kelas dosen2 -> 403', r.status === 403, `(status ${r.status})`);

  r = await gw('PUT', `/nilai/${nilaiMhs1K1}`, { token: tDosen1, device: D.dosen1, body: { nilai: 95 } });
  cek('dosen1 mengubah nilai kelasnya -> 200', r.status === 200, `(status ${r.status})`);

  r = await gw('GET', `/nilai?kelas_id=${k1}`, { token: tDosen1, device: D.dosen1 });
  cek('Nilai baru (95) tersimpan', r.data?.data?.find((x) => x.nim === '2210001')?.nilai === 95);

  r = await gw('PUT', `/nilai/${nilaiMhs1K1}`, { token: tDosen1, device: D.dosen1, body: { nilai: 150 } });
  cek('Nilai 150 (di luar 0-100) -> 400', r.status === 400, `(status ${r.status})`);

  r = await gw('PUT', `/nilai/${nilaiMhs1K1}`, { token: tDosen1, device: D.dosen1, body: { nilai: 'abc' } });
  cek('Nilai bukan angka -> 400', r.status === 400, `(status ${r.status})`);

  r = await gw('PUT', `/nilai/${nilaiMhs1K1}`, { token: tDosen2, device: D.dosen2, body: { nilai: 10 } });
  cek('dosen2 mengubah nilai kelas dosen1 -> 403', r.status === 403, `(status ${r.status})`);

  r = await gw('PUT', `/nilai/${nilaiMhs1K2}`, { token: tDosen1, device: D.dosen1, body: { nilai: 10 } });
  cek('dosen1 mengubah nilai kelas dosen2 -> 403', r.status === 403, `(status ${r.status})`);

  // Pertahanan lapis ketiga: service tetap memeriksa kepemilikan walau gateway dilewati
  r = await langsung(NILAI, 'PUT', `/nilai/${nilaiMhs1K1}`, { token: tDosen2, body: { nilai: 10 } });
  cek('(langsung ke service) dosen2 ubah nilai kelas dosen1 -> 403', r.status === 403, `(status ${r.status})`);

  // ---------------------------------------------------------------
  console.log('\n[Finalisasi dan sinkron ke transkrip]');
  r = await gw('POST', `/kelas/${k1}/finalisasi`, { token: tDosen2, device: D.dosen2 });
  cek('dosen2 memfinalisasi kelas dosen1 -> 403', r.status === 403, `(status ${r.status})`);

  r = await gw('POST', `/kelas/${k1}/finalisasi`, { token: tMhs1, device: D.mhs1 });
  cek('mahasiswa memfinalisasi -> 403', r.status === 403, `(status ${r.status})`);

  r = await gw('POST', `/kelas/${k1}/finalisasi`, { token: tDosen1, device: D.dosen1 });
  cek('dosen1 memfinalisasi kelasnya -> 200', r.status === 200, `(status ${r.status}, ${JSON.stringify(r.data)})`);
  cek('Respons memuat hasil sinkron (3 data)', r.data?.sinkron?.jumlah === 3 && r.data?.jumlah_nilai === 3);

  const final = db.prepare('SELECT COUNT(*) AS c FROM nilai WHERE kelas_id = ? AND status_final = 1').get(k1).c;
  cek('Semua nilai kelas 1 berstatus final di database', final === 3, `(final: ${final})`);
  const kelas2Final = db.prepare('SELECT COUNT(*) AS c FROM nilai WHERE kelas_id = ? AND status_final = 1').get(k2).c;
  cek('Kelas dosen2 tidak ikut final', kelas2Final === 0, `(final: ${kelas2Final})`);

  r = await gw('GET', '/transkrip/2210001', { token: tMhs1, device: D.mhs1 });
  const entri = r.data?.transkrip?.find((x) => x.kelas_id === k1);
  cek('mhs1 melihat transkripnya terisi (kelas 1, nilai 95)',
    r.status === 200 && r.data?.jumlah_mk === 1 && entri?.nilai === 95, `(status ${r.status})`);

  r = await gw('GET', '/transkrip/2210002', { token: tAdmin, device: D.admin });
  cek('admin melihat transkrip mhs2 -> 200 (1 mata kuliah)',
    r.status === 200 && r.data?.jumlah_mk === 1, `(status ${r.status})`);

  r = await gw('PUT', `/nilai/${nilaiMhs1K1}`, { token: tDosen1, device: D.dosen1, body: { nilai: 50 } });
  cek('Ubah nilai yang sudah final (via gateway) -> 403', r.status === 403, `(status ${r.status})`);

  r = await langsung(NILAI, 'PUT', `/nilai/${nilaiMhs1K1}`, { token: tDosen1, body: { nilai: 50 } });
  cek('(langsung ke service) ubah nilai final -> 409', r.status === 409, `(status ${r.status})`);

  r = await gw('POST', `/kelas/${k1}/finalisasi`, { token: tDosen1, device: D.dosen1 });
  cek('Finalisasi ulang bersifat idempotent -> 200', r.status === 200, `(status ${r.status})`);

  const jumlahTranskrip = db.prepare('SELECT COUNT(*) AS c FROM transkrip').get().c;
  cek('Tidak ada data transkrip ganda (3 baris)', jumlahTranskrip === 3, `(baris: ${jumlahTranskrip})`);

  // ---------------------------------------------------------------
  console.log('\n[/transkrip/sinkron hanya untuk token service]');
  const body = { kelas_id: k1, nilai: [{ nim: '2210001', nilai: 1 }] };
  r = await gw('POST', '/transkrip/sinkron', { token: tDosen1, device: D.dosen1, body });
  cek('Token dosen via gateway -> 403', r.status === 403, `(status ${r.status})`);

  r = await gw('POST', '/transkrip/sinkron', { token: tAdmin, device: D.admin, body });
  cek('Token admin via gateway -> 403', r.status === 403, `(status ${r.status})`);

  r = await langsung(TRANSKRIP, 'POST', '/transkrip/sinkron', { token: tDosen1, body });
  cek('(langsung ke service) token dosen -> 403', r.status === 403, `(status ${r.status})`);

  const nilaiTranskrip = db.prepare('SELECT nilai FROM transkrip WHERE nim = ? AND kelas_id = ?').get('2210001', k1).nilai;
  cek('Transkrip tidak berubah oleh percobaan di atas (tetap 95)', nilaiTranskrip === 95, `(nilai: ${nilaiTranskrip})`);

  console.log(`\nHasil: ${lulus} lulus, ${gagal} gagal\n`);

  console.log('Audit log terakhir:');
  console.table(
    db.prepare(
      'SELECT waktu, subjek, endpoint, device, hasil, alasan FROM audit_log ORDER BY id DESC LIMIT 15'
    ).all()
  );
  db.close();
  process.exit(gagal ? 1 : 0);
})().catch((err) => {
  console.error('Uji gagal dijalankan. Pastikan gateway, service-nilai, dan service-transkrip berjalan.');
  console.error(err.cause?.code || err.message);
  process.exit(1);
});
