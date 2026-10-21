'use strict';
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const APP_ROOT = path.resolve(__dirname, '..');

let dbInstance = null;
let dbInstancePath = null;

function resolveDbPath() {
  if (process.env.DB_PATH) return path.resolve(process.env.DB_PATH);
  return path.join(APP_ROOT, 'data', 'app.db');
}

function getDb() {
  const target = resolveDbPath();
  if (dbInstance && dbInstancePath === target) return dbInstance;
  if (dbInstance) {
    try { dbInstance.close(); } catch { /* ignore */ }
    dbInstance = null;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const db = new DatabaseSync(target);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA synchronous = NORMAL;');
  dbInstance = db;
  dbInstancePath = target;
  return db;
}

function closeDb() {
  if (dbInstance) {
    try { dbInstance.close(); } catch { /* ignore */ }
  }
  dbInstance = null;
  dbInstancePath = null;
}

/** Jalankan fn dalam satu transaksi. Rollback bila melempar error. */
function withTransaction(fn) {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn(db);
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw error;
  }
}

function queryAll(sql, params = []) {
  return getDb().prepare(sql).all(...params);
}

function queryOne(sql, params = []) {
  const row = getDb().prepare(sql).get(...params);
  return row === undefined ? null : row;
}

function execute(sql, params = []) {
  return getDb().prepare(sql).run(...params);
}

function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** ID deterministik berprefix, mis. UPL-3f2a... */
function newId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

module.exports = {
  APP_ROOT,
  getDb,
  closeDb,
  withTransaction,
  queryAll,
  queryOne,
  execute,
  nowIso,
  newId,
  resolveDbPath,
};
