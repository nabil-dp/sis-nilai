/**
 * Panggilan antar-service (4.1): Service Nilai memperoleh token service dari gateway,
 * lalu memanggil POST /transkrip/sinkron MELALUI gateway (bukan langsung ke
 * Service Transkrip), sehingga PEP memeriksa panggilan ini seperti request lainnya.
 */
const config = require('./config');

const TIMEOUT_MS = 10000;

async function ambilTokenService() {
  const res = await fetch(`${config.gatewayUrl}/auth/service`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`gagal mengambil token service (status ${res.status})`);
  const data = await res.json();
  return data.access_token;
}

async function sinkronTranskrip(kelasId, nilai) {
  const token = await ambilTokenService();
  const res = await fetch(`${config.gatewayUrl}/transkrip/sinkron`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ kelas_id: kelasId, nilai }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`sinkron transkrip gagal (status ${res.status})`);
  return res.json();
}

module.exports = { sinkronTranskrip };
