/**
 * Meneruskan request yang sudah di-allow PEP ke service tujuan,
 * dengan menambahkan header X-Gateway-Secret.
 *
 * Kode ini untuk http-proxy-middleware v3 (opsi `on: { ... }`).
 * Header Authorization dari klien ikut diteruskan apa adanya, karena
 * service memverifikasi ulang token itu sendiri (4.1).
 */
const { createProxyMiddleware } = require('http-proxy-middleware');
const config = require('./config');

function buatProxy(target, nama) {
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    timeout: 10000,
    proxyTimeout: 10000,
    on: {
      // setHeader menimpa nilai X-Gateway-Secret kiriman klien (jika ada)
      proxyReq: (proxyReq) => {
        proxyReq.setHeader('X-Gateway-Secret', config.gatewaySecret);
      },
      error: (err, req, res) => {
        console.error(`[PROXY] service ${nama} tidak dapat dihubungi: ${err.code || err.message}`);
        if (res && typeof res.writeHead === 'function' && !res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Service ${nama} tidak tersedia` }));
        }
      },
    },
  });
}

const proxyNilai = buatProxy(config.nilaiUrl, 'nilai');
const proxyTranskrip = buatProxy(config.transkripUrl, 'transkrip');

// Segmen pertama path menentukan service tujuan
const TUJUAN = {
  nilai: proxyNilai,
  kelas: proxyNilai,
  transkrip: proxyTranskrip,
};

function teruskan(req, res, next) {
  const segmen = (res.locals.path || '').split('/')[1];
  if (!Object.hasOwn(TUJUAN, segmen)) {
    return res.status(404).json({ error: 'Endpoint tidak ditemukan' });
  }
  return TUJUAN[segmen](req, res, next);
}

module.exports = { teruskan };
