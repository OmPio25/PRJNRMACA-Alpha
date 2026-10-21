'use strict';
/**
 * Hash & business key berbasis konfigurasi versi (hash_config).
 * Nilai yang di-hash selalu nilai ternormalisasi: nominal minor unit, tanggal ISO,
 * null dipertahankan null.
 */
const { queryOne } = require('../../../db/database');
const { canonicalHash, businessKey } = require('../../../db/canonical');
const { parseJson } = require('../util/serialize');
const { AppError } = require('../middleware/errors');

function loadActiveHashConfig(uploadType) {
  return queryOne(
    `SELECT hash_config_version, upload_type, columns_json, business_key_json,
            effective_from, is_active, notes
       FROM hash_config
      WHERE upload_type = ? AND is_active = 1
      ORDER BY effective_from DESC, created_at DESC
      LIMIT 1`,
    [uploadType],
  );
}

function loadHashConfig(uploadType, version) {
  if (version) {
    const row = queryOne(
      `SELECT hash_config_version, upload_type, columns_json, business_key_json,
              effective_from, is_active, notes
         FROM hash_config WHERE upload_type = ? AND hash_config_version = ?`,
      [uploadType, version],
    );
    if (row) return row;
  }
  return loadActiveHashConfig(uploadType);
}

function decodeConfig(row) {
  if (!row) return null;
  return {
    version: row.hash_config_version,
    uploadType: row.upload_type,
    columns: parseJson(row.columns_json, []),
    businessKeyColumns: parseJson(row.business_key_json, []),
    effectiveFrom: row.effective_from,
  };
}

function requireConfig(uploadType) {
  const config = decodeConfig(loadActiveHashConfig(uploadType));
  if (!config || !Array.isArray(config.columns) || config.columns.length === 0) {
    throw new AppError('INVALID_STATE', 409, `Konfigurasi hash aktif untuk ${uploadType} tidak tersedia`);
  }
  return config;
}

const ALIASES = {
  kodeagen: 'KODEAGEN',
  agentidsource: 'AgentIDSource',
  agentkey: 'agentKey',
  agentidinternal: 'agentIdInternal',
  namaagent: 'NamaAgent',
  cabang: 'Cabang',
  branchcode: 'Cabang',
  statusagent: 'StatusAgent',
  policyno: 'PolicyNo',
  policyriskid: 'PolicyRiskID',
  transactiondate: 'TransactionDate',
  effectivedate: 'EffectiveDate',
  expirydate: 'ExpiryDate',
  transactiontype: 'TransactionType',
  product: 'Product',
  coverage: 'Coverage',
  tsi: 'TSI',
  premium: 'Premium',
  currency: 'Currency',
  kodeagen_production: 'KodeAgen',
  claimno: 'ClaimNo',
  settlementno: 'SettlementNo',
  settlementdate: 'SettlementDate',
  grossclaim: 'GrossClaim',
  indemnity: 'Indemnity',
  deductible: 'Deductible',
  salvage: 'Salvage',
  subrogation: 'Subrogation',
};

function valueFor(normalized, column) {
  if (normalized && Object.prototype.hasOwnProperty.call(normalized, column)) {
    const value = normalized[column];
    return value === undefined ? null : value;
  }
  const alias = ALIASES[String(column).toLowerCase().replace(/[^a-z0-9]/g, '')];
  if (alias && normalized && Object.prototype.hasOwnProperty.call(normalized, alias)) {
    const value = normalized[alias];
    return value === undefined ? null : value;
  }
  return null;
}

function hashFor(uploadType, normalized, config = null) {
  const cfg = config || requireConfig(uploadType);
  const values = cfg.columns.map((column) => valueFor(normalized, column));
  return canonicalHash(values);
}

function keyColumnsFor(uploadType, normalized, config, rules = {}) {
  if (uploadType === 'AGENT') {
    const key = normalized.KODEAGEN || normalized.AgentIDSource || '';
    return [key];
  }
  if (uploadType === 'CLAIM' && rules.claimNoGloballyUnique === false) {
    return [normalized.ClaimNo || '', normalized.PolicyNo || '', normalized.agentKey || normalized.KodeAgen || ''];
  }
  return config.businessKeyColumns;
}

function businessKeyFor(uploadType, normalized, config, rules = {}) {
  const cfg = config || requireConfig(uploadType);
  const columns = keyColumnsFor(uploadType, normalized, cfg, rules);
  return businessKey(columns.map((column) => valueFor(normalized, column)));
}

module.exports = {
  loadActiveHashConfig,
  loadHashConfig,
  decodeConfig,
  requireConfig,
  hashFor,
  businessKeyFor,
  valueFor,
};
