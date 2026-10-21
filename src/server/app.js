'use strict';
/** Factory aplikasi Express (dipakai server dan test). */
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');
const config = require('./config');
const { AppError, errorHandler } = require('./middleware/errors');
const { loadSession } = require('./middleware/auth');

function requestId(req, res, next) {
  req.requestId = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);

  app.use(requestId);
  app.use(express.json({ limit: config.jsonBodyLimit }));
  app.use(loadSession);

  // Static SPA (public/ dimiliki Front-end; boleh belum ada saat boot).
  app.use(express.static(config.publicDir, { index: 'index.html', fallthrough: true }));

  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/uploads', require('./routes/uploads'));
  app.use('/api/agents', require('./routes/agents'));
  app.use('/api/production', require('./routes/production'));
  app.use('/api/claims', require('./routes/claims'));
  app.use('/api/reports', require('./routes/reports'));
  app.use('/api/audit', require('./routes/audit'));
  app.use('/api/admin', require('./routes/admin'));
  app.use('/api/dashboard', require('./routes/dashboard'));

  // Endpoint API yang tidak dikenal.
  app.use('/api', (req, res, next) => {
    next(new AppError('NOT_FOUND', 404, `Endpoint API tidak ditemukan: ${req.method} ${req.originalUrl}`));
  });

  // SPA fallback untuk GET non-API.
  app.get('*', (req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
    const indexFile = path.join(config.publicDir, 'index.html');
    if (!fs.existsSync(indexFile)) {
      return res.status(404).type('text/plain').send('Not Found');
    }
    return res.sendFile(indexFile);
  });

  app.use((req, res, next) => {
    next(new AppError('NOT_FOUND', 404, 'Halaman tidak ditemukan'));
  });

  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
