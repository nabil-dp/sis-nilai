const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'sistem-nilai.db');

function openDb() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');  
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000'); 
  return db;
}

module.exports = { openDb, DB_PATH };
