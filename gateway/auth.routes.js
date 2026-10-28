const express = require('express');
const bcrypt = require('bcryptjs');
const config = require('./config');
const db = require('./database');
const { logAudit } = require('./audit');
const {
  signAccessToken,
  signServiceToken,
  generateRefreshToken,
  hashToken,
} = require('./tokens');

const router = express.Router();

// Hash palsu agar waktu respons sama baik username ada maupun tidak
const DUMMY_HASH = bcrypt.hashSync('hash-palsu-anti-timing', 10);

const q = {
  userByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
  userById: db.prepare('SELECT * FROM users WHERE id = ?'),
  deviceOfUser: db.prepare('SELECT 1 FROM devices WHERE user_id = ? AND device_id = ?'),
  insertRefresh: db.prepare(
    'INSERT INTO refresh_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)'
  ),
  refreshByHash: db.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?'),
  revokeRefresh: db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?'),
  clientById: db.prepare('SELECT * FROM service_clients WHERE client_id = ?'),
};

const nowSec = () => Math.floor(Date.now() / 1000);

// Catat deny ke audit log (alasan rinci) dan balas klien (pesan umum).
function tolak(res, { endpoint, device = null, subjek = 'anonymous', status, alasan, pesan }) {
  logAudit({ subjek, endpoint, device, hasil: 'deny', alasan });
  return res.status(status).json({ error: pesan });
}

// Validasi refresh token: dikenal, belum dicabut, belum kedaluwarsa.
function validasiRefreshToken(rt) {
  if (typeof rt !== 'string' || rt.length === 0) {
    return { ok: false, status: 400, alasan: 'refresh_token tidak ada di body', pesan: 'refresh_token wajib diisi' };
  }
  const row = q.refreshByHash.get(hashToken(rt));
  if (!row) {
    return { ok: false, status: 401, alasan: 'refresh token tidak dikenal', pesan: 'Refresh token tidak valid' };
  }
  const subjek = `user:${row.user_id}`;
  if (row.revoked) {
    return { ok: false, status: 401, subjek, alasan: 'refresh token sudah dicabut', pesan: 'Refresh token tidak valid' };
  }
  if (row.expires_at <= nowSec()) {
    return { ok: false, status: 401, subjek, alasan: 'refresh token kedaluwarsa', pesan: 'Refresh token tidak valid' };
  }
  return { ok: true, row, subjek };
}

// ---------------------------------------------------------------
// POST /auth/login
// Kondisi: kredensial valid DAN device terdaftar 
// ---------------------------------------------------------------
router.post('/login', async (req, res) => {
  const endpoint = 'POST /auth/login';
  const device = req.get('X-Device-ID') || null;
  const { username, password } = req.body || {};

  if (typeof username !== 'string' || typeof password !== 'string') {
    return tolak(res, { endpoint, device, status: 400,
      alasan: 'username/password tidak ada di body', pesan: 'username dan password wajib diisi' });
  }
  if (!device) {
    return tolak(res, { endpoint, status: 400,
      alasan: 'header X-Device-ID tidak ada', pesan: 'Header X-Device-ID wajib diisi' });
  }

  const user = q.userByUsername.get(username);
  const passwordCocok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);

  if (!user || !passwordCocok) {
    return tolak(res, {
      endpoint, device, status: 401,
      subjek: user ? `user:${user.id}` : 'anonymous',
      alasan: user ? 'password salah' : 'username tidak ditemukan',
      pesan: 'Kredensial tidak valid',   // pesan sama agar tidak membocorkan mana yang salah
    });
  }

  // Device dicek setelah password benar, agar daftar device tidak bisa ditebak tanpa kredensial
  if (!q.deviceOfUser.get(user.id, device)) {
    return tolak(res, {
      endpoint, device, status: 403, subjek: `user:${user.id}`,
      alasan: 'device tidak terdaftar untuk user ini', pesan: 'Device tidak terdaftar',
    });
  }

  const accessToken = signAccessToken(user);
  const refreshToken = generateRefreshToken();
  q.insertRefresh.run(hashToken(refreshToken), user.id, nowSec() + config.refreshTtlSec);

  logAudit({ subjek: `user:${user.id}`, endpoint, device, hasil: 'allow', alasan: 'login berhasil' });

  return res.json({
    token_type: 'Bearer',
    access_token: accessToken,
    expires_in: 10 * 60,
    refresh_token: refreshToken,
    refresh_expires_in: config.refreshTtlSec,
    user: { id: user.id, username: user.username, role: user.role },
  });
});

// ---------------------------------------------------------------
// POST /auth/refresh
// Kondisi: refresh token valid dan belum dicabut
// ---------------------------------------------------------------
router.post('/refresh', (req, res) => {
  const endpoint = 'POST /auth/refresh';
  const device = req.get('X-Device-ID') || null;

  const hasil = validasiRefreshToken(req.body?.refresh_token);
  if (!hasil.ok) return tolak(res, { endpoint, device, ...hasil });

  const user = q.userById.get(hasil.row.user_id);
  if (!user) {
    return tolak(res, { endpoint, device, subjek: hasil.subjek, status: 401,
      alasan: 'user pemilik token sudah tidak ada', pesan: 'Refresh token tidak valid' });
  }

  logAudit({ subjek: hasil.subjek, endpoint, device, hasil: 'allow', alasan: 'access token diperbarui' });

  return res.json({
    token_type: 'Bearer',
    access_token: signAccessToken(user),
    expires_in: 10 * 60,
  });
});

// ---------------------------------------------------------------
// POST /auth/logout
// Mencabut refresh token (kolom revoked = 1)
// ---------------------------------------------------------------
router.post('/logout', (req, res) => {
  const endpoint = 'POST /auth/logout';
  const device = req.get('X-Device-ID') || null;

  const hasil = validasiRefreshToken(req.body?.refresh_token);
  if (!hasil.ok) return tolak(res, { endpoint, device, ...hasil });

  q.revokeRefresh.run(hasil.row.id);
  logAudit({ subjek: hasil.subjek, endpoint, device, hasil: 'allow', alasan: 'refresh token dicabut (logout)' });

  return res.json({ message: 'Logout berhasil, refresh token dicabut' });
});

// ---------------------------------------------------------------
// POST /auth/service
// Kondisi: client ID dan secret valid. Menghasilkan token role "service" (5 menit)
// ---------------------------------------------------------------
router.post('/service', async (req, res) => {
  const endpoint = 'POST /auth/service';
  const { client_id, client_secret } = req.body || {};

  if (typeof client_id !== 'string' || typeof client_secret !== 'string') {
    return tolak(res, { endpoint, status: 400,
      alasan: 'client_id/client_secret tidak ada di body', pesan: 'client_id dan client_secret wajib diisi' });
  }

  const client = q.clientById.get(client_id);
  const cocok = await bcrypt.compare(client_secret, client ? client.secret_hash : DUMMY_HASH);

  if (!client || !cocok) {
    return tolak(res, {
      endpoint, status: 401,
      subjek: client ? `service:${client.client_id}` : 'anonymous',
      alasan: client ? 'client secret salah' : 'client_id tidak ditemukan',
      pesan: 'Kredensial service tidak valid',
    });
  }

  logAudit({ subjek: `service:${client.client_id}`, endpoint, hasil: 'allow', alasan: 'token service diterbitkan' });

  return res.json({
    token_type: 'Bearer',
    access_token: signServiceToken(client.client_id),
    expires_in: 5 * 60,
  });
});

module.exports = router;
