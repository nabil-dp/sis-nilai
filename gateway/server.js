const express = require('express');
const config = require('./config');
const authRoutes = require('./auth.routes');
const pep = require('./pep');
const { teruskan } = require('./proxy');

const app = express();
app.disable('x-powered-by');

// 1. Endpoint /auth/* ditangani gateway sendiri (login, refresh, logout, token service).
// PENTING: express.json() hanya dipasang di sini. Jika dipasang global, body request
// yang akan di-proxy sudah terbaca habis dan proxy akan menggantung.
app.use('/auth', express.json({ limit: '10kb' }), authRoutes);

// 2. Semua request lain wajib melewati PEP (token -> policy -> audit log).
//    Endpoint yang tidak dikenal ditolak di sini (default deny).
app.use(pep);

// 3. Request yang di-allow diteruskan ke service dengan X-Gateway-Secret.
app.use(teruskan);

// Penangan error (mis. JSON rusak pada /auth)
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Body JSON tidak valid' });
  }
  console.error(err);
  res.status(500).json({ error: 'Kesalahan internal' });
});

app.listen(config.port, () => {
  console.log(`[GATEWAY] berjalan di http://localhost:${config.port}`);
  console.log(`[GATEWAY] service nilai     -> ${config.nilaiUrl}`);
  console.log(`[GATEWAY] service transkrip -> ${config.transkripUrl}`);
  console.log(`[GATEWAY] jam akses: ${config.jamAkses.mulai}:00 - ${config.jamAkses.selesai}:00`);
});
