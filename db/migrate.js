'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { getDb, nowIso } = require('./database');

const SCHEMA_VERSION = '1.0.0';

function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(sql);
    db.prepare(
      `INSERT INTO app_meta (meta_key, meta_value, updated_at) VALUES ('schema_version', ?, ?)
       ON CONFLICT(meta_key) DO UPDATE SET meta_value = excluded.meta_value, updated_at = excluded.updated_at`
    ).run(SCHEMA_VERSION, nowIso());
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw error;
  }
  return { schemaVersion: SCHEMA_VERSION };
}

module.exports = { migrate, SCHEMA_VERSION };

if (require.main === module) {
  const result = migrate();
  console.log(`[migrate] skema diterapkan, versi ${result.schemaVersion}`);
}
