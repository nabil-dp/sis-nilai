const db = require('./database');

const insert = db.prepare(`
  INSERT INTO audit_log (waktu, subjek, endpoint, device, hasil, alasan)
  VALUES (?, ?, ?, ?, ?, ?)
`);

function logAudit({ subjek = 'anonymous', endpoint, device = null, hasil, alasan }) {
  insert.run(new Date().toISOString(), subjek, endpoint, device, hasil, alasan);
  console.log(`[AUDIT] ${hasil.toUpperCase().padEnd(5)} ${subjek} | ${endpoint} | ${alasan}`);
}

module.exports = { logAudit };
