'use strict';
/**
 * Error domain aplikasi + async wrapper + central error handler.
 * Envelope kontrak: { ok:false, error:{ code, message, details } }.
 */
const config = require('../config');

const STATUS_BY_CODE = {
  AUTH_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  CONFLICT: 409,
  INVALID_STATE: 409,
  UPLOAD_INVALID: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

class AppError extends Error {
  constructor(code, status, message, details = null) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status || STATUS_BY_CODE[code] || 500;
    this.details = details;
  }
}

function validation(message, details = null) {
  return new AppError('VALIDATION_ERROR', 400, message, details);
}

function notFound(message = 'Data tidak ditemukan') {
  return new AppError('NOT_FOUND', 404, message);
}

function forbidden(message = 'Anda tidak memiliki izin untuk aksi ini') {
  return new AppError('FORBIDDEN', 403, message);
}

function authRequired(message = 'Sesi tidak ditemukan atau sudah berakhir') {
  return new AppError('AUTH_REQUIRED', 401, message);
}

function invalidState(message) {
  return new AppError('INVALID_STATE', 409, message);
}

function conflict(message, details = null) {
  return new AppError('CONFLICT', 409, message, details);
}

/** Bungkus handler async agar error diteruskan ke central handler. */
function asyncHandler(handler) {
  return function wrapped(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function sendError(res, err) {
  const body = {
    ok: false,
    error: {
      code: err.code,
      message: err.message,
    },
  };
  if (err.details !== undefined && err.details !== null) body.error.details = err.details;
  res.status(err.status).json(body);
}

/** Central error handler: tidak pernah mengirim stack trace / SQL ke klien. */
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (res.headersSent) {
    if (typeof next === 'function') next(err);
    return;
  }
  if (err instanceof AppError) {
    sendError(res, err);
    return;
  }
  if (err && err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      sendError(res, new AppError(
        'UPLOAD_INVALID', 422,
        `Ukuran file melebihi batas ${Math.round(config.maxUploadBytes / (1024 * 1024))} MB`,
        [{ field: 'file', message: 'Ukuran file terlalu besar' }],
      ));
      return;
    }
    sendError(res, new AppError('UPLOAD_INVALID', 422, 'File upload tidak valid', [{ field: 'file', message: err.code }]));
    return;
  }
  if (err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError) && err.status >= 400 && err.status < 500) {
    sendError(res, validation('Body JSON tidak valid'));
    return;
  }
  if (err && err.type === 'entity.too.large') {
    sendError(res, validation('Body request melebihi batas ukuran'));
    return;
  }
  if (config.env !== 'test') {
    // Log internal saja; detail teknis tidak pernah dikirim ke klien.
    console.error(`[error] ${req.method} ${req.originalUrl} requestId=${req.requestId || '-'}`, err);
  }
  sendError(res, new AppError('INTERNAL_ERROR', 500, 'Terjadi kesalahan internal. Silakan coba lagi atau hubungi administrator.'));
}

module.exports = {
  AppError,
  STATUS_BY_CODE,
  validation,
  notFound,
  forbidden,
  authRequired,
  invalidState,
  conflict,
  asyncHandler,
  errorHandler,
};
