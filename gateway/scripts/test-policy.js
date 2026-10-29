// Menguji policy.js langsung (tanpa HTTP). Tidak perlu gateway berjalan.
// Prasyarat: database sudah di-seed.   Jalankan: npm run test:policy
const { decide, dalamJamAkses } = require('../policy');
const { openDb } = require('../../db/db');

const db = openDb();
let lulus = 0;
let gagal = 0;

// ---- helper data dari database (agar tidak bergantung pada ID hardcode) ----
const idUser = (u) => db.prepare('SELECT id FROM users WHERE username = ?').get(u).id;
const roleUser = (u) => db.prepare('SELECT role FROM users WHERE username = ?').get(u).role;
const nimUser = (u) => db.prepare('SELECT nim FROM users WHERE username = ?').get(u).nim;
const deviceUser = (u) =>
  db.prepare('SELECT device_id FROM devices WHERE user_id = ?').get(idUser(u)).device_id;
const kelasDosen = (u) => db.prepare('SELECT id FROM kelas WHERE dosen_id = ?').get(idUser(u)).id;
const nilaiId = (kelasId, nim) =>
  db.prepare('SELECT id FROM nilai WHERE kelas_id = ? AND nim = ?').get(kelasId, nim).id;

const user = (u) => ({ sub: String(idUser(u)), role: roleUser(u) });
const service = { sub: 'service-nilai', role: 'service' };

// Jam dibuat tetap agar hasil uji tidak bergantung pada .env maupun jam komputer
const JAM = { mulai: 7, selesai: 21 };
const SIANG = new Date(2026, 0, 5, 10, 0);
const MALAM = new Date(2026, 0, 5, 23, 30);
const opsi = (now = SIANG) => ({ now, jamAkses: JAM });

const req = (method, path, device, query = {}) => ({ method, path, device, query });

function uji(nama, hasil, harapan) {
  const ok = hasil.allow === harapan;
  ok ? lulus++ : gagal++;
  const label = hasil.allow ? 'ALLOW' : 'DENY ';
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  [${label}] ${nama}`);
  console.log(`                 alasan: ${hasil.reason}`);
}

function ujiBool(nama, nilai, harapan) {
  const ok = nilai === harapan;
  ok ? lulus++ : gagal++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${nama}`);
}

// ---- data uji ----
const k1 = kelasDosen('dosen1');
const k2 = kelasDosen('dosen2');
const nimMhs1 = nimUser('mhs1');
const nimMhs2 = nimUser('mhs2');
const nilaiMhs1K1 = nilaiId(k1, nimMhs1);   // nilai di kelas dosen1
const nilaiMhs1K2 = nilaiId(k2, nimMhs1);   // nilai di kelas dosen2

console.log('[Jam akses 07:00-21:00]');
ujiBool('06:59 di luar', dalamJamAkses(new Date(2026, 0, 5, 6, 59), JAM), false);
ujiBool('07:00 masuk', dalamJamAkses(new Date(2026, 0, 5, 7, 0), JAM), true);
ujiBool('20:59 masuk', dalamJamAkses(new Date(2026, 0, 5, 20, 59), JAM), true);
ujiBool('21:00 di luar', dalamJamAkses(new Date(2026, 0, 5, 21, 0), JAM), false);
ujiBool('rentang lintas tengah malam 22-06, jam 23:00 masuk',
  dalamJamAkses(new Date(2026, 0, 5, 23, 0), { mulai: 22, selesai: 6 }), true);
ujiBool('rentang lintas tengah malam 22-06, jam 12:00 di luar',
  dalamJamAkses(new Date(2026, 0, 5, 12, 0), { mulai: 22, selesai: 6 }), false);
ujiBool('konfigurasi rusak (NaN) -> di luar jam (fail closed)',
  dalamJamAkses(SIANG, { mulai: NaN, selesai: NaN }), false);

console.log('\n[Default deny dan path]');
uji('endpoint tidak dikenal',
  decide(user('admin'), req('GET', '/admin', deviceUser('admin')), opsi()), false);
