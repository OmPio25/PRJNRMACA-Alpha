'use strict';
/** Identitas: login, sesi, permission, ubah password. */
const crypto = require('node:crypto');
const config = require('../config');
const { queryOne, execute, nowIso, newId } = require('../../../db/database');
const { verifyPassword, hashPassword } = require('../../../db/password');
const { AppError, validation } = require('../middleware/errors');
const { userFromRow } = require('../middleware/auth');
const { recordAudit } = require('./audit');
const { parseJson } = require('../util/serialize');

function findUserByEmail(email) {
  return queryOne(
    `SELECT u.*, r.role_name
       FROM users u
  LEFT JOIN roles r ON r.role_key = u.role_key
      WHERE lower(u.email) = lower(?)`,
    [email],
  );
}

function getUserRow(userId) {
  return queryOne(
    `SELECT u.*, r.role_name
       FROM users u
  LEFT JOIN roles r ON r.role_key = u.role_key
      WHERE u.user_id = ?`,
    [userId],
  );
}

function getUser(userId) {
  const row = getUserRow(userId);
  if (!row) return null;
  const user = userFromRow(row);
  return user;
}

function authenticate(email, password) {
  const row = findUserByEmail(email);
  if (!row || row.status !== 'active') {
    return null;
  }
  if (!verifyPassword(password, row.password_hash)) return null;
  return userFromRow(row);
}

function createSession(userId, userAgent) {
  const sessionId = crypto.randomBytes(32).toString('hex');
  const now = nowIso();
  const expiresAt = new Date(Date.now() + config.sessionTtlMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
  execute(
    `INSERT INTO sessions (session_id, user_id, created_at, expires_at, last_seen_at, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [sessionId, userId, now, expiresAt, now, userAgent ? String(userAgent).slice(0, 300) : null],
  );
  execute('UPDATE users SET last_login_at = ? WHERE user_id = ?', [now, userId]);
  return { sessionId, expiresAt };
}

function destroySession(sessionId) {
  execute('DELETE FROM sessions WHERE session_id = ?', [sessionId]);
}

function setPassword(userId, newPassword, { mustChange = false, actor = null, reason = 'PASSWORD_CHANGE' } = {}) {
  if (!newPassword || String(newPassword).length < 10) {
    throw validation('Password minimal 10 karakter', [{ field: 'newPassword', message: 'Minimal 10 karakter' }]);
  }
  const before = getUserRow(userId);
  if (!before) throw new AppError('NOT_FOUND', 404, 'User tidak ditemukan');
  const now = nowIso();
  const hash = hashPassword(newPassword);
  execute(
    'UPDATE users SET password_hash = ?, must_change_password = ?, updated_at = ?, updated_by = ? WHERE user_id = ?',
    [hash, mustChange ? 1 : 0, now, actor?.userId || null, userId],
  );
  execute('DELETE FROM sessions WHERE user_id = ?', [userId]);
  recordAudit({
    entityType: 'USER',
    entityId: userId,
    action: 'UPDATE',
    actor,
    before: { mustChangePassword: before.must_change_password === 1 },
    after: { mustChangePassword: mustChange, passwordChanged: true },
    reason,
  });
}

function changeOwnPassword(user, currentPassword, newPassword) {
  const row = getUserRow(user.userId);
  if (!row) throw new AppError('NOT_FOUND', 404, 'User tidak ditemukan');
  if (!verifyPassword(currentPassword, row.password_hash)) {
    throw new AppError('AUTH_REQUIRED', 401, 'Password saat ini salah');
  }
  setPassword(user.userId, newPassword, { mustChange: false, actor: user, reason: 'PASSWORD_CHANGE' });
}

function userPayload(row, roleName) {
  const user = userFromRow(row);
  if (roleName) user.roleName = roleName;
  return user;
}

function logLogin(user, req) {
  recordAudit({
    entityType: 'USER',
    entityId: user.userId,
    action: 'LOGIN',
    actor: user,
    after: { email: user.email, roleKey: user.roleKey },
    ipAddress: req?.ip || null,
  });
}

module.exports = {
  findUserByEmail,
  getUserRow,
  getUser,
  authenticate,
  createSession,
  destroySession,
  setPassword,
  changeOwnPassword,
  userPayload,
  logLogin,
  parseJson,
  newId,
};
