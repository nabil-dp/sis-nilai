const express = require('express');
const config = require('./config');
const db = require('./database');
const guard = require('./guard');
const { sinkronTranskrip } = require('./sinkron');

const app = express();
app.disable('x-powered-by');

// Guard dipasang PALING AWAL: request tanpa gateway secret dan token valid
// ditolak sebelum body sempat diproses.
app.use(guard);
app.use(express.json({ limit: '10kb' }));

// ---------------------------------------------------------------
// Query
// ---------------------------------------------------------------
const NILAI_SELECT = `
  SELECT n.id, n.kelas_id, k.kode, k.nama AS nama_kelas,
         n.nim, u.nama AS nama_mahasiswa, n.nilai, n.status_final
  FROM nilai n
  JOIN kelas k ON k.id = n.kelas_id
  JOIN users u ON u.nim = n.nim
`;

const q = {
  userById: db.prepare('SELECT id, role, nim FROM users WHERE id = ?'),
  kelasById: db.prepare('SELECT id, dosen_id FROM kelas WHERE id = ?'),
  nilaiMahasiswa: db.prepare(`${NILAI_SELECT} WHERE n.nim = ? ORDER BY n.kelas_id, n.nim`),
  nilaiDosen: db.prepare(`${NILAI_SELECT} WHERE k.dosen_id = ? ORDER BY n.kelas_id, n.nim`),
  nilaiKelas: db.prepare(`${NILAI_SELECT} WHERE n.kelas_id = ? ORDER BY n.nim`),
  nilaiDenganKelas: db.prepare(`
    SELECT n.id, n.status_final, k.dosen_id
    FROM nilai n JOIN kelas k ON k.id = n.kelas_id
    WHERE n.id = ?
  `),
  // Syarat status_final = 0 ada di dalam UPDATE agar atomik (aman dari race dengan finalisasi)
  ubahNilai: db.prepare('UPDATE nilai SET nilai = ? WHERE id = ? AND status_final = 0'),
  hitungNilai: db.prepare('SELECT COUNT(*) AS c FROM nilai WHERE kelas_id = ?'),
  hitungKosong: db.prepare('SELECT COUNT(*) AS c FROM nilai WHERE kelas_id = ? AND nilai IS NULL'),
  finalkan: db.prepare('UPDATE nilai SET status_final = 1 WHERE kelas_id = ?'),
  nilaiFinalKelas: db.prepare(
    'SELECT nim, nilai FROM nilai WHERE kelas_id = ? AND status_final = 1 ORDER BY nim'
  ),
};

// ---------------------------------------------------------------
// Helper
// ---------------------------------------------------------------

// Identitas dari database: user harus ada dan role-nya sama dengan role di token.
// Token service tidak punya user (mengembalikan null).
function userDariToken(auth) {
  if (auth.role === 'service') return null;
  const id = Number(auth.sub);
  if (!Number.isInteger(id)) return null;
  const user = q.userById.get(id);
  return user && user.role === auth.role ? user : null;
}

const tampilkan = ({ status_final, ...sisa }) => ({ ...sisa, final: status_final === 1 });

const idValid = (s) => typeof s === 'string' && /^\d+$/.test(s);

const tolak = (res, status, error) => res.status(status).json({ error });

// Finalisasi dalam satu transaksi: cek kelengkapan, tandai final, ambil data final
const finalkanKelas = db.transaction((kelasId) => {
  if (q.hitungNilai.get(kelasId).c === 0) return { error: 'Kelas belum memiliki data nilai' };
  const kosong = q.hitungKosong.get(kelasId).c;
  if (kosong > 0) return { error: `Masih ada ${kosong} nilai yang kosong` };
  q.finalkan.run(kelasId);   // idempotent: aman diulang
  return { data: q.nilaiFinalKelas.all(kelasId) };
});

