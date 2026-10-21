'use strict';
/**
 * Pembacaan file upload menjadi { headers, rows:[{rowNumber, values}], sheetName }.
 * CSV memakai parser RFC4180-ish internal (quotes, escaped quotes, CRLF, BOM);
 * XLSX memakai exceljs (worksheet pertama, baris pertama = header).
 */
const path = require('node:path');
const ExcelJS = require('exceljs');
const { AppError } = require('../middleware/errors');

function parseCsvRecords(text) {
  const records = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  let started = false;

  const pushField = () => { row.push(field); field = ''; started = true; };
  const pushRecord = () => {
    pushField();
    records.push({ line: recordLine, cells: row });
    row = [];
    started = false;
    recordLine = line + 1;
  };

  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (inQuotes) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === '\n') line += 1;
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      started = true;
    } else if (ch === ',') {
      pushField();
    } else if (ch === '\r') {
      if (source[i + 1] === '\n') i += 1;
      pushRecord();
      line += 1;
    } else if (ch === '\n') {
      pushRecord();
      line += 1;
    } else {
      field += ch;
      started = true;
    }
  }
  if (started || field !== '' || row.length > 0) pushRecord();
  return records;
}

function isBlankRecord(cells) {
  return cells.every((cell) => String(cell).trim() === '');
}

function parseCsv(buffer) {
  const records = parseCsvRecords(buffer.toString('utf8'));
  const headerIndex = records.findIndex((record) => !isBlankRecord(record.cells));
  if (headerIndex < 0) {
    throw new AppError('UPLOAD_INVALID', 422, 'File CSV kosong: header tidak ditemukan');
  }
  const headerRecord = records[headerIndex];
  const headers = headerRecord.cells.map((h) => String(h).replace(/^\ufeff/, '').trim());
  const rows = [];
  const warnings = [];
  const seen = new Set();
  headers.forEach((header, index) => {
    if (!header) warnings.push({ field: `column_${index + 1}`, message: 'Header kosong diabaikan' });
    else if (seen.has(header.toLowerCase())) {
      warnings.push({ field: header, message: 'Header duplikat; nilai pertama yang dipakai' });
    } else {
      seen.add(header.toLowerCase());
    }
  });
  for (let i = headerIndex + 1; i < records.length; i += 1) {
    const record = records[i];
    if (isBlankRecord(record.cells)) continue;
    const values = {};
    headers.forEach((header, index) => {
      if (!header || values[header] !== undefined) return;
      const cell = record.cells[index];
      values[header] = cell === undefined ? '' : cell;
    });
    rows.push({ rowNumber: record.line, values });
  }
  return { headers: headers.filter(Boolean), rows, sheetName: null, warnings, format: 'csv' };
}

function coerceCellValue(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text || '').join('');
    if (value.text !== undefined) return String(value.text);
    if (value.result !== undefined) return coerceCellValue(value.result);
    if (value.error) return '';
    if (value.hyperlink !== undefined && value.text === undefined) return String(value.hyperlink);
    return String(value);
  }
  return value;
}

async function parseXlsx(buffer, fileName) {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw new AppError('UPLOAD_INVALID', 422, `File ${fileName || 'XLSX'} tidak dapat dibaca sebagai workbook XLSX yang valid`);
  }
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new AppError('UPLOAD_INVALID', 422, 'File XLSX tidak memiliki worksheet');
  }
  const headerRow = worksheet.getRow(1);
  const headers = [];
  const warnings = [];
  const seen = new Set();
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    const header = String(coerceCellValue(cell.value)).trim();
    headers[colNumber - 1] = header;
    if (!header) {
      warnings.push({ field: `column_${colNumber}`, message: 'Header kosong diabaikan' });
    } else if (seen.has(header.toLowerCase())) {
      warnings.push({ field: header, message: 'Header duplikat; nilai pertama yang dipakai' });
    } else {
      seen.add(header.toLowerCase());
    }
  });
  const rows = [];
  const lastRow = Math.max(worksheet.actualRowCount || 0, worksheet.rowCount || 0);
  for (let r = 2; r <= lastRow; r += 1) {
    const row = worksheet.getRow(r);
    const values = {};
    let hasValue = false;
    headers.forEach((header, idx) => {
      if (!header) return;
      const value = coerceCellValue(row.getCell(idx + 1).value);
      if (value !== '' && value !== null && value !== undefined) hasValue = true;
      if (values[header] === undefined) values[header] = value;
    });
    if (!hasValue) continue;
    rows.push({ rowNumber: r, values });
  }
  return { headers: headers.filter(Boolean), rows, sheetName: worksheet.name, warnings, format: 'xlsx' };
}

async function parseFile(buffer, fileName) {
  if (!buffer || buffer.length === 0) {
    throw new AppError('UPLOAD_INVALID', 422, 'File kosong');
  }
  const ext = path.extname(String(fileName || '')).toLowerCase();
  if (ext === '.csv') return parseCsv(buffer);
  if (ext === '.xlsx') return parseXlsx(buffer, fileName);
  if (ext === '.xls') {
    throw new AppError('UPLOAD_INVALID', 422, 'Format .xls lama tidak didukung; simpan ulang sebagai .xlsx atau .csv');
  }
  throw new AppError('UPLOAD_INVALID', 422, `Ekstensi file tidak didukung: ${ext || '(tanpa ekstensi)'}`);
}

module.exports = { parseFile, parseCsv, parseXlsx, coerceCellValue };
