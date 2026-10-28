const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Variabel rahasia wajib diisi, cukup panjang, dan bukan nilai contoh.
function rahasia(nama) {
  const nilai = process.env[nama];
  if (!nilai || nilai.length < 32 || nilai.startsWith('ganti-')) {
    console.error(`[CONFIG] ${nama} belum diatur dengan benar di gateway/.env`);
    console.error('         Gunakan string acak minimal 32 karakter.');
    process.exit(1);
  }
  return nilai;
}

module.exports = {
  port: Number(process.env.PORT || 3000),

  jwtSecret: rahasia('JWT_SECRET'),
  gatewaySecret: rahasia('GATEWAY_SECRET'),

  // Sesuai spesifikasi tugas
  accessTtl: '10m',          // access token user
  serviceTtl: '5m',          // token service
  refreshTtlSec: 24 * 60 * 60, // refresh token: 1 hari

  nilaiUrl: process.env.NILAI_URL || 'http://localhost:3001',
  transkripUrl: process.env.TRANSKRIP_URL || 'http://localhost:3002',

  // Jam akses (dipakai Policy Engine di Tahap 3)
  jamAkses: {
    mulai: Number(process.env.JAM_MULAI ?? 7),
    selesai: Number(process.env.JAM_SELESAI ?? 21),
  },
};