// ---------------------------------------------------------------
// GET /nilai
//  - mahasiswa: hanya nilai miliknya (NIM diambil dari database berdasarkan token)
//  - dosen    : hanya kelas yang diampu; ?kelas_id= untuk satu kelas
// ---------------------------------------------------------------
app.get('/nilai', (req, res) => {
  const user = userDariToken(req.auth);
  if (!user || !['mahasiswa', 'dosen'].includes(user.role)) {
    return tolak(res, 403, 'Role tidak diizinkan');
  }

  let rows;
  if (user.role === 'mahasiswa') {
    if (req.query.nim !== undefined && req.query.nim !== user.nim) {
      return tolak(res, 403, 'Mahasiswa hanya boleh melihat nilai miliknya sendiri');
    }
    rows = q.nilaiMahasiswa.all(user.nim);
  } else if (req.query.kelas_id !== undefined) {
    if (!idValid(req.query.kelas_id)) return tolak(res, 400, 'kelas_id tidak valid');
    const kelas = q.kelasById.get(Number(req.query.kelas_id));
    if (!kelas || kelas.dosen_id !== user.id) return tolak(res, 403, 'Dosen bukan pengampu kelas ini');
    rows = q.nilaiKelas.all(kelas.id);
  } else {
    rows = q.nilaiDosen.all(user.id);
  }

  return res.json({ jumlah: rows.length, data: rows.map(tampilkan) });
});

// ---------------------------------------------------------------
// PUT /nilai/:id  { "nilai": 0..100 }
// Dosen pengampu, nilai belum final. (Jam akses ditegakkan di PEP.)
// ---------------------------------------------------------------
app.put('/nilai/:id', (req, res) => {
  const user = userDariToken(req.auth);
  if (!user || user.role !== 'dosen') return tolak(res, 403, 'Hanya dosen yang boleh mengubah nilai');
  if (!idValid(req.params.id)) return tolak(res, 400, 'ID nilai tidak valid');

  const nilai = req.body?.nilai;
  if (typeof nilai !== 'number' || !Number.isFinite(nilai) || nilai < 0 || nilai > 100) {
    return tolak(res, 400, 'nilai harus berupa angka 0-100');
  }

  const row = q.nilaiDenganKelas.get(Number(req.params.id));
  if (!row) return tolak(res, 404, 'Nilai tidak ditemukan');
  if (row.dosen_id !== user.id) return tolak(res, 403, 'Dosen bukan pengampu kelas dari nilai ini');
  if (row.status_final === 1) return tolak(res, 409, 'Nilai sudah final dan tidak boleh diubah');

  const hasil = q.ubahNilai.run(nilai, row.id);
  if (hasil.changes === 0) return tolak(res, 409, 'Nilai sudah final dan tidak boleh diubah');

  return res.json({ message: 'Nilai diperbarui', id: row.id, nilai });
});

// ---------------------------------------------------------------
// POST /kelas/:id/finalisasi
// 1. dosen pengampu  2. tandai semua nilai kelas final
// 3. kirim ke Service Transkrip LEWAT GATEWAY dengan token service
// Jika sinkron gagal, status final tetap tersimpan; ulangi finalisasi untuk sinkron ulang
// (aman karena Service Transkrip memakai upsert).
// ---------------------------------------------------------------
app.post('/kelas/:id/finalisasi', async (req, res) => {
  const user = userDariToken(req.auth);
  if (!user || user.role !== 'dosen') return tolak(res, 403, 'Hanya dosen yang boleh memfinalisasi nilai');
  if (!idValid(req.params.id)) return tolak(res, 400, 'ID kelas tidak valid');

  const kelas = q.kelasById.get(Number(req.params.id));
  if (!kelas) return tolak(res, 404, 'Kelas tidak ditemukan');
  if (kelas.dosen_id !== user.id) return tolak(res, 403, 'Dosen bukan pengampu kelas ini');

  const hasil = finalkanKelas(kelas.id);
  if (hasil.error) return tolak(res, 409, hasil.error);

  try {
    const sinkron = await sinkronTranskrip(kelas.id, hasil.data);
    return res.json({
      message: 'Kelas difinalisasi dan transkrip tersinkron',
      kelas_id: kelas.id,
      jumlah_nilai: hasil.data.length,
      sinkron,
    });
  } catch (err) {
    console.error(`[FINALISASI] sinkron kelas ${kelas.id} gagal:`, err.message);
    return res.status(502).json({
      error: 'Nilai sudah final, tetapi sinkron ke transkrip gagal. Ulangi finalisasi untuk sinkron ulang.',
      kelas_id: kelas.id,
      final: true,
      sinkron: false,
    });
  }
});

// ---------------------------------------------------------------
app.use((req, res) => tolak(res, 404, 'Endpoint tidak ditemukan'));

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return tolak(res, 400, 'Body JSON tidak valid');
  console.error(err);
  return tolak(res, 500, 'Kesalahan internal');
});

// Tanpa host: menerima koneksi IPv4 dan IPv6 (localhost bisa resolve ke keduanya)
app.listen(config.port, () => {
  console.log(`[SERVICE NILAI] berjalan di port ${config.port}`);
});
