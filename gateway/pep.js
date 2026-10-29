/**
 * Policy Enforcement Point (PEP) - NIST SP 800-207
 *
 * Dipasang setelah rute /auth/* dan sebelum proxy. Urutan:
 *   1. ambil Bearer token dari header Authorization
 *   2. verifikasi tanda tangan dan masa berlaku JWT   -> gagal: 401
 *   3. minta keputusan ke Policy Engine (policy.js)   -> deny:  403
 *   4. catat audit log (allow DAN deny)
 *   5. allow -> next() ke proxy
 *
 * Gagal-tertutup: error tak terduga di policy diperlakukan sebagai deny.
 */
const { logAudit } = require('./audit');
const { verifyToken } = require('./tokens');
const { decide, labelSubjek } = require('./policy');

// Path diambil manual dari originalUrl. JANGAN memakai new URL(originalUrl, base):
// "//host/x" akan dibaca sebagai host berbeda sehingga policy dan proxy melihat path berbeda.
function pathDari(originalUrl) {
  const i = originalUrl.indexOf('?');
  return i === -1 ? originalUrl : originalUrl.slice(0, i);
}

function ambilBearer(req) {
  const header = req.get('Authorization');
  if (!header) return { error: 'header Authorization tidak ada' };
  const m = /^Bearer\s+(\S+)$/i.exec(header);
  if (!m) return { error: 'format Authorization bukan "Bearer <token>"' };
  return { token: m[1] };
}

function alasanToken(err) {
  if (err.name === 'TokenExpiredError') return 'access token kedaluwarsa';
  if (err.name === 'NotBeforeError') return 'token belum berlaku';
  return 'token tidak valid (tanda tangan, format, atau issuer salah)';
}

function pep(req, res, next) {
  const path = pathDari(req.originalUrl);
  const endpoint = `${req.method} ${path}`;
  const device = req.get('X-Device-ID') || null;

  // Token bermasalah: subjek tidak bisa dipercaya, jadi dicatat sebagai anonymous
  const tolakToken = (alasan) => {
    logAudit({ subjek: 'anonymous', endpoint, device, hasil: 'deny', alasan });
    res.set('WWW-Authenticate', 'Bearer');
    return res.status(401).json({ error: 'Token tidak ada atau tidak valid' });
  };

  // 1-2. Token
  const { token, error } = ambilBearer(req);
  if (error) return tolakToken(error);

  let payload;
  try {
    payload = verifyToken(token);
  } catch (err) {
    return tolakToken(alasanToken(err));
  }

  // 3. Keputusan policy
  let keputusan;
  try {
    keputusan = decide(payload, { method: req.method, path, query: req.query, device });
  } catch (err) {
    console.error('[PEP] error pada policy:', err);
    keputusan = { allow: false, reason: 'kesalahan internal pada policy engine (fail closed)' };
  }

  // 4. Audit log (allow dan deny)
  logAudit({
    subjek: labelSubjek(payload),
    endpoint,
    device,
    hasil: keputusan.allow ? 'allow' : 'deny',
    alasan: keputusan.reason,
  });

  // 5. Terapkan keputusan. Alasan rinci tidak dikirim ke klien.
  if (!keputusan.allow) return res.status(403).json({ error: 'Akses ditolak' });

  res.locals.path = path;
  return next();
}

module.exports = pep;
