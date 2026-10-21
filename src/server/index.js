'use strict';
/** Bootstrap server: migrasi bila perlu, listen, graceful shutdown. */
const config = require('./config');
const { getDb, closeDb } = require('../../db/database');
const { migrate } = require('../../db/migrate');
const { createApp } = require('./app');

function ensureSchema() {
  const db = getDb();
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
  if (!row) {
    const result = migrate();
    console.log(`[server] skema database diterapkan (versi ${result.schemaVersion})`);
  }
}

function main() {
  ensureSchema();
  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`[server] ${config.appName} v${config.version} berjalan di http://localhost:${config.port}`);
  });

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[server] menerima ${signal}, menutup server...`);
    server.close(() => {
      closeDb();
      console.log('[server] berhenti.');
      process.exit(0);
    });
    setTimeout(() => {
      closeDb();
      process.exit(0);
    }, 5000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return server;
}

if (require.main === module) {
  main();
}

module.exports = { main, ensureSchema };
