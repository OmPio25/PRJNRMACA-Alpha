'use strict';
/**
 * Konfigurasi runtime (tanpa file .env; hanya process.env).
 */
const path = require('node:path');

const APP_ROOT = path.resolve(__dirname, '..', '..');

function intFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const config = {
  appName: 'NextMitracaReport',
  version: require(path.join(APP_ROOT, 'package.json')).version,
  env: process.env.NODE_ENV || 'development',
  port: intFromEnv('PORT', 3000),
  // DB_PATH diteruskan apa adanya ke db/database.js (yang melakukan resolve).
  dbPath: process.env.DB_PATH || null,
  appRoot: APP_ROOT,
  publicDir: path.join(APP_ROOT, 'public'),
  uploadDir: process.env.UPLOAD_DIR
    ? path.resolve(process.env.UPLOAD_DIR)
    : path.join(APP_ROOT, 'storage', 'uploads'),
  maxUploadBytes: intFromEnv('MAX_UPLOAD_BYTES', 10 * 1024 * 1024),
  sessionTtlMs: intFromEnv('SESSION_TTL_MS', 8 * 60 * 60 * 1000),
  cookieName: 'sid',
  cookieSecure: process.env.COOKIE_SECURE === '1',
  jsonBodyLimit: '2mb',
  defaultPageSize: 25,
  maxPageSize: 200,
  maxExportRows: 50000,
  loginMaxFailures: 5,
  loginWindowMs: 5 * 60 * 1000,
};

module.exports = config;
