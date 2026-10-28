PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  nama          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('mahasiswa', 'dosen', 'admin')),
  nim           TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS devices (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  UNIQUE (user_id, device_id)
);

CREATE TABLE IF NOT EXISTS kelas (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  kode     TEXT NOT NULL UNIQUE,
  nama     TEXT NOT NULL,
  dosen_id INTEGER NOT NULL REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS nilai (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kelas_id     INTEGER NOT NULL REFERENCES kelas(id),
  nim          TEXT NOT NULL REFERENCES users(nim),
  nilai        REAL,
  status_final INTEGER NOT NULL DEFAULT 0 CHECK (status_final IN (0, 1)),
  UNIQUE (kelas_id, nim)
);

CREATE TABLE IF NOT EXISTS transkrip (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  nim      TEXT NOT NULL REFERENCES users(nim),
  kelas_id INTEGER NOT NULL REFERENCES kelas(id),
  nilai    REAL NOT NULL,
  UNIQUE (nim, kelas_id)
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,            -- epoch detik
  revoked    INTEGER NOT NULL DEFAULT 0 CHECK (revoked IN (0, 1))
);

CREATE TABLE IF NOT EXISTS service_clients (
  client_id   TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  nama        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  waktu    TEXT NOT NULL,
  subjek   TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  device   TEXT,
  hasil    TEXT NOT NULL CHECK (hasil IN ('allow', 'deny')),
  alasan   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nilai_nim      ON nilai(nim);
CREATE INDEX IF NOT EXISTS idx_nilai_kelas    ON nilai(kelas_id);
CREATE INDEX IF NOT EXISTS idx_transkrip_nim  ON transkrip(nim);
CREATE INDEX IF NOT EXISTS idx_refresh_user   ON refresh_tokens(user_id);
