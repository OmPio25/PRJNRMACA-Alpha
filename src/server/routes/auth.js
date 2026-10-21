'use strict';
const express = require('express');
const config = require('../config');
const { asyncHandler, authRequired, AppError, validation } = require('../middleware/errors');
const { parseBody, ok } = require('../util/http');
const { requireAuth } = require('../middleware/auth');
const rbac = require('../middleware/rbac');
const rateLimit = require('../middleware/rateLimit');
const identity = require('../services/identity');
const { serializeUser } = require('../util/serialize');

const router = express.Router();

router.post('/login', asyncHandler(async (req, res) => {
  const body = parseBody(req.body, {
    email: { type: 'string', required: true, email: true, maxLength: 200 },
    password: { type: 'string', required: true, maxLength: 200 },
  });
  const ip = req.ip;
  const limit = rateLimit.check(body.email, ip);
  if (!limit.allowed) {
    throw new AppError('RATE_LIMITED', 429, 'Terlalu banyak percobaan login. Coba lagi dalam 5 menit.', null);
  }
  const user = identity.authenticate(body.email, body.password);
  if (!user) {
    rateLimit.recordFailure(body.email, ip);
    throw authRequired('Email atau password salah');
  }
  rateLimit.reset(body.email, ip);
  const session = identity.createSession(user.userId, req.headers['user-agent']);
  res.cookie(config.cookieName, session.sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: config.cookieSecure,
    maxAge: config.sessionTtlMs,
  });
  identity.logLogin(user, req);
  ok(res, { user: serializeUser(identity.getUserRow(user.userId)) });
}));

router.get('/me', asyncHandler(async (req, res) => {
  if (!req.user) throw authRequired();
  req._permissions = rbac.attachPermissions(req);
  const row = identity.getUserRow(req.user.userId);
  if (!row) throw authRequired();
  ok(res, {
    user: serializeUser(row),
    permissions: rbac.permissionsList(req.user),
    roles: [row.role_key],
  });
}));

router.post('/logout', requireAuth, asyncHandler(async (req, res) => {
  identity.destroySession(req.sessionId);
  res.clearCookie(config.cookieName, { path: '/' });
  ok(res, { loggedOut: true });
}));

router.post('/change-password', requireAuth, asyncHandler(async (req, res) => {
  const body = parseBody(req.body, {
    currentPassword: { type: 'string', required: true },
    newPassword: { type: 'string', required: true, minLength: 10 },
  });
  if (body.currentPassword === body.newPassword) {
    throw validation('Password baru harus berbeda dari password saat ini', [
      { field: 'newPassword', message: 'Harus berbeda' },
    ]);
  }
  identity.changeOwnPassword(req.user, body.currentPassword, body.newPassword);
  res.clearCookie(config.cookieName, { path: '/' });
  ok(res, { changed: true });
}));

module.exports = router;
