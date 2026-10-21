'use strict';
/**
 * Normalisasi nilai per baris sesuai ARCHITECTURE §4.1.
 * Hasil: { normalized, errors:[{field,message,pending?}], warnings:[] }.
 * Kode uppercase, deskripsi bebas mempertahankan kapitalisasi, tanggal ISO,
 * nominal integer minor unit, null konsisten.
 */
const { queryAll, queryOne } = require('../../../db/database');
const { toMinorUnits } = require('../../../db/canonical');
const { loadRules } = require('./settings');
const { parseJson } = require('../util/serialize');

const BLANK_TOKENS = new Set(['', '-', 'N/A', 'NA', 'NULL', 'NIL', 'NONE']);

const DATE_FORMATS = ['DD/MM/YYYY', 'DD-MM-YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'];

const TXN_TYPE_MAP = new Map([
  ['new business', 'New Business'],
  ['renewal', 'Renewal'],
  ['endorsement increase', 'Endorsement Increase'],
  ['endorsement decrease', 'Endorsement Decrease'],
  ['cancellation', 'Cancellation'],
  ['refund', 'Refund'],
  ['reinstatement', 'Reinstatement'],
  ['correction', 'Correction'],
]);

const AGENT_STATUS_MAP = new Map([
  ['active', 'Active'],
  ['inactive', 'Inactive'],
]);

const FIELD_SPECS = {
  AGENT: [
    { key: 'KODEAGEN', kind: 'code', required: true },
    { key: 'AgentIDSource', kind: 'code' },
    { key: 'NamaAgent', kind: 'text' },
    { key: 'Cabang', kind: 'branch' },
    { key: 'StatusAgent', kind: 'agentStatus' },
  ],
  PRODUCTION: [
    { key: 'PolicyNo', kind: 'code', required: true },
    { key: 'PolicyRiskID', kind: 'code', required: true },
    { key: 'TransactionDate', kind: 'date' },
    { key: 'EffectiveDate', kind: 'date', required: true },
    { key: 'ExpiryDate', kind: 'date' },
    { key: 'TransactionType', kind: 'transactionType', required: true },
    { key: 'Product', kind: 'product' },
    { key: 'Coverage', kind: 'coverage' },
    { key: 'VehicleOrRiskDescription', kind: 'text' },
    { key: 'TSI', kind: 'amount' },
    { key: 'Premium', kind: 'amount' },
    { key: 'Currency', kind: 'currency', required: true },
    { key: 'KodeAgen', kind: 'code' },
    { key: 'Cabang', kind: 'branch' },
  ],
  CLAIM: [
    { key: 'ClaimNo', kind: 'code', required: true },
    { key: 'PolicyNo', kind: 'code', required: true },
    { key: 'SettlementNo', kind: 'code' },
    { key: 'SettlementDate', kind: 'date', required: true },
    { key: 'Currency', kind: 'currency', required: true },
    { key: 'GrossClaim', kind: 'amount' },
    { key: 'Indemnity', kind: 'amount' },
    { key: 'Deductible', kind: 'amount' },
    { key: 'Salvage', kind: 'amount' },
    { key: 'Subrogation', kind: 'amount' },
    { key: 'UWYear', kind: 'year' },
    { key: 'ProductAtLoss', kind: 'product' },
    { key: 'CoverageAtLoss', kind: 'coverage' },
    { key: 'TSIAtLoss', kind: 'amount' },
    { key: 'CauseOfLoss', kind: 'cause' },
    { key: 'LossDate', kind: 'date' },
    { key: 'ClaimStatus', kind: 'text' },
    { key: 'KodeAgen', kind: 'code' },
    { key: 'Cabang', kind: 'branch' },
  ],
};

