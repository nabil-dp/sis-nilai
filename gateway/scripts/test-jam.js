// Menguji kontrol jam akses (4.3) pada gateway yang sedang berjalan.
// Skrip membaca JAM_MULAI/JAM_SELESAI dari gateway/.env lalu menyesuaikan harapan:
//
//   - di luar jam akses : PUT nilai dan finalisasi harus 403 ("di luar jam akses"),
//                         sedangkan GET tetap boleh
//   - dalam jam akses   : PUT nilai (dengan nilai yang sama, tanpa mengubah data) -> 200
//
// Cara pakai (jalankan dua kali):
//   1. JAM_MULAI=0  JAM_SELESAI=0   -> restart gateway -> npm run test:jam   (ditutup)
//   2. JAM_MULAI=0  JAM_SELESAI=24  -> restart gateway -> npm run test:jam   (dibuka)
const { dalamJamAkses } = require('../policy');
const config = require('../config');
const { openDb } = require('../../db/db');

const BASE = process.env.GATEWAY_URL || 'http://localhost:3000';
const db = openDb();
let lulus = 0;
let gagal = 0;
let dilewati = 0;

function cek(nama, kondisi, info = '') {
  if (kondisi) { lulus++; console.log(`  PASS  ${nama}`); }
  else { gagal++; console.log(`  FAIL  ${nama} ${info}`); }
}
function lewati(nama, alasan) { dilewati++; console.log(`  SKIP  ${nama} (${alasan})`); }

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

async function login(username, device) {
  const r = await api('POST', '/auth/login', { body: { username, password: 'password123' }, device });
  if (r.status !== 200) throw new Error(`Login ${username} gagal (status ${r.status}). Sudah di-seed?`);
  return r.data.access_token;
}

const auditTerakhir = () => db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 1').get();

(async () => {
  const buka = dalamJamAkses();
  const { mulai, selesai } = config.jamAkses;
  const sekarang = new Date().toTimeString().slice(0, 5);
  console.log(`Jam akses di .env: ${mulai}:00-${selesai}:00, sekarang ${sekarang} -> ${buka ? 'DALAM' : 'DI LUAR'} jam akses`);
  console.log('(Jika hasil tidak sesuai, pastikan gateway sudah di-restart setelah mengubah .env)\n');

  // Cari satu nilai milik dosen (utamakan yang belum final)
  const kandidat = [];
  for (const [u, dev] of [['dosen1', 'DEV-DOSEN1-01'], ['dosen2', 'DEV-DOSEN2-01']]) {
    const token = await login(u, dev);
    const r = await api('GET', '/nilai', { token, device: dev });
    cek(`${u} GET /nilai tetap 200 (membaca tidak dibatasi jam)`, r.status === 200, `(status ${r.status})`);
    for (const baris of r.data?.data || []) kandidat.push({ u, dev, token, baris });
  }
  const target = kandidat.find((k) => !k.baris.final) || kandidat[0];
  if (!target) throw new Error('Tidak ada data nilai. Jalankan seed.');

  console.log(buka ? '\n[Dalam jam akses]' : '\n[Di luar jam akses]');
  const { u, dev, token, baris } = target;

  // PUT dengan nilai yang sama: tidak mengubah data walaupun diizinkan
  let r = await api('PUT', `/nilai/${baris.id}`, { token, device: dev, body: { nilai: baris.nilai } });
  const barisAudit = auditTerakhir();

  if (!buka) {
    cek('PUT /nilai/:id ditolak -> 403', r.status === 403, `(status ${r.status})`);
    cek('Audit log mencatat alasan "di luar jam akses"',
      barisAudit.hasil === 'deny' && barisAudit.alasan.includes('di luar jam akses'), `(${barisAudit.alasan})`);

    r = await api('POST', `/kelas/${baris.kelas_id}/finalisasi`, { token, device: dev });
    cek('POST /kelas/:id/finalisasi ditolak -> 403', r.status === 403, `(status ${r.status})`);
    cek('Audit log mencatat alasan "di luar jam akses"',
      auditTerakhir().hasil === 'deny' && auditTerakhir().alasan.includes('di luar jam akses'), `(${auditTerakhir().alasan})`);
  } else if (baris.final) {
    lewati('PUT /nilai/:id dalam jam akses', `semua nilai ${u} sudah final; jalankan seed ulang`);
  } else {
    cek('PUT /nilai/:id diizinkan -> 200', r.status === 200, `(status ${r.status})`);
    cek('Audit log mencatat allow', barisAudit.hasil === 'allow', `(${barisAudit.hasil}: ${barisAudit.alasan})`);
    lewati('Finalisasi dalam jam akses', 'mengubah data; dicakup oleh npm run test:e2e');
  }

  // Endpoint tanpa batas jam tidak terpengaruh
  const tAdmin = await login('admin', 'DEV-ADMIN-01');
  r = await api('GET', '/transkrip/2210001', { token: tAdmin, device: 'DEV-ADMIN-01' });
  cek('GET /transkrip/:nim (admin) tidak dipengaruhi jam akses', r.status === 200, `(status ${r.status})`);

  console.log(`\nHasil: ${lulus} lulus, ${gagal} gagal, ${dilewati} dilewati\n`);
  db.close();
  process.exit(gagal ? 1 : 0);
})().catch((err) => {
  console.error('Uji gagal dijalankan:', err.cause?.code || err.message);
  process.exit(1);
});
