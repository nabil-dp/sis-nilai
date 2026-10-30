// Menjalankan seluruh skrip uji berurutan dan menampilkan ringkasan.
// Prasyarat: database di-seed, gateway + service-nilai + service-transkrip berjalan,
// dan jam akses gateway sedang terbuka (JAM_MULAI=0, JAM_SELESAI=24) agar test-e2e bisa jalan.
//
// Jalankan: npm run test:all          (ringkas)
//           npm run test:all -- -v    (tampilkan seluruh keluaran)
const { spawnSync } = require('child_process');
const path = require('path');

const verbose = process.argv.includes('-v') || process.argv.includes('--verbose');

const DAFTAR = [
  ['auth',   'test-auth.js',   '4.1 login, refresh, logout, token service'],
  ['policy', 'test-policy.js', '4.2/4.3 policy engine (tanpa HTTP)'],
  ['pep',    'test-pep.js',    '4.1/4.2 PEP, proxy, gateway secret'],
  ['audit',  'test-audit.js',  '4.4 audit log'],
  ['e2e',    'test-e2e.js',    '4.1-4.3 alur lengkap + akses langsung ke service'],
  ['jam',    'test-jam.js',    '4.3 jam akses (menyesuaikan konfigurasi)'],
];

const hasil = [];
for (const [nama, berkas, ket] of DAFTAR) {
  process.stdout.write(`Menjalankan ${nama.padEnd(7)} ... `);
  const p = spawnSync(process.execPath, [path.join(__dirname, berkas)], {
    encoding: 'utf8',
    timeout: 120000,
  });
  const keluaran = `${p.stdout || ''}${p.stderr || ''}`;
  const ringkas = (keluaran.match(/Hasil: .*/g) || []).pop() || '(tidak ada ringkasan)';
  const ok = p.status === 0;
  hasil.push({ nama, ok });
  console.log(ok ? 'OK' : 'GAGAL');

  if (verbose) {
    console.log(keluaran);
  } else {
    console.log(`    ${ket}\n    ${ringkas}`);
    if (!ok) {
      const baris = keluaran.split('\n').filter((l) => /FAIL|gagal|Saat ini di luar jam/i.test(l));
      for (const l of baris.slice(0, 12)) console.log(`    ${l.trim()}`);
      console.log(`    (jalankan "npm run test:${nama}" untuk keluaran lengkap)`);
    }
  }
}

const gagal = hasil.filter((h) => !h.ok);
console.log(`\n${hasil.length - gagal.length}/${hasil.length} skrip uji lulus${gagal.length ? `; gagal: ${gagal.map((g) => g.nama).join(', ')}` : ''}`);
process.exit(gagal.length ? 1 : 0);