const EXTRA_ALIASES = {
  PRODUCTION: {
    KodeAgen: ['KODEAGEN', 'AgentCode', 'Kode Agent'],
    PolicyNo: ['Policy Number', 'No Polis', 'NoPolis'],
    PolicyRiskID: ['Policy Risk ID', 'RiskID', 'Risk ID'],
    EffectiveDate: ['Effective Date', 'Tanggal Efektif'],
    ExpiryDate: ['Expiry Date', 'Expired Date', 'Tanggal Akhir'],
    TransactionDate: ['Transaction Date', 'Tanggal Transaksi'],
    TransactionType: ['Transaction Type', 'Jenis Transaksi'],
    VehicleOrRiskDescription: ['Vehicle Or Risk Description', 'Description', 'Deskripsi Risiko'],
  },
  CLAIM: {
    ClaimNo: ['Claim Number', 'No Claim', 'NoKlaim'],
    PolicyNo: ['Policy Number', 'No Polis'],
    SettlementDate: ['Date Of Settlement', 'Tanggal Settlement', 'Tanggal Settlement'],
    SettlementNo: ['Settlement Number', 'No Settlement'],
    GrossClaim: ['Gross Claim', 'Nilai Klaim'],
    CauseOfLoss: ['Cause Of Loss', 'Penyebab Kerugian'],
    UWYear: ['UW Year', 'Underwriting Year', 'Tahun UW'],
    ProductAtLoss: ['Product At Loss'],
    CoverageAtLoss: ['Coverage At Loss'],
    TSIAtLoss: ['TSI At Loss'],
  },
  AGENT: {
    KODEAGEN: ['Kode Agen', 'Agent Code', 'AgentID'],
    AgentIDSource: ['Agent ID Source', 'Agent Id', 'AgentID'],
    NamaAgent: ['Nama Agent', 'Agent Name'],
    StatusAgent: ['Status Agent', 'Status'],
  },
};

function headerKey(value) {
  return String(value === null || value === undefined ? '' : value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function specFor(uploadType) {
  const spec = FIELD_SPECS[uploadType];
  if (!spec) throw new Error(`Jenis upload tidak dikenal: ${uploadType}`);
  return spec;
}

function buildFieldIndex(uploadType) {
  const index = new Map();
  for (const field of specFor(uploadType)) {
    index.set(headerKey(field.key), field.key);
    for (const alias of EXTRA_ALIASES[uploadType]?.[field.key] || []) {
      index.set(headerKey(alias), field.key);
    }
  }
  return index;
}

function unknownHeaders(uploadType, headers) {
  const index = buildFieldIndex(uploadType);
  return (headers || []).filter((h) => h && !index.has(headerKey(h)));
}

function isBlank(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'number') return false;
  return BLANK_TOKENS.has(String(value).trim().toUpperCase());
}

function cleanText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text === '' ? null : text;
}

function cleanCode(value) {
  const text = cleanText(value);
  return text === null ? null : text.toUpperCase();
}

function parseDateValue(raw, dateFormat) {
  if (raw === null || raw === undefined || isBlank(raw)) return { value: null };
  let text;
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return { error: 'Tanggal tidak valid' };
    return { value: raw.toISOString().slice(0, 10) };
  }
  if (typeof raw === 'number') {
    return { error: `Tanggal tidak valid: ${raw} (sel tanggal harus diformat sebagai tanggal)` };
  }
  text = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) text = text.slice(0, 10);

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) {
    const [, y, m, d] = iso;
    const value = `${y}-${m}-${d}`;
    return isValidCalendarDate(Number(y), Number(m), Number(d))
      ? { value }
      : { error: `Tanggal tidak valid: ${text}` };
  }

  if (!dateFormat) {
    if (/[\/.]/.test(text)) {
      return { error: `Tanggal '${text}' ambigu; tentukan format tanggal batch (dateFormat)` };
    }
    return { error: `Tanggal tidak valid: ${text}` };
  }

  const format = String(dateFormat).toUpperCase();
  let match = null;
  let year;
  let month;
  let day;
  if (format === 'DD/MM/YYYY') {
    match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
    if (match) [, day, month, year] = match;
  } else if (format === 'DD-MM-YYYY') {
    match = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(text);
    if (match) [, day, month, year] = match;
  } else if (format === 'MM/DD/YYYY') {
    match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
    if (match) [, month, day, year] = match;
  } else if (format === 'YYYY-MM-DD') {
    match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (match) [, year, month, day] = match;
  }
  if (!match) {
    return { error: `Tanggal '${text}' tidak sesuai format ${format}` };
  }
  if (!isValidCalendarDate(Number(year), Number(month), Number(day))) {
    return { error: `Tanggal tidak valid: ${text}` };
  }
  return {
    value: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  };
}

