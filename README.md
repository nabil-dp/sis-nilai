# Sistem Nilai dengan Zero Trust Security

Sistem Nilai untuk mengelola nilai mata kuliah. Dosen menginput dan memfinalisasi nilai kelas yang diampunya, lalu nilai final dikirim ke Service Transkrip. Seluruh akses, termasuk panggilan antar-service, diperiksa oleh API gateway yang berperan sebagai Policy Enforcement Point (PEP) sesuai NIST SP 800-207.

Prinsip zero trust yang diterapkan:

- **Never trust, always verify.** Setiap request diverifikasi token, device, dan kebijakannya. Service juga tidak mempercayai gateway begitu saja dan memverifikasi ulang token.
- **Least privilege.** Setiap role dan service hanya mendapat akses yang dibutuhkan. Kepemilikan data dicek ke database, bukan hanya dari isi token.
- **Assume breach.** Pertahanan berlapis: gateway secret, verifikasi ulang JWT, pengecekan kepemilikan di service, refresh token disimpan sebagai hash, dan seluruh keputusan akses dicatat di audit log.

## Arsitektur

| Komponen | Peran (NIST SP 800-207) | File utama |
|---|---|---|
| API Gateway (3000) | PEP | `gateway/pep.js`, `gateway/proxy.js`, `gateway/server.js` |
| Policy Engine / Administrator | PE / PA | `gateway/policy.js`, `gateway/auth.routes.js`, `gateway/tokens.js` |
| Service Nilai (3001) | Resource | `service-nilai/server.js`, `service-nilai/guard.js` |
| Service Transkrip (3002) | Resource | `service-transkrip/server.js`, `service-transkrip/guard.js` |
| Database | Resource | `db/schema.sql`, `db/db.js` |
| Audit log | Data source | tabel `audit_log`, ditulis oleh `gateway/audit.js` |

## Teknologi

Node.js, Express, `http-proxy-middleware` (proxy), `jsonwebtoken` (JWT HS256), `bcryptjs` (hash password), SQLite lewat `better-sqlite3`.

## Struktur repository

```
sistem-nilai/
├── db/                  skema, koneksi bersama, seed
├── gateway/             PEP, policy engine, autentikasi, audit, skrip uji (scripts/)
├── service-nilai/       Service Nilai
├── service-transkrip/   Service Transkrip
├── postman/             koleksi Postman untuk pengujian
└── docs/                skrip video demo
```

## Cara menjalankan

### Prasyarat

- Node.js 18 atau lebih baru (disarankan versi LTS).
- Tidak perlu Docker atau server database. Semua berjalan di satu komputer.

### Langkah

**1. Pasang dependensi** pada empat folder.

```bash
cd db && npm install
cd ../gateway && npm install
cd ../service-nilai && npm install
cd ../service-transkrip && npm install
```

