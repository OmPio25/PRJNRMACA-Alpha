'use strict';
/**
 * Canonical hash + normalization primitives.
 * Single source of truth: dipakai oleh db/seed.js dan src/server/services/*.
 */
const crypto = require('node:crypto');

const SEPARATOR = '\u001f'; // unit separator, aman dari nilai teks biasa

/**
 * Serialisasi kanonik: JSON array nilai ternormalisasi (null tetap null),
 * digabung dengan unit separator, lalu SHA-256.
 * @param {Array<string|number|null>} values
 * @returns {string} 'sha256:<hex>'
 */
function canonicalHash(values) {
  const serialized = values.map((v) => (v === undefined ? null : v)).map((v) => JSON.stringify(v)).join(SEPARATOR);
  return 'sha256:' + crypto.createHash('sha256').update(serialized, 'utf8').digest('hex');
}

function sha256Hex(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function businessKey(parts) {
  return parts
    .map((p) => (p === null || p === undefined ? '' : String(p).trim().toUpperCase()))
    .join('|');
}

/** Nominal -> integer minor unit (x100). Menerima '1.000.000,50', '1,000,000.50', '(1.000)', 1000.5 */
function toMinorUnits(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return null;
    return Math.round(raw * 100);
  }
  let s = String(raw).trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1).trim(); }
  if (s.startsWith('-')) { negative = true; s = s.slice(1).trim(); }
  s = s.replace(/[RpUS$\s]/gi, '');
  if (!s) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma > -1) {
    const digits = s.length - lastComma - 1;
    s = digits === 3 && !String(raw).trim().includes(',') ? s.replace(/,/g, '') : s.replace(',', '.');
    if (digits === 3 && /,\d{3}$/.test(String(raw).trim())) s = String(raw).replace(/[.,]/g, '');
  } else if (lastDot > -1) {
    const digits = s.length - lastDot - 1;
    if (digits === 3 && !/\.\d{1,2}$/.test(s)) s = s.replace(/\./g, '');
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const value = Number(s);
  if (!Number.isFinite(value)) return null;
  const minor = Math.round(value * 100);
  return negative ? -minor : minor;
}

function fromMinorUnits(minor) {
  if (minor === null || minor === undefined) return null;
  return Number((Number(minor) / 100).toFixed(2));
}

module.exports = { canonicalHash, sha256Hex, businessKey, toMinorUnits, fromMinorUnits, SEPARATOR };
