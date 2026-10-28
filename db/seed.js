const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { openDb, DB_PATH } = require('./db');

for (const suffix of ['', '-wal', '-shm']) {
  if (fs.existsSync(DB_PATH + suffix)) fs.unlinkSync(DB_PATH + suffix);
}

const db = openDb();
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

const PASSWORD = 'password123';
const hash = bcrypt.hashSync(PASSWORD, 10);

const users = [
  ['admin',    'Admin Prodi',         'admin',     null,        'DEV-ADMIN-01'],
  ['dosen1',   'Dr. Budi Santoso',    'dosen',     null,        'DEV-DOSEN1-01'],
  ['dosen2',   'Dr. Siti Rahma',      'dosen',     null,        'DEV-DOSEN2-01'],
  ['mhs1',     'Andi Pratama',        'mahasiswa', '2210001',   'DEV-MHS1-01'],
  ['mhs2',     'Bella Safitri',       'mahasiswa', '2210002',   'DEV-MHS2-01'],
  ['mhs3',     'Citra Dewi',          'mahasiswa', '2210003',   'DEV-MHS3-01'],
];

const insertUser = db.prepare(
  'INSERT INTO users (username, nama, password_hash, role, nim) VALUES (?, ?, ?, ?, ?)'
);
const insertDevice = db.prepare(
  'INSERT INTO devices (user_id, device_id) VALUES (?, ?)'
);

const idByUsername = {};

const seed = db.transaction(() => {
  for (const [username, nama, role, nim, device] of users) {
    const { lastInsertRowid } = insertUser.run(username, nama, hash, role, nim);
    insertDevice.run(lastInsertRowid, device);
    idByUsername[username] = Number(lastInsertRowid);
  }

  const insertKelas = db.prepare(
    'INSERT INTO kelas (kode, nama, dosen_id) VALUES (?, ?, ?)'
  );
  const k1 = Number(insertKelas.run('KP70065004', 'Keamanan Informasi', idByUsername.dosen1).lastInsertRowid);
  const k2 = Number(insertKelas.run('IF70012003', 'Basis Data', idByUsername.dosen2).lastInsertRowid);

  const insertNilai = db.prepare(
    'INSERT INTO nilai (kelas_id, nim, nilai, status_final) VALUES (?, ?, ?, 0)'
  );
  const dataNilai = [
    [k1, '2210001', 85], [k1, '2210002', 78], [k1, '2210003', 90],
    [k2, '2210001', 80], [k2, '2210002', 88], [k2, '2210003', 75],
  ];
  for (const row of dataNilai) insertNilai.run(...row);

  db.prepare(
    'INSERT INTO service_clients (client_id, secret_hash, nama) VALUES (?, ?, ?)'
  ).run('service-nilai', bcrypt.hashSync('rahasia-service-nilai', 10), 'Service Nilai');
});

seed();

// Ringkasan untuk dicatat di README
console.log('Seed selesai:', DB_PATH, '\n');
console.log('Password semua user:', PASSWORD, '\n');
console.table(
  db.prepare(`
    SELECT u.id, u.username, u.role, u.nim, d.device_id
    FROM users u JOIN devices d ON d.user_id = u.id
    ORDER BY u.id
  `).all()
);
console.table(
  db.prepare(`
    SELECT k.id, k.kode, k.nama, u.username AS dosen
    FROM kelas k JOIN users u ON u.id = k.dosen_id
  `).all()
);
console.log('Service client: service-nilai / rahasia-service-nilai');

db.close();
