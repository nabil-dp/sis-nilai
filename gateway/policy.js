/**
 * Policy Engine / Policy Administrator (PE/PA) - NIST SP 800-207
 *
 * decide(subject, request, opsi) -> { allow: boolean, reason: string }
 *
 *  subject : payload JWT yang SUDAH diverifikasi gateway, minimal { sub, role }
 *            - user    : sub = id user (string), role = mahasiswa | dosen | admin
 *            - service : sub = client_id,        role = service
 *  request : { method, path, query, device }
 *            path = path saja (tanpa query string), query = objek hasil parse
 *  opsi    : (opsional, untuk pengujian) { now: Date, jamAkses: { mulai, selesai } }
 *
 * Prinsip: default deny, dan keputusan memakai atribut dari database
 * (bukan hanya isi token).
 *
 * Urutan evaluasi (murah -> mahal, semua harus lolos):
 *   1. subjek valid dan path normal
 *   2. ada aturan untuk method + path (jika tidak: deny)
 *   3. role diizinkan untuk aturan tersebut
 *   4. identitas cocok dengan database (user/client ada, role sama)
 *   5. device terdaftar (khusus user)
 *   6. jam akses (khusus aturan yang mensyaratkan)
 *   7. atribut data: kepemilikan kelas/NIM, status final
 */
const config = require('./config');
const db = require('./database');

const ROLES = ['mahasiswa', 'dosen', 'admin', 'service'];

const q = {
  userById: db.prepare('SELECT id, role, nim FROM users WHERE id = ?'),
  deviceOfUser: db.prepare('SELECT 1 FROM devices WHERE user_id = ? AND device_id = ?'),
  clientById: db.prepare('SELECT 1 FROM service_clients WHERE client_id = ?'),
  kelasById: db.prepare('SELECT id, dosen_id FROM kelas WHERE id = ?'),
  nilaiDenganKelas: db.prepare(`
    SELECT n.id, n.status_final, k.dosen_id
    FROM nilai n JOIN kelas k ON k.id = n.kelas_id
    WHERE n.id = ?
  `),
};

const allow = (reason) => ({ allow: true, reason });
const deny = (reason) => ({ allow: false, reason });
const pad = (n) => String(n).padStart(2, '0');

// ---------------------------------------------------------------
// Konteks: jam akses (4.3). Gagal-tertutup: konfigurasi rusak -> di luar jam.
// Mendukung rentang lintas tengah malam (mulai > selesai).
// ---------------------------------------------------------------
function dalamJamAkses(now = new Date(), jam = config.jamAkses) {
  const menit = now.getHours() * 60 + now.getMinutes();
  const mulai = Number(jam.mulai) * 60;
  const selesai = Number(jam.selesai) * 60;
  if (mulai <= selesai) return menit >= mulai && menit < selesai;
  return menit >= mulai || menit < selesai;
}

// ---------------------------------------------------------------
// Aturan atribut per endpoint (Tabel 3)
// ---------------------------------------------------------------

// GET /nilai
//  - mahasiswa: hanya nilai miliknya (jika ada ?nim=, harus NIM sendiri)
//  - dosen    : jika ada ?kelas_id=, kelas itu harus diampunya
function cekLihatNilai({ user, query }) {
  if (user.role === 'mahasiswa') {
    // query.nim bisa berupa array (?nim=a&nim=b) -> !== string -> ditolak
    if (query.nim !== undefined && query.nim !== user.nim) {
      return deny('mahasiswa hanya boleh melihat nilai miliknya sendiri');
    }
    return allow(`mahasiswa melihat nilai miliknya (NIM ${user.nim})`);
  }

  // dosen
  if (query.kelas_id !== undefined) {
    if (typeof query.kelas_id !== 'string' || !/^\d+$/.test(query.kelas_id)) {
      return deny('parameter kelas_id tidak valid');
    }
    const kelas = q.kelasById.get(Number(query.kelas_id));
    if (!kelas) return deny(`kelas ${query.kelas_id} tidak ditemukan`);
    if (kelas.dosen_id !== user.id) return deny(`dosen bukan pengampu kelas ${kelas.id}`);
    return allow(`dosen pengampu melihat nilai kelas ${kelas.id}`);
  }
  // Tanpa kelas_id: Service Nilai wajib membatasi hasil ke kelas yang diampu (Tahap 5)
  return allow('dosen melihat nilai (hasil dibatasi ke kelas yang diampu)');
}

// PUT /nilai/:id -> dosen pengampu, nilai belum final (jam akses dicek sebelumnya)
function cekUbahNilai({ user, params }) {
  const row = q.nilaiDenganKelas.get(Number(params[0]));
  if (!row) return deny(`nilai ${params[0]} tidak ditemukan`);
  if (row.dosen_id !== user.id) return deny('dosen bukan pengampu kelas dari nilai ini');
  if (row.status_final === 1) return deny('nilai sudah final dan tidak boleh diubah');
  return allow('dosen pengampu, nilai belum final, dalam jam akses');
}