uji('path berisi %2e (encoding)',
  decide(user('mhs1'), req('GET', '/nilai/%2e%2e', deviceUser('mhs1')), opsi()), false);
uji('path dengan trailing slash',
  decide(user('mhs1'), req('GET', '/nilai/', deviceUser('mhs1')), opsi()), false);
uji('method HEAD tidak punya aturan',
  decide(user('mhs1'), req('HEAD', '/nilai', deviceUser('mhs1')), opsi()), false);
uji('role tidak dikenal',
  decide({ sub: '1', role: 'superuser' }, req('GET', '/nilai', 'x'), opsi()), false);
uji('subjek kosong', decide(null, req('GET', '/nilai', 'x'), opsi()), false);

console.log('\n[Device dan identitas]');
uji('device terdaftar',
  decide(user('mhs1'), req('GET', '/nilai', deviceUser('mhs1')), opsi()), true);
uji('device tidak terdaftar',
  decide(user('mhs1'), req('GET', '/nilai', 'DEV-ASING-99'), opsi()), false);
uji('device milik user lain',
  decide(user('mhs1'), req('GET', '/nilai', deviceUser('dosen1')), opsi()), false);
uji('tanpa X-Device-ID',
  decide(user('mhs1'), req('GET', '/nilai', null), opsi()), false);
uji('user pada token tidak ada di database',
  decide({ sub: '9999', role: 'mahasiswa' }, req('GET', '/nilai', 'x'), opsi()), false);
uji('role token dipalsukan (mahasiswa mengaku admin)',
  decide({ sub: String(idUser('mhs1')), role: 'admin' },
    req('GET', `/transkrip/${nimMhs2}`, deviceUser('mhs1')), opsi()), false);

console.log('\n[GET /nilai]');
uji('mahasiswa tanpa filter',
  decide(user('mhs1'), req('GET', '/nilai', deviceUser('mhs1')), opsi()), true);
uji('mahasiswa ?nim= miliknya',
  decide(user('mhs1'), req('GET', '/nilai', deviceUser('mhs1'), { nim: nimMhs1 }), opsi()), true);
uji('mahasiswa ?nim= milik orang lain',
  decide(user('mhs1'), req('GET', '/nilai', deviceUser('mhs1'), { nim: nimMhs2 }), opsi()), false);
uji('mahasiswa ?nim= ganda (array)',
  decide(user('mhs1'), req('GET', '/nilai', deviceUser('mhs1'), { nim: [nimMhs1, nimMhs2] }), opsi()), false);
uji('dosen1 ?kelas_id= kelasnya',
  decide(user('dosen1'), req('GET', '/nilai', deviceUser('dosen1'), { kelas_id: String(k1) }), opsi()), true);
uji('dosen1 ?kelas_id= kelas dosen2',
  decide(user('dosen1'), req('GET', '/nilai', deviceUser('dosen1'), { kelas_id: String(k2) }), opsi()), false);
uji('dosen1 tanpa filter',
  decide(user('dosen1'), req('GET', '/nilai', deviceUser('dosen1')), opsi()), true);
uji('dosen1 ?kelas_id=abc',
  decide(user('dosen1'), req('GET', '/nilai', deviceUser('dosen1'), { kelas_id: 'abc' }), opsi()), false);
uji('admin tidak boleh GET /nilai',
  decide(user('admin'), req('GET', '/nilai', deviceUser('admin')), opsi()), false);

console.log('\n[PUT /nilai/:id]');
uji('dosen1 ubah nilai kelasnya, siang',
  decide(user('dosen1'), req('PUT', `/nilai/${nilaiMhs1K1}`, deviceUser('dosen1')), opsi()), true);
uji('dosen1 ubah nilai kelas dosen2',
  decide(user('dosen1'), req('PUT', `/nilai/${nilaiMhs1K2}`, deviceUser('dosen1')), opsi()), false);