function isValidCalendarDate(year, month, day) {
  if (year < 1900 || year > 2200) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function parseAmountValue(raw) {
  if (raw === null || raw === undefined || isBlank(raw)) return { value: null };
  if (typeof raw === 'number' && !Number.isFinite(raw)) return { error: 'Nominal tidak valid' };
  const minor = toMinorUnits(raw);
  if (minor === null) return { error: `Nominal tidak valid: ${String(raw).trim()}` };
  if (minor < 0) return { error: `Nominal tidak boleh negatif: ${String(raw).trim()}` };
  return { value: minor };
}

function parseYearValue(raw) {
  if (raw === null || raw === undefined || isBlank(raw)) return { value: null };
  const n = Number(String(raw).trim());
  if (!Number.isInteger(n) || n < 1900 || n > 2200) return { error: `Tahun tidak valid: ${String(raw).trim()}` };
  return { value: n };
}

function loadMappings() {
  const rows = queryAll('SELECT mapping_type, source_code, internal_code FROM master_mapping WHERE is_active = 1');
  const maps = { PRODUCT: new Map(), BRANCH: new Map(), COVERAGE: new Map(), CAUSE_OF_LOSS: new Map(), CURRENCY: new Map() };
  for (const row of rows) {
    if (!maps[row.mapping_type]) continue;
    maps[row.mapping_type].set(String(row.source_code).toUpperCase(), row.internal_code);
  }
  return maps;
}

function loadMasters() {
  const toSet = (rows, column) => new Set(rows.map((row) => row[column]));
  return {
    products: toSet(queryAll('SELECT product_code FROM master_product WHERE is_active = 1'), 'product_code'),
    branches: toSet(queryAll('SELECT branch_code FROM master_branch WHERE is_active = 1'), 'branch_code'),
    coverages: toSet(queryAll('SELECT coverage_code FROM master_coverage WHERE is_active = 1'), 'coverage_code'),
    causes: toSet(queryAll('SELECT cause_code FROM master_cause_of_loss WHERE is_active = 1'), 'cause_code'),
    currencies: toSet(queryAll('SELECT currency_code FROM master_currency WHERE is_active = 1'), 'currency_code'),
  };
}

function findAgentByCode(code) {
  if (!code) return null;
  return queryOne(
    `SELECT agent_id_internal, agent_key, kodeagen, agent_id_source, nama_agent, branch_code, status_agent
       FROM master_agent
      WHERE agent_key = ? OR kodeagen = ? OR agent_id_source = ?
      LIMIT 1`,
    [code, code, code],
  );
}

function loadNormalizationContext(options = {}) {
  return {
    dateFormat: options.dateFormat || null,
    rules: loadRules(),
    mappings: loadMappings(),
    masters: loadMasters(),
    fieldIndex: null,
    findAgent: findAgentByCode,
  };
}

function resolveReference(raw, opts) {
  const { field, rule, ctx } = opts;
  const code = cleanCode(raw);
  if (code === null) return { value: null };
  const mapping = ctx.mappings[opts.mappingType];
  const mapped = mapping && mapping.has(code) ? String(mapping.get(code)).toUpperCase() : code;
  const masterSet = ctx.masters[opts.masterKey];
  if (masterSet && masterSet.has(mapped)) return { value: mapped };
  const label = opts.label || field;
  const message = `${label} '${code}' tidak ditemukan di master`;
  if (ctx.rules.rejectUnknownProduct === false) {
    return { value: mapped, error: { field, message, pending: true } };
  }
  return { error: { field, message } };
}

function normalizeRow(uploadType, rawValues, ctx) {
  const spec = specFor(uploadType);
  const index = buildFieldIndex(uploadType);
  const normalized = {};
  for (const field of spec) normalized[field.key] = null;
  const errors = [];
  const warnings = [];
  const raw = {};
  const present = {};
  let recognizedHeaders = 0;

  for (const [header, value] of Object.entries(rawValues || {})) {
    const canonical = index.get(headerKey(header));
    if (!canonical) continue;
    recognizedHeaders += 1;
    if (!present[canonical]) {
      raw[canonical] = value;
      present[canonical] = true;
    }
  }
  if (recognizedHeaders === 0) {
    warnings.push({ field: 'headers', message: 'Tidak ada kolom yang dikenali pada baris ini' });
  }

  const pushFieldError = (field, message, pending = false) => {
    const entry = { field, message };
    if (pending) entry.pending = true;
    errors.push(entry);
  };

  for (const field of spec) {
    const has = present[field.key] === true;
    const value = has ? raw[field.key] : undefined;
    if (!has || isBlank(value)) {
      if (field.required) {
        if (!has) pushFieldError(field.key, `Kolom wajib ${field.key} tidak ditemukan`);
        else pushFieldError(field.key, `${field.key} wajib diisi`);
      }
      continue;
    }
    switch (field.kind) {
      case 'code':
        normalized[field.key] = cleanCode(value);
        break;
      case 'text':
        normalized[field.key] = cleanText(value);
        break;
      case 'agentStatus': {
        const text = cleanText(value);
        normalized[field.key] = text === null ? null : (AGENT_STATUS_MAP.get(text.toLowerCase()) || text);
        break;
      }
      case 'transactionType': {
        const text = cleanText(value);
        normalized[field.key] = text === null ? null : (TXN_TYPE_MAP.get(text.toLowerCase()) || text);
        break;
      }
      case 'date': {
        const result = parseDateValue(value, ctx.dateFormat);
        if (result.error) pushFieldError(field.key, `${field.key}: ${result.error}`);
        else normalized[field.key] = result.value;
        break;
      }
      case 'amount': {
        const result = parseAmountValue(value);
        if (result.error) pushFieldError(field.key, `${field.key}: ${result.error}`);
        else normalized[field.key] = result.value;
        break;
      }
      case 'year': {
        const result = parseYearValue(value);
        if (result.error) pushFieldError(field.key, result.error);
        else normalized[field.key] = result.value;
        break;
      }
      case 'currency': {
        const result = resolveReference(value, {
          field: field.key, mappingType: 'CURRENCY', masterKey: 'currencies', label: 'Currency', ctx,
        });
        if (result.error && !result.error.pending) pushFieldError(field.key, result.error.message);
        else if (result.error) pushFieldError(field.key, result.error.message, true);
        normalized[field.key] = result.value;
        break;
      }
      case 'branch': {
        const result = resolveReference(value, {
          field: field.key, mappingType: 'BRANCH', masterKey: 'branches', label: 'Cabang', ctx,
        });
        if (result.error && !result.error.pending) pushFieldError(field.key, result.error.message);
        else if (result.error) pushFieldError(field.key, result.error.message, true);
        normalized[field.key] = result.value;
        break;
      }
      case 'product':
      case 'coverage':
      case 'cause': {
        const mappingType = field.kind === 'product' ? 'PRODUCT' : field.kind === 'coverage' ? 'COVERAGE' : 'CAUSE_OF_LOSS';
        const masterKey = field.kind === 'product' ? 'products' : field.kind === 'coverage' ? 'coverages' : 'causes';
        const label = field.kind === 'product' ? 'Produk' : field.kind === 'coverage' ? 'Coverage' : 'Cause of loss';
        const result = resolveReference(value, {
          field: field.key, mappingType, masterKey, label, ctx,
        });
        if (result.error && !result.error.pending) pushFieldError(field.key, result.error.message);
        else if (result.error) pushFieldError(field.key, result.error.message, true);
        normalized[field.key] = result.value;
        break;
      }
      default:
        normalized[field.key] = cleanText(value);
    }
  }

  // Derived: agent resolution + branch fallback + UW year.
  if (uploadType === 'PRODUCTION' || uploadType === 'CLAIM') {
    const agentCode = normalized.KodeAgen;
    const agent = agentCode ? ctx.findAgent(agentCode) : null;
    normalized.agentKey = agentCode;
    normalized.agentIdInternal = agent ? agent.agent_id_internal : null;
    normalized.agentFound = Boolean(agent);
    if (!normalized.Cabang && agent?.branch_code) normalized.Cabang = agent.branch_code;
    if (uploadType === 'PRODUCTION') {
      normalized.uwYear = normalized.EffectiveDate ? Number(normalized.EffectiveDate.slice(0, 4)) : null;
    } else if (!normalized.UWYear) {
      const basis = normalized.LossDate || normalized.SettlementDate;
      normalized.UWYear = basis ? Number(basis.slice(0, 4)) : null;
    }
  }

  const required = spec.filter((field) => field.required).map((field) => field.key);
  for (const key of required) {
    if (normalized[key] === null || normalized[key] === undefined) {
      if (!errors.some((entry) => entry.field === key)) pushFieldError(key, `${key} wajib diisi`);
    }
  }

  return { normalized, errors, warnings };
}

/** Nilai mentah yang perlu dipertahankan untuk audit. */
function rawPayloadOf(values) {
  return values && typeof values === 'object' ? { ...values } : {};
}

module.exports = {
  DATE_FORMATS,
  FIELD_SPECS,
  BLANK_TOKENS,
  isBlank,
  cleanText,
  cleanCode,
  parseDateValue,
  parseAmountValue,
  isValidCalendarDate,
  buildFieldIndex,
  unknownHeaders,
  loadMappings,
  loadMasters,
  loadNormalizationContext,
  normalizeRow,
  rawPayloadOf,
  parseJson,
};
