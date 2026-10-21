'use strict';
/** Hapus database + file upload lalu bangun ulang dari nol (migrate + seed). */
const fs = require('node:fs');
const path = require('node:path');
const { APP_ROOT, resolveDbPath, closeDb } = require('./database');

function removeIfExists(target) {
  if (fs.existsSync(target)) fs.rmSync(target, { force: true, recursive: false });
}

function reset() {
  closeDb();
  const dbPath = resolveDbPath();
  for (const suffix of ['', '-wal', '-shm']) removeIfExists(dbPath + suffix);
  const uploadDir = path.join(APP_ROOT, 'storage', 'uploads');
  if (fs.existsSync(uploadDir)) {
    for (const entry of fs.readdirSync(uploadDir)) {
      if (entry === '.gitkeep') continue;
      fs.rmSync(path.join(uploadDir, entry), { force: true, recursive: true });
    }
  }
  fs.mkdirSync(uploadDir, { recursive: true });
  fs.writeFileSync(path.join(uploadDir, '.gitkeep'), '');
  // re-require supaya koneksi baru dibuat
  delete require.cache[require.resolve('./migrate')];
  delete require.cache[require.resolve('./seed')];
  const { seed } = require('./seed');
  return seed();
}

module.exports = { reset };

if (require.main === module) {
  const counts = reset();
  console.log('[reset] database dibangun ulang.');
  for (const [table, count] of Object.entries(counts)) {
    console.log(`  ${table.padEnd(24)} ${count}`);
  }
}
