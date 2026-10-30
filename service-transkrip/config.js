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

module.exports = {
  port: Number(process.env.PORT || 3002),
  jwtSecret: rahasia('JWT_SECRET'),
  gatewaySecret: rahasia('GATEWAY_SECRET'),
};
