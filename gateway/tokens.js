const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('./config');

const ALGORITHM = 'HS256';
const ISSUER = 'sistem-nilai-gateway';

// Access token user: JWT 10 menit, berisi sub (id user) dan role
function signAccessToken(user) {
  return jwt.sign(
    { sub: String(user.id), role: user.role },
    config.jwtSecret,
    { algorithm: ALGORITHM, expiresIn: config.accessTtl, issuer: ISSUER }
  );
}

// Token service: JWT 5 menit, role "service", sub = client_id
function signServiceToken(clientId) {
  return jwt.sign(
    { sub: clientId, role: 'service' },
    config.jwtSecret,
    { algorithm: ALGORITHM, expiresIn: config.serviceTtl, issuer: ISSUER }
  );
}

// Verifikasi tanda tangan, masa berlaku, dan issuer. Melempar error jika tidak valid.
// Algoritma dikunci agar token "alg: none" atau algoritma lain ditolak.
function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret, {
    algorithms: [ALGORITHM],
    issuer: ISSUER,
  });
}

// Refresh token: string acak (bukan JWT), disimpan di DB dalam bentuk hash SHA-256
function generateRefreshToken() {
  return crypto.randomBytes(48).toString('hex');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

module.exports = {
  signAccessToken,
  signServiceToken,
  verifyToken,
  generateRefreshToken,
  hashToken,
};
