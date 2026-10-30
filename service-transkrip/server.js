const express = require('express');
const config = require('./config');
const db = require('./database');
const guard = require('./guard');

const app = express();
app.disable('x-powered-by');

// Guard dipasang PALING AWAL: gateway secret + verifikasi ulang token
app.use(guard);
app.use(express.json({ limit: '100kb' }));

// ---------------------------------------------------------------
// Query
// ---------------------------------------------------------------
const q = {
  userById: db.prepare('SELECT id, role, nim FROM users WHERE id = ?'),
  mahasiswaByNim: db.prepare("SELECT nim, nama FROM users WHERE nim = ? AND role = 'mahasiswa'"),
  clientById: db.prepare('SELECT 1 FROM service_clients WHERE client_id = ?'),
  kelasById: db.prepare('SELECT id FROM kelas WHERE id = ?'),
  transkripByNim: db.prepare(`
    SELECT t.kelas_id, k.kode, k.nama AS nama_kelas, t.nilai
    FROM transkrip t JOIN kelas k ON k.id = t.kelas_id
    WHERE t.nim = ?
    ORDER BY t.kelas_id
  `),
  upsert: db.prepare(`
    INSERT INTO transkrip (nim, kelas_id, nilai) VALUES (?, ?, ?)
    ON CONFLICT (nim, kelas_id) DO UPDATE SET nilai = excluded.nilai
  `),
};

// ---------------------------------------------------------------
// Helper
// ---------------------------------------------------------------
function userDariToken(auth) {
  if (auth.role === 'service') return null;
  const id = Number(auth.sub);
  if (!Number.isInteger(id)) return null;
  const user = q.userById.get(id);
  return user && user.role === auth.role ? user : null;
}

const tolak = (res, status, error, extra = {}) => res.status(status).json({ error, ...extra });

const simpanSemua = db.transaction((kelasId, daftar) => {
  for (const { nim, nilai } of daftar) q.upsert.run(nim, kelasId, nilai);
});

// ---------------------------------------------------------------
// GET /transkrip/:nim
//  - mahasiswa: hanya NIM sendiri (NIM diambil dari database berdasarkan token)
//  - admin    : semua NIM
// ---------------------------------------------------------------
app.get('/transkrip/:nim', (req, res) => {
  const user = userDariToken(req.auth);
  if (!user || !['mahasiswa', 'admin'].includes(user.role)) {
    return tolak(res, 403, 'Role tidak diizinkan');
  }

  const { nim } = req.params;
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(nim)) return tolak(res, 400, 'NIM tidak valid');
  if (user.role === 'mahasiswa' && nim !== user.nim) {
    return tolak(res, 403, 'Mahasiswa hanya boleh melihat transkrip miliknya sendiri');
  }

  const mhs = q.mahasiswaByNim.get(nim);
  if (!mhs) return tolak(res, 404, 'Mahasiswa tidak ditemukan');

  const transkrip = q.transkripByNim.all(nim);
  return res.json({ nim: mhs.nim, nama: mhs.nama, jumlah_mk: transkrip.length, transkrip });
});

// ---------------------------------------------------------------
// POST /transkrip/sinkron
// Body: { "kelas_id": 1, "nilai": [ { "nim": "2210001", "nilai": 85 }, ... ] }
// Hanya token service. Token user mana pun ditolak.
// Upsert: aman dipanggil berulang.
// ---------------------------------------------------------------
app.post('/transkrip/sinkron', (req, res) => {
  if (req.auth.role !== 'service') {
    return tolak(res, 403, 'Hanya token service yang boleh memanggil endpoint ini');
  }
  if (!q.clientById.get(String(req.auth.sub))) {
    return tolak(res, 403, 'Client service tidak terdaftar');
  }

  const { kelas_id: kelasId, nilai: daftar } = req.body || {};
  if (!Number.isInteger(kelasId) || kelasId < 1) return tolak(res, 400, 'kelas_id tidak valid');
  if (!Array.isArray(daftar) || daftar.length === 0 || daftar.length > 1000) {
    return tolak(res, 400, 'nilai harus berupa array berisi 1-1000 data');
  }
  if (!q.kelasById.get(kelasId)) return tolak(res, 404, 'Kelas tidak ditemukan');

  const galat = [];
  daftar.forEach((item, i) => {
    if (!item || typeof item.nim !== 'string' || !q.mahasiswaByNim.get(item.nim)) {
      galat.push(`data[${i}]: NIM tidak valid atau bukan mahasiswa`);
    } else if (typeof item.nilai !== 'number' || !Number.isFinite(item.nilai) || item.nilai < 0 || item.nilai > 100) {
      galat.push(`data[${i}]: nilai harus angka 0-100`);
    }
  });
  if (galat.length > 0) return tolak(res, 400, 'Data sinkron tidak valid', { rincian: galat.slice(0, 10) });

  simpanSemua(kelasId, daftar);
  return res.json({ message: 'Sinkron berhasil', kelas_id: kelasId, jumlah: daftar.length });
});

// ---------------------------------------------------------------
app.use((req, res) => tolak(res, 404, 'Endpoint tidak ditemukan'));

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return tolak(res, 400, 'Body JSON tidak valid');
  console.error(err);
  return tolak(res, 500, 'Kesalahan internal');
});

// Tanpa host: menerima koneksi IPv4 dan IPv6
app.listen(config.port, () => {
  console.log(`[SERVICE TRANSKRIP] berjalan di port ${config.port}`);
});
