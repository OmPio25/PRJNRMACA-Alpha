'use strict';
/**
 * Sesi + otorisasi:
 *  - loadSession: baca cookie `sid`, cek kedaluwarsa, sliding last_seen_at/expires_at
 *  - requireAuth / requirePermission / attachScope / requireUploadType
 *  - uploaderOwnsBatch: uploader hanya boleh mengakses batch miliknya
 */
const config = require('../config');
const { queryOne, execute, nowIso } = require('../../../db/database');
const { parseCookies } = require('../util/cookies');
const { AppError, authRequired, forbidden, validation } = require('./errors');
const rbac = require('./rbac');
const { parseJson } = require('../util/serialize');

const UPLOAD_TYPES = ['AGENT', 'PRODUCTION', 'CLAIM'];

function userFromRow(row) {
  return {
    userId: row.user_id,
    email: row.email,
    fullName: row.full_name,
    roleKey: row.role_key,
    roleName: row.role_name || null,
    status: row.status,
    allowedUploadTypes: parseJson(row.allowed_upload_types, []),
    branchScope: parseJson(row.branch_scope, []),
    mustChangePassword: row.must_change_password === 1,
  };
}

function loadSession(req, res, next) {
  try {
    const cookies = parseCookies(req.headers.cookie);
    const sid = cookies[config.cookieName];
    if (!sid) return next();
    const row = queryOne(
      `SELECT s.session_id, s.expires_at, s.last_seen_at,
              u.user_id, u.email, u.full_name, u.password_hash, u.role_key,
              u.status, u.allowed_upload_types, u.branch_scope, u.must_change_password,
              r.role_name
         FROM sessions s
         JOIN users u ON u.user_id = s.user_id
    LEFT JOIN roles r ON r.role_key = u.role_key
        WHERE s.session_id = ?`,
      [sid],
    );
    if (!row) return next();
    const now = Date.now();
    if (new Date(row.expires_at).getTime() <= now) {
      execute('DELETE FROM sessions WHERE session_id = ?', [sid]);
      return next();
    }
    if (row.status !== 'active') {
      execute('DELETE FROM sessions WHERE session_id = ?', [sid]);
      return next();
    }
    const user = userFromRow(row);
    user._permissions = rbac.getPermissions(user.roleKey);
    req.user = user;
    req.sessionId = sid;
    // Sliding expiry: perpanjang sesi aktif.
    const expiresAt = new Date(now + config.sessionTtlMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
    execute('UPDATE sessions SET expires_at = ?, last_seen_at = ? WHERE session_id = ?', [expiresAt, nowIso(), sid]);
    next();
  } catch (error) {
    next(error);
  }
}

function requireAuth(req, res, next) {
  if (!req.user) return next(authRequired());
  return next();
}

function requirePermission(permission) {
  return function permissionGuard(req, res, next) {
    if (!req.user) return next(authRequired());
    const permissions = rbac.attachPermissions(req);
    req.user._permissions = permissions;
    if (!permissions.has(permission)) {
      return next(forbidden(`Izin ${permission} diperlukan untuk aksi ini`));
    }
    return next();
  };
}

/** Tempelkan branchScope efektif ke request (array kode cabang, [] = semua). */
function attachScope(req, res, next) {
  req.branchScope = Array.isArray(req.user?.branchScope) ? req.user.branchScope : [];
  next();
}

function assertUploadType(req, type) {
  if (type === undefined || type === null || type === '') {
    throw validation('Jenis upload wajib diisi', [{ field: 'uploadType', message: 'Wajib diisi' }]);
  }
  const normalized = String(type).trim().toUpperCase();
  if (!UPLOAD_TYPES.includes(normalized)) {
    throw validation('Jenis upload tidak valid', [{
      field: 'uploadType',
      message: `Gunakan salah satu dari: ${UPLOAD_TYPES.join(', ')}`,
    }]);
  }
  const allowed = req.user?.allowedUploadTypes || [];
  if (allowed.length > 0 && !allowed.includes(normalized)) {
    throw forbidden(`Peran Anda tidak diizinkan melakukan upload ${normalized}`);
  }
  return normalized;
}

/** uploader hanya boleh melihat batch miliknya; view-all mengalahkan aturan ini. */
function assertBatchAccess(req, batch) {
  if (!batch) throw new AppError('NOT_FOUND', 404, 'Batch upload tidak ditemukan');
  if (batch.uploaded_by === req.user?.userId) return batch;
  if (rbac.can(req.user, 'upload.view.all')) return batch;
  throw forbidden('Anda hanya dapat mengakses batch upload milik sendiri');
}

module.exports = {
  UPLOAD_TYPES,
  userFromRow,
  loadSession,
  requireAuth,
  requirePermission,
  attachScope,
  assertUploadType,
  assertBatchAccess,
};
