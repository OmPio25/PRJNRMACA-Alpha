'use strict';
/** RBAC: lookup izin dari role_permissions, cache per request. */
const { queryAll } = require('../../../db/database');

function getPermissions(roleKey) {
  if (!roleKey) return new Set();
  const rows = queryAll('SELECT permission FROM role_permissions WHERE role_key = ?', [roleKey]);
  return new Set(rows.map((r) => r.permission));
}

function attachPermissions(req) {
  if (!req.user) return new Set();
  if (!req._permissions) req._permissions = getPermissions(req.user.roleKey);
  return req._permissions;
}

/** can(user, permission) — user boleh berupa req.user atau objek user. */
function can(user, permission) {
  if (!user || !permission) return false;
  if (user._permissions instanceof Set) return user._permissions.has(permission);
  return getPermissions(user.roleKey).has(permission);
}

function permissionsList(user) {
  if (!user) return [];
  if (user._permissions instanceof Set) return [...user._permissions].sort();
  return [...getPermissions(user.roleKey)].sort();
}

module.exports = { getPermissions, attachPermissions, can, permissionsList };
