const express = require('express');
const config = require('./config');
const { logAudit } = require('./audit');
const authRoutes = require('./auth.routes');

const app = express();
app.disable('x-powered-by');

// PENTING: express.json() hanya dipasang pada /auth.
// Jika dipasang global, body request yang akan di-proxy ke service sudah
// terbaca habis dan proxy (Tahap 4) akan menggantung.
app.use('/auth', express.json({ limit: '10kb' }), authRoutes);


// Semua yang tidak dikenal ditolak dan dicatat
app.use((req, res) => {
  logAudit({
    endpoint: `${req.method} ${req.originalUrl}`,
    device: req.get('X-Device-ID') || null,
    hasil: 'deny',
    alasan: 'endpoint tidak dikenal',
  });
  res.status(404).json({ error: 'Endpoint tidak ditemukan' });
});

// Penangan error (mis. JSON rusak)
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Body JSON tidak valid' });
  }
  console.error(err);
  res.status(500).json({ error: 'Kesalahan internal' });
});

app.listen(config.port, () => {
  console.log(`[GATEWAY] berjalan di http://localhost:${config.port}`);
  console.log(`[GATEWAY] jam akses: ${config.jamAkses.mulai}:00 - ${config.jamAkses.selesai}:00`);
});
