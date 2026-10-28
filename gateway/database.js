// Satu koneksi database untuk seluruh modul gateway.
// better-sqlite3 di-resolve dari db/node_modules (lewat db/db.js),
// jadi tidak perlu dipasang ulang di folder gateway.
const { openDb } = require('../db/db');

module.exports = openDb();
