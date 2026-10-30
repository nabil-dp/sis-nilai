// Koneksi ke database bersama. better-sqlite3 di-resolve dari db/node_modules.
const { openDb } = require('../db/db');

module.exports = openDb();