// POST /kelas/:id/finalisasi -> dosen pengampu (jam akses dicek sebelumnya)
function cekFinalisasi({ user, params }) {
  const kelas = q.kelasById.get(Number(params[0]));
  if (!kelas) return deny(`kelas ${params[0]} tidak ditemukan`);
  if (kelas.dosen_id !== user.id) return deny('dosen bukan pengampu kelas ini');
  return allow(`dosen pengampu memfinalisasi kelas ${kelas.id}, dalam jam akses`);
}

// GET /transkrip/:nim -> mahasiswa hanya NIM sendiri, admin semua
function cekLihatTranskrip({ user, params }) {
  if (user.role === 'admin') return allow('admin boleh melihat transkrip semua NIM');
  if (params[0] !== user.nim) return deny('mahasiswa hanya boleh melihat transkrip miliknya sendiri');
  return allow(`mahasiswa melihat transkrip miliknya (NIM ${user.nim})`);
}

// ---------------------------------------------------------------
// Tabel aturan. Endpoint yang tidak ada di sini otomatis ditolak (default deny).
// Catatan: /auth/* ditangani langsung gateway (auth.routes.js), bukan di sini.
// ---------------------------------------------------------------
const RULES = [
  { nama: 'GET /nilai', method: 'GET', pattern: /^\/nilai$/,
    roles: ['mahasiswa', 'dosen'], jam: false, cek: cekLihatNilai },
  { nama: 'PUT /nilai/:id', method: 'PUT', pattern: /^\/nilai\/(\d+)$/,
    roles: ['dosen'], jam: true, cek: cekUbahNilai },
  { nama: 'POST /kelas/:id/finalisasi', method: 'POST', pattern: /^\/kelas\/(\d+)\/finalisasi$/,
    roles: ['dosen'], jam: true, cek: cekFinalisasi },
  { nama: 'GET /transkrip/:nim', method: 'GET', pattern: /^\/transkrip\/([A-Za-z0-9_-]+)$/,
    roles: ['mahasiswa', 'admin'], jam: false, cek: cekLihatTranskrip },
  { nama: 'POST /transkrip/sinkron', method: 'POST', pattern: /^\/transkrip\/sinkron$/,
    roles: ['service'], jam: false, cek: () => allow('token service valid untuk sinkron transkrip') },
];

// Hanya huruf, angka, "-", "_" dan "/" tunggal tanpa trailing slash.
// Menolak "%", "..", "//", "." agar policy dan service tidak membaca path berbeda.
function pathNormal(path) {
  return path.length <= 200 && /^\/[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/.test(path);
}

function cariAturan(method, path) {
  for (const rule of RULES) {
    if (rule.method !== method) continue;
    const m = rule.pattern.exec(path);
    if (m) return { rule, params: m.slice(1) };
  }
  return null;
}

// Label subjek untuk audit log: "user:<id>", "service:<client_id>", atau "anonymous"
function labelSubjek(subject) {
  if (!subject || typeof subject !== 'object' || subject.sub === undefined) return 'anonymous';
  return subject.role === 'service' ? `service:${subject.sub}` : `user:${subject.sub}`;
}

// ---------------------------------------------------------------
// Keputusan akhir
// ---------------------------------------------------------------
function decide(subject, request, opsi = {}) {
  const { method, path, query = {}, device = null } = request || {};
  const now = opsi.now || new Date();
  const jam = opsi.jamAkses || config.jamAkses;

  // 1. Subjek dan path
  if (!subject || typeof subject !== 'object' || !ROLES.includes(subject.role)) {
    return deny('subjek tidak valid atau role tidak dikenal');
  }
  if (typeof path !== 'string' || !pathNormal(path)) {
    return deny('path tidak normal (default deny)');
  }

  // 2. Aturan untuk method + path (HEAD, OPTIONS, dst. otomatis tidak punya aturan)
  const cocok = cariAturan(method, path);
  if (!cocok) return deny(`tidak ada kebijakan untuk ${method} ${path} (default deny)`);
  const { rule, params } = cocok;

  // 3. Role
  if (!rule.roles.includes(subject.role)) {
    return deny(`role ${subject.role} tidak diizinkan untuk ${rule.nama}`);
  }

  // 4 + 5. Identitas dari database, lalu device
  let user = null;
  if (subject.role === 'service') {
    if (!q.clientById.get(String(subject.sub))) {
      return deny(`client service "${subject.sub}" tidak terdaftar`);
    }
  } else {
    const userId = Number(subject.sub);
    user = Number.isInteger(userId) ? q.userById.get(userId) : undefined;
    if (!user) return deny('user pada token tidak ditemukan di database');
    if (user.role !== subject.role) {
      return deny(`role pada token (${subject.role}) tidak sama dengan database (${user.role})`);
    }
    if (!device) return deny('header X-Device-ID tidak ada');
    if (!q.deviceOfUser.get(user.id, device)) {
      return deny('device tidak terdaftar untuk user ini');
    }
  }

  // 6. Jam akses
  if (rule.jam && !dalamJamAkses(now, jam)) {
    return deny(
      `di luar jam akses (sekarang ${pad(now.getHours())}:${pad(now.getMinutes())}, ` +
      `diizinkan ${pad(jam.mulai)}:00-${pad(jam.selesai)}:00)`
    );
  }

  // 7. Atribut data (kepemilikan, status final)
  return rule.cek({ user, params, query });
}

module.exports = { decide, dalamJamAkses, labelSubjek };
