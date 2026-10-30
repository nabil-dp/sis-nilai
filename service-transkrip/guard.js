/**
 * Pertahanan di sisi service (4.1). Setiap request harus lolos dua lapis:
 *   1. X-Gateway-Secret benar  -> service tidak bisa diakses langsung
 *   2. access token valid      -> tanda tangan, masa berlaku, issuer
 * Token valid tanpa secret ditolak, dan secret benar tanpa token valid juga ditolak.
 * Hasil verifikasi disimpan di req.auth (payload JWT).
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('./config');

// Perbandingan waktu-konstan (hash dulu agar panjang sama)
function samaAman(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function guard(req, res, next) {
  // Lapis 1: gateway secret
  const secret = req.get('X-Gateway-Secret');
  if (!secret || !samaAman(secret, config.gatewaySecret)) {
    console.warn(`[GUARD] ditolak ${req.method} ${req.originalUrl}: gateway secret tidak ada/salah`);
    return res.status(403).json({ error: 'Akses langsung ke service tidak diizinkan' });
  }

  // Lapis 2: verifikasi ulang token
  const m = /^Bearer\s+(\S+)$/i.exec(req.get('Authorization') || '');
  if (!m) {
    console.warn(`[GUARD] ditolak ${req.method} ${req.originalUrl}: token tidak ada`);
    return res.status(401).json({ error: 'Token tidak ada atau tidak valid' });
  }
  try {
    req.auth = jwt.verify(m[1], config.jwtSecret, {
      algorithms: ['HS256'],
      issuer: 'sistem-nilai-gateway',
    });
  } catch (err) {
    console.warn(`[GUARD] ditolak ${req.method} ${req.originalUrl}: token tidak valid (${err.name})`);
    return res.status(401).json({ error: 'Token tidak ada atau tidak valid' });
  }
  return next();
}

module.exports = guard;