uji('dosen2 ubah nilai kelas dosen1',
  decide(user('dosen2'), req('PUT', `/nilai/${nilaiMhs1K1}`, deviceUser('dosen2')), opsi()), false);
uji('mahasiswa ubah nilai',
  decide(user('mhs1'), req('PUT', `/nilai/${nilaiMhs1K1}`, deviceUser('mhs1')), opsi()), false);
uji('dosen1 ubah nilai di luar jam akses',
  decide(user('dosen1'), req('PUT', `/nilai/${nilaiMhs1K1}`, deviceUser('dosen1')), opsi(MALAM)), false);
uji('nilai tidak ada',
  decide(user('dosen1'), req('PUT', '/nilai/99999', deviceUser('dosen1')), opsi()), false);

// Simulasi nilai sudah final (dikembalikan lagi setelah uji)
db.prepare('UPDATE nilai SET status_final = 1 WHERE id = ?').run(nilaiMhs1K1);
try {
  uji('dosen1 ubah nilai yang sudah final',
    decide(user('dosen1'), req('PUT', `/nilai/${nilaiMhs1K1}`, deviceUser('dosen1')), opsi()), false);
} finally {
  db.prepare('UPDATE nilai SET status_final = 0 WHERE id = ?').run(nilaiMhs1K1);
}

console.log('\n[POST /kelas/:id/finalisasi]');
uji('dosen1 finalisasi kelasnya, siang',
  decide(user('dosen1'), req('POST', `/kelas/${k1}/finalisasi`, deviceUser('dosen1')), opsi()), true);
uji('dosen1 finalisasi kelas dosen2',
  decide(user('dosen1'), req('POST', `/kelas/${k2}/finalisasi`, deviceUser('dosen1')), opsi()), false);
uji('dosen1 finalisasi di luar jam akses',
  decide(user('dosen1'), req('POST', `/kelas/${k1}/finalisasi`, deviceUser('dosen1')), opsi(MALAM)), false);
uji('mahasiswa finalisasi',
  decide(user('mhs1'), req('POST', `/kelas/${k1}/finalisasi`, deviceUser('mhs1')), opsi()), false);

console.log('\n[GET /transkrip/:nim]');
uji('mahasiswa transkrip sendiri',
  decide(user('mhs1'), req('GET', `/transkrip/${nimMhs1}`, deviceUser('mhs1')), opsi()), true);
uji('mahasiswa transkrip orang lain',
  decide(user('mhs1'), req('GET', `/transkrip/${nimMhs2}`, deviceUser('mhs1')), opsi()), false);
uji('admin transkrip semua NIM',
  decide(user('admin'), req('GET', `/transkrip/${nimMhs2}`, deviceUser('admin')), opsi()), true);
uji('dosen tidak boleh melihat transkrip',
  decide(user('dosen1'), req('GET', `/transkrip/${nimMhs1}`, deviceUser('dosen1')), opsi()), false);

console.log('\n[POST /transkrip/sinkron]');
uji('token service (tanpa device)',
  decide(service, req('POST', '/transkrip/sinkron', null), opsi()), true);
uji('token user dosen ditolak',
  decide(user('dosen1'), req('POST', '/transkrip/sinkron', deviceUser('dosen1')), opsi()), false);
uji('token user admin ditolak',
  decide(user('admin'), req('POST', '/transkrip/sinkron', deviceUser('admin')), opsi()), false);
uji('service dengan client_id tidak terdaftar',
  decide({ sub: 'service-palsu', role: 'service' }, req('POST', '/transkrip/sinkron', null), opsi()), false);
uji('token service tidak boleh GET /nilai',
  decide(service, req('GET', '/nilai', null), opsi()), false);
uji('token service tidak boleh finalisasi',
  decide(service, req('POST', `/kelas/${k1}/finalisasi`, null), opsi()), false);

console.log(`\nHasil: ${lulus} lulus, ${gagal} gagal`);
db.close();
process.exit(gagal ? 1 : 0);