`better-sqlite3` hanya dipasang di `db/` dan dipakai bersama lewat `db/db.js`. Jika pemasangannya gagal, lihat bagian [Pemecahan masalah](#pemecahan-masalah).

**2. Buat file `.env`** di `gateway/`, `service-nilai/`, dan `service-transkrip/` dari `.env.example` masing-masing.

```bash
copy .env.example .env      # Windows (CMD)
cp .env.example .env        # Linux/macOS/Git Bash
```

Buat dua string acak (minimal 32 karakter) dengan perintah berikut, satu untuk `JWT_SECRET` dan satu untuk `GATEWAY_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Isi `JWT_SECRET` dan `GATEWAY_SECRET` di ketiga file `.env` dengan nilai yang **sama persis**. Aplikasi menolak start jika nilainya masih placeholder atau kurang dari 32 karakter.

**3. Isi data awal (seed).** Perintah ini menghapus database lama dan membuatnya ulang.

```bash
cd db
npm run seed
```

**4. Jalankan tiga proses** pada tiga terminal terpisah.

```bash
cd service-transkrip && npm start     # port 3002
cd service-nilai && npm start         # port 3001
cd gateway && npm start               # port 3000
```

Klien hanya mengakses gateway di `http://localhost:3000`. Service tidak bisa diakses langsung tanpa gateway secret.

**5. Coba** lewat Postman (impor `postman/sistem-nilai.postman_collection.json`) atau curl (lihat [Contoh penggunaan](#contoh-penggunaan)).

### Skrip npm

Skrip berikut didefinisikan di `package.json` masing-masing folder.

| Folder | Skrip | Fungsi |
|---|---|---|
| `db` | `"seed": "node seed.js"` | Reset dan isi data awal |
| `gateway` | `"start": "node server.js"` | Jalankan gateway |
| `service-nilai`, `service-transkrip` | `"start": "node server.js"` | Jalankan service |
| `gateway` | `"test:auth"`, `"test:policy"`, `"test:pep"`, `"test:audit"`, `"test:e2e"`, `"test:jam"`, `"test:all"` | Pengujian (lihat [Pengujian](#pengujian)) |

Nilai skrip uji: `"test:auth": "node scripts/test-auth.js"`, dan seterusnya dengan pola yang sama. `"test:all"` menjalankan `node scripts/run-all.js`.

## Data awal (seed)

Semua user memakai password **`password123`**. Setiap user memiliki satu device terdaftar yang harus dikirim lewat header `X-Device-ID`.

| Username | Role | Nama | NIM | Device ID |
|---|---|---|---|---|
| `admin` | admin | Admin Prodi | - | `DEV-ADMIN-01` |
| `dosen1` | dosen | Dr. Budi Santoso | - | `DEV-DOSEN1-01` |
| `dosen2` | dosen | Dr. Siti Rahma | - | `DEV-DOSEN2-01` |
| `mhs1` | mahasiswa | Andi Pratama | 2210001 | `DEV-MHS1-01` |
| `mhs2` | mahasiswa | Bella Safitri | 2210002 | `DEV-MHS2-01` |
| `mhs3` | mahasiswa | Citra Dewi | 2210003 | `DEV-MHS3-01` |

Client service untuk `POST /auth/service`: `client_id` = `service-nilai`, `client_secret` = `rahasia-service-nilai`.

| ID kelas | Kode | Nama | Dosen pengampu |
|---|---|---|---|
| 1 | KP70065004 | Keamanan Informasi | `dosen1` |
| 2 | IF70012003 | Basis Data | `dosen2` |

Ketiga mahasiswa terdaftar di kedua kelas. Nilai awal (belum final): kelas 1 = 85, 78, 90 dan kelas 2 = 80, 88, 75, berurutan untuk NIM 2210001 sampai 2210003. ID nilai 1 sampai 3 untuk kelas 1 dan 4 sampai 6 untuk kelas 2.

## Konfigurasi

| Variabel | Dipakai di | Keterangan |
|---|---|---|
| `PORT` | semua | Gateway 3000, Service Nilai 3001, Service Transkrip 3002 |
| `JWT_SECRET` | semua | Kunci tanda tangan JWT. Harus sama di ketiganya |
| `GATEWAY_SECRET` | semua | Nilai header `X-Gateway-Secret`. Harus sama di ketiganya |
| `NILAI_URL`, `TRANSKRIP_URL` | gateway | Alamat service tujuan proxy |
| `JAM_MULAI`, `JAM_SELESAI` | gateway | Rentang jam akses ubah/finalisasi nilai (default 7 sampai 21, jam lokal komputer). Restart gateway setelah mengubahnya |
| `GATEWAY_URL` | service-nilai | Alamat gateway untuk panggilan antar-service |
| `SERVICE_CLIENT_ID`, `SERVICE_CLIENT_SECRET` | service-nilai | Kredensial untuk `POST /auth/service` |

Untuk demo, `JAM_MULAI=0` dan `JAM_SELESAI=24` membuat akses selalu terbuka, sedangkan `JAM_MULAI=0` dan `JAM_SELESAI=0` membuatnya selalu tertutup.

## Endpoint dan kebijakan akses

Semua endpoint diakses lewat gateway (`http://localhost:3000`). Selain `/auth/*`, setiap request dari user wajib membawa `Authorization: Bearer <access token>` dan `X-Device-ID` yang terdaftar.

| Endpoint | Diizinkan | Kondisi | Body / parameter |
|---|---|---|---|
| `POST /auth/login` | Semua user | Kredensial valid dan device terdaftar | `{"username","password"}` + header `X-Device-ID` |
| `POST /auth/refresh` | Semua user | Refresh token valid dan belum dicabut | `{"refresh_token"}` |
| `POST /auth/logout` | Semua user | Refresh token valid dan belum dicabut | `{"refresh_token"}` |
| `POST /auth/service` | Service Nilai | Client ID dan secret valid | `{"client_id","client_secret"}` |
| `GET /nilai` | Mahasiswa, dosen | Mahasiswa: hanya nilai miliknya. Dosen: hanya kelas yang diampu | opsional `?nim=` (mahasiswa), `?kelas_id=` (dosen) |
| `PUT /nilai/:id` | Dosen | Kelas diampu, nilai belum final, dalam jam akses | `{"nilai": 0-100}` |
| `POST /kelas/:id/finalisasi` | Dosen | Kelas diampu dan dalam jam akses. Setelah itu sinkron ke transkrip | - |
| `GET /transkrip/:nim` | Mahasiswa, admin | Mahasiswa: hanya NIM sendiri. Admin: semua NIM | - |
| `POST /transkrip/sinkron` | Service Nilai | Hanya token service. Token user mana pun ditolak | `{"kelas_id","nilai":[{"nim","nilai"}]}` |

Kode status: `400` input tidak valid, `401` token tidak ada atau tidak valid, `403` ditolak kebijakan atau guard, `404` data tidak ditemukan, `409` nilai sudah final atau ada nilai kosong, `502` sinkron ke transkrip gagal (nilai tetap final, ulangi finalisasi untuk sinkron ulang).

## Contoh penggunaan

Contoh memakai curl bergaya bash (Git Bash, Linux, macOS). Pada Windows CMD atau PowerShell, penulisan tanda kutip berbeda, jadi lebih mudah memakai Postman atau Git Bash.

```bash
# 1. Login sebagai mahasiswa (ambil access_token dari respons)
curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" -H "X-Device-ID: DEV-MHS1-01" \
  -d '{"username":"mhs1","password":"password123"}'

TOKEN="<access_token dari respons>"

# 2. Lihat nilai sendiri -> 200
curl -s http://localhost:3000/nilai \
  -H "Authorization: Bearer $TOKEN" -H "X-Device-ID: DEV-MHS1-01"

# 3. Lihat transkrip mahasiswa lain -> 403
curl -s http://localhost:3000/transkrip/2210002 \
  -H "Authorization: Bearer $TOKEN" -H "X-Device-ID: DEV-MHS1-01"

# 4. Device tidak terdaftar -> 403
curl -s http://localhost:3000/nilai \
  -H "Authorization: Bearer $TOKEN" -H "X-Device-ID: DEV-ASING-99"

# 5. Akses langsung ke service tanpa gateway secret -> 403
curl -s http://localhost:3001/nilai -H "Authorization: Bearer $TOKEN"
```

## Peta kebutuhan ke kode

| Kebutuhan | Penanganannya |
|---|---|
| **4.1** Access token JWT 10 menit (`sub`, `role`) | `gateway/tokens.js`: `signAccessToken`; diterbitkan di `gateway/auth.routes.js`: `POST /login` |
| **4.1** Refresh token 1 hari, di database, dapat dicabut | `gateway/auth.routes.js`: `/login` (simpan hash), `/refresh`, `/logout`, `validasiRefreshToken`; tabel `refresh_tokens` |
| **4.1** Token service 5 menit, `role: service` | `gateway/tokens.js`: `signServiceToken`; `gateway/auth.routes.js`: `POST /service` |
| **4.1** Gateway secret | `gateway/proxy.js`: `proxyReq` menambahkan `X-Gateway-Secret`; `service-*/guard.js` lapis 1 |
| **4.1** Verifikasi ulang token di service | `service-*/guard.js` lapis 2 (tanda tangan, masa berlaku, issuer, algoritma dikunci) |
| **4.1** Panggilan antar-service lewat gateway | `service-nilai/sinkron.js`: `ambilTokenService`, `sinkronTranskrip` |
| **4.2** Kebijakan akses (Tabel 3) | `gateway/policy.js`: tabel `RULES`, `decide`, dan fungsi `cek*` yang membaca database |
| **4.2** PEP | `gateway/pep.js`: verifikasi token, keputusan policy, audit, lalu teruskan |
| **4.2** Pertahanan lapis ketiga | `service-nilai/server.js` dan `service-transkrip/server.js`: cek kepemilikan ulang di setiap handler |
| **4.3** Device terdaftar | `gateway/policy.js`: `decide` langkah 5; `gateway/auth.routes.js`: `POST /login` |
| **4.3** Jam akses (dapat diatur) | `gateway/policy.js`: `dalamJamAkses`; konfigurasi `JAM_MULAI` dan `JAM_SELESAI` di `gateway/.env` |
| **4.4** Audit log | `gateway/audit.js`: `logAudit`; dipanggil dari `gateway/pep.js` dan `gateway/auth.routes.js` |

Urutan evaluasi di `decide` (murah ke mahal, semua harus lolos): subjek dan path valid, ada aturan (jika tidak, ditolak), role diizinkan, identitas cocok dengan database, device terdaftar, jam akses, lalu atribut data (kepemilikan kelas atau NIM, status final).

## Pengujian

Siapkan: database di-seed, ketiga proses berjalan, dan jam akses terbuka (`JAM_MULAI=0`, `JAM_SELESAI=24`, lalu restart gateway).

| Skrip | Yang diuji | Catatan |
|---|---|---|
| `npm run test:auth` | Login, refresh, logout, token service | Gateway harus hidup |
| `npm run test:policy` | Policy engine langsung, tanpa HTTP | Tidak perlu gateway |
| `npm run test:pep` | PEP, proxy, gateway secret | Menjalankan service palsu di port 3001/3002 jika kosong |
| `npm run test:audit` | Isi dan kelengkapan audit log, tidak ada rahasia tercatat | Semua proses hidup |
| `npm run test:e2e` | Alur lengkap, akses langsung ke service, finalisasi dan sinkron | **Mereset status final dan menghapus isi tabel `transkrip`** |
| `npm run test:jam` | Jam akses pada gateway sungguhan | Jalankan dua kali: jam ditutup dan dibuka |
| `npm run test:all` | Semua di atas berurutan, dengan ringkasan | Tambahkan `-- -v` untuk keluaran lengkap |

Pengujian jam akses: atur `JAM_MULAI=0` dan `JAM_SELESAI=0`, restart gateway, jalankan `npm run test:jam`. Ulangi dengan `JAM_SELESAI=24`.

**Postman.** Impor `postman/sistem-nilai.postman_collection.json` dan isi variabel koleksi `gateway_secret` dengan `GATEWAY_SECRET` dari `gateway/.env` (hanya dipakai untuk folder "Akses langsung ke service"). Jalankan lewat Collection Runner sesuai urutan folder. Folder terakhir mengubah data, jadi jalankan seed ulang sebelum mengulang.

## Melihat audit log

Gateway mencatat setiap keputusan akses (waktu, subjek, endpoint, device, hasil, alasan) ke tabel `audit_log`, dan juga menampilkannya di konsol dengan awalan `[AUDIT]`. Untuk melihat 15 catatan terakhir, jalankan dari folder `db`:

```bash
node -e "const {openDb}=require('./db');console.table(openDb().prepare('SELECT waktu,subjek,endpoint,device,hasil,alasan FROM audit_log ORDER BY id DESC LIMIT 15').all())"
```

Alternatifnya, buka `db/sistem-nilai.db` dengan DB Browser for SQLite.

## Pemecahan masalah

| Gejala | Penyebab dan solusi |
|---|---|
| `npm install` di `db` gagal pada `better-sqlite3` (node-gyp, Visual Studio, Windows SDK) | Versi `better-sqlite3` belum punya binary siap pakai untuk versi Node Anda. Jalankan `npm install better-sqlite3@latest`, atau gunakan Node.js LTS. Hapus `node_modules` dan `package-lock.json` dulu jika perlu |
| `EPERM` saat `npm install` | Tutup editor atau antivirus yang mengunci folder, hapus `node_modules`, ulangi |
| `[CONFIG] JWT_SECRET belum diatur dengan benar` | Nilai masih placeholder atau kurang dari 32 karakter |
| `[CONFIG] SERVICE_CLIENT_ID belum diatur` | `service-nilai/.env` harus dari `service-nilai/.env.example`, bukan salinan `.env` gateway |
| Semua request ke service dijawab 404 | `PORT` di `.env` service atau `NILAI_URL`/`TRANSKRIP_URL` di `gateway/.env` tertukar |
| Langsung ke service menjawab 401 padahal secret benar | `JWT_SECRET` service berbeda dengan gateway |
| Langsung ke service menjawab 403 padahal token valid | `GATEWAY_SECRET` service berbeda dengan gateway |
| 502 dari gateway | Service tujuan belum atau tidak berjalan |
| Ubah nilai atau finalisasi selalu 403 | Di luar jam akses. Atur `JAM_MULAI` dan `JAM_SELESAI`, lalu restart gateway |
| Port sudah dipakai | Ubah `PORT` di `.env` dan sesuaikan `NILAI_URL`/`TRANSKRIP_URL` |

## Batasan dan pengembangan lanjutan

Proyek ini ditujukan untuk praktikum, dengan batasan berikut.

- JWT memakai HS256 dengan kunci bersama, sehingga service memegang kunci yang juga bisa menerbitkan token. Pada produksi, lebih baik memakai tanda tangan asimetris (RS256 atau ES256) agar service hanya memegang kunci publik.
- `X-Device-ID` adalah identitas yang dikirim klien, jadi bukan atestasi device yang kuat. Mekanisme ini menunjukkan konsep verifikasi konteks, bukan pengganti sertifikat device atau MDM.
- Refresh token tidak dirotasi dan belum ada pembatasan laju (rate limiting) untuk login.
- Komunikasi memakai HTTP biasa. Pada produksi, gunakan TLS, termasuk mTLS antar-komponen.
- Gateway secret dan kredensial service adalah rahasia statis di file `.env`. Produksi sebaiknya memakai secret manager dan rotasi berkala.
- Jam akses memakai waktu lokal komputer yang menjalankan gateway.
- Seluruh komponen berbagi satu database SQLite sesuai ketentuan tugas. Pemisahan database per service akan memperkuat isolasi.
