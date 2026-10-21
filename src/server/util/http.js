'use strict';
/**
 * Utilitas HTTP: envelope respons, paginasi, whitelist sorting, validasi body.
 * Semua validasi bentuk request berada di sini agar route tetap tipis.
 */
const config = require('../config');
const { AppError, validation } = require('../middleware/errors');

function ok(res, data, status = 200) {
  res.status(status).json({ ok: true, data });
}

function paged(res, rows, page, pageSize, total) {
  ok(res, {
    rows,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
}

function parsePaging(query = {}) {
  let page = 1;
  let pageSize = config.defaultPageSize;
  if (query.page !== undefined && query.page !== '') {
    page = Number.parseInt(query.page, 10);
    if (!Number.isFinite(page) || page < 1) {
      throw validation('Parameter page tidak valid', [{ field: 'page', message: 'Harus bilangan bulat >= 1' }]);
    }
  }
  if (query.pageSize !== undefined && query.pageSize !== '') {
    pageSize = Number.parseInt(query.pageSize, 10);
    if (!Number.isFinite(pageSize) || pageSize < 1 || pageSize > config.maxPageSize) {
      throw validation(`Parameter pageSize tidak valid (maks ${config.maxPageSize})`, [
        { field: 'pageSize', message: `Harus bilangan bulat 1..${config.maxPageSize}` },
      ]);
    }
  }
  return { page, pageSize, limit: pageSize, offset: (page - 1) * pageSize };
}

/**
 * Sorting whitelist. `whitelist` memetakan key publik -> ekspresi SQL yang aman.
 * @returns {{key:string, order:'ASC'|'DESC', clause:string}}
 */
function parseSort(sort, order, whitelist, defaultKey) {
  const key = sort === undefined || sort === null || sort === '' ? defaultKey : String(sort);
  if (!Object.prototype.hasOwnProperty.call(whitelist, key)) {
    throw validation(`Parameter sort tidak valid: ${key}`, [{ field: 'sort', message: 'Kolom sort tidak diizinkan' }]);
  }
  const dir = order === undefined || order === null || order === '' ? 'asc' : String(order).toLowerCase();
  if (dir !== 'asc' && dir !== 'desc') {
    throw validation('Parameter order tidak valid', [{ field: 'order', message: 'Gunakan asc atau desc' }]);
  }
  const direction = dir === 'desc' ? 'DESC' : 'ASC';
  return { key, order: direction, clause: `${whitelist[key]} ${direction}` };
}

function parseIdList(value) {
  if (value === undefined || value === null || value === '') return [];
  const raw = Array.isArray(value) ? value : String(value).split(',');
  return raw.map((v) => String(v).trim().toUpperCase()).filter(Boolean);
}

function parseDateParam(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const s = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw validation(`Parameter ${field} tidak valid`, [{ field, message: 'Gunakan format YYYY-MM-DD' }]);
  }
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw validation(`Parameter ${field} tidak valid`, [{ field, message: 'Tanggal tidak ada di kalender' }]);
  }
  return s;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validasi body: tolak field tak dikenal, periksa tipe/enum/panjang.
 * @param {object} body
 * @param {object} spec { field: { type, required, enum, minLength, maxLength, min, max, of, default } }
 */
function parseBody(body, spec) {
  if (body === undefined || body === null) body = {};
  if (typeof body !== 'object' || Array.isArray(body)) {
    throw validation('Body harus berupa objek JSON');
  }
  const allowed = Object.keys(spec);
  const extras = Object.keys(body).filter((k) => !allowed.includes(k));
  if (extras.length > 0) {
    throw validation(`Field tidak diizinkan: ${extras.join(', ')}`, extras.map((field) => ({
      field,
      message: 'Field tidak dikenal',
    })));
  }
  const out = {};
  const details = [];
  for (const [field, rule] of Object.entries(spec)) {
    let value = body[field];
    const blank = value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
    if (blank) {
      if (rule.required) {
        details.push({ field, message: 'Wajib diisi' });
      } else if (rule.default !== undefined) {
        out[field] = typeof rule.default === 'function' ? rule.default() : rule.default;
      }
      continue;
    }
    switch (rule.type) {
      case 'string': {
        if (typeof value !== 'string') {
          details.push({ field, message: 'Harus berupa teks' });
          break;
        }
        value = value.trim();
        if (rule.enum && !rule.enum.includes(value)) {
          details.push({ field, message: `Nilai harus salah satu dari: ${rule.enum.join(', ')}` });
          break;
        }
        if (rule.maxLength && value.length > rule.maxLength) {
          details.push({ field, message: `Maksimal ${rule.maxLength} karakter` });
          break;
        }
        if (rule.minLength && value.length < rule.minLength) {
          details.push({ field, message: `Minimal ${rule.minLength} karakter` });
          break;
        }
        if (rule.email && !EMAIL_RE.test(value)) {
          details.push({ field, message: 'Format email tidak valid' });
          break;
        }
        out[field] = value;
        break;
      }
      case 'int': {
        const n = typeof value === 'number' ? value : Number(String(value).trim());
        if (!Number.isInteger(n)) {
          details.push({ field, message: 'Harus bilangan bulat' });
          break;
        }
        if (rule.min !== undefined && n < rule.min) {
          details.push({ field, message: `Minimal ${rule.min}` });
          break;
        }
        if (rule.max !== undefined && n > rule.max) {
          details.push({ field, message: `Maksimal ${rule.max}` });
          break;
        }
        out[field] = n;
        break;
      }
      case 'number': {
        const n = typeof value === 'number' ? value : Number(String(value).trim());
        if (!Number.isFinite(n)) {
          details.push({ field, message: 'Harus berupa angka' });
          break;
        }
        if (rule.min !== undefined && n < rule.min) {
          details.push({ field, message: `Minimal ${rule.min}` });
          break;
        }
        out[field] = n;
        break;
      }
      case 'bool': {
        if (typeof value !== 'boolean') {
          details.push({ field, message: 'Harus boolean' });
          break;
        }
        out[field] = value;
        break;
      }
      case 'array': {
        if (!Array.isArray(value)) {
          details.push({ field, message: 'Harus berupa array' });
          break;
        }
        const items = [];
        for (const item of value) {
          if (rule.of === 'string') {
            if (typeof item !== 'string') {
              details.push({ field, message: 'Semua item harus teks' });
              break;
            }
            const s = item.trim();
            if (!s) continue;
            if (rule.upper) items.push(s.toUpperCase());
            else items.push(s);
          } else if (rule.of === 'object') {
            if (!item || typeof item !== 'object' || Array.isArray(item)) {
              details.push({ field, message: 'Semua item harus objek' });
              break;
            }
            items.push(item);
          } else {
            items.push(item);
          }
        }
        if (rule.enum && items.some((it) => !rule.enum.includes(it))) {
          details.push({ field, message: `Nilai harus salah satu dari: ${rule.enum.join(', ')}` });
          break;
        }
        out[field] = items;
        break;
      }
      case 'object': {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          details.push({ field, message: 'Harus berupa objek' });
          break;
        }
        out[field] = value;
        break;
      }
      default:
        out[field] = value;
    }
  }
  if (details.length > 0) {
    throw new AppError('VALIDATION_ERROR', 400, 'Data yang dikirim tidak valid', details);
  }
  return out;
}

/** Pastikan body tidak berisi field di luar daftar (untuk PATCH parsial). */
function assertNoExtraFields(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw validation('Body harus berupa objek JSON');
  }
  const extras = Object.keys(body).filter((k) => !allowed.includes(k));
  if (extras.length > 0) {
    throw validation(`Field tidak diizinkan: ${extras.join(', ')}`, extras.map((field) => ({
      field,
      message: 'Field tidak dikenal',
    })));
  }
}

function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, (m) => `\\${m}`);
}

module.exports = {
  ok,
  paged,
  parsePaging,
  parseSort,
  parseIdList,
  parseDateParam,
  parseBody,
  assertNoExtraFields,
  escapeLike,
};
