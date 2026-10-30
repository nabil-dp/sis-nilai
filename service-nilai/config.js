const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

function rahasia(nama) {
  const nilai = process.env[nama];
  if (!nilai || nilai.length < 32 || nilai.startsWith('ganti-')) {
    console.error(`[CONFIG] ${nama} belum diatur dengan benar di .env (samakan dengan gateway/.env)`);
    process.exit(1);
  }
  return nilai;
}

function wajib(nama) {
  if (!process.env[nama]) {
    console.error(`[CONFIG] ${nama} belum diatur di .env`);
    process.exit(1);
  }
  return process.env[nama];
}

module.exports = {
  port: Number(process.env.PORT || 3001),
  jwtSecret: rahasia('JWT_SECRET'),
  gatewaySecret: rahasia('GATEWAY_SECRET'),
  gatewayUrl: process.env.GATEWAY_URL || 'http://localhost:3000',
  clientId: wajib('SERVICE_CLIENT_ID'),
  clientSecret: wajib('SERVICE_CLIENT_SECRET'),
};
