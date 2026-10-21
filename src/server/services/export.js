'use strict';
/** Rendering CSV: UTF-8 BOM, quoting RFC4180, header Content-Disposition attachment. */

function cellValue(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function escapeCell(value) {
  const text = cellValue(value);
  if (/[",\r\n;]/.test(text) || /^\s|\s$/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * @param {Array<string|{key:string,label?:string}>} columns
 * @param {Array<object|Array>} rows
 * @returns {string} CSV lengkap dengan BOM
 */
function toCsv(columns, rows) {
  const cols = columns.map((column) => (typeof column === 'string' ? { key: column, label: column } : column));
  const headerLine = cols.map((column) => escapeCell(column.label || column.key)).join(',');
  const lines = [headerLine];
  for (const row of rows) {
    const cells = cols.map((column) => {
      if (Array.isArray(row)) return escapeCell(row[cols.indexOf(column)]);
      return escapeCell(row[column.key]);
    });
    lines.push(cells.join(','));
  }
  return `\ufeff${lines.join('\r\n')}\r\n`;
}

function sanitizeFilename(filename) {
  const cleaned = String(filename || 'export.csv').replace(/[\r\n"]/g, '').replace(/[\\/]/g, '_');
  return cleaned || 'export.csv';
}

function sendCsv(res, filename, columns, rows) {
  const csv = toCsv(columns, rows);
  const safe = sanitizeFilename(filename.endsWith('.csv') ? filename : `${filename}.csv`);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safe}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Length', Buffer.byteLength(csv, 'utf8'));
  res.status(200).end(csv);
}

function sendTextCsv(res, filename, csvText) {
  const safe = sanitizeFilename(filename.endsWith('.csv') ? filename : `${filename}.csv`);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safe}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).end(csvText);
}

module.exports = { toCsv, sendCsv, sendTextCsv, escapeCell, sanitizeFilename };
