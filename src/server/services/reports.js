'use strict';
/**
 * Laporan: 10 reportKey kontrak API §8.
 * Prinsip: nominal tidak pernah dijumlahkan lintas currency; produksi memakai
 * baris valid/current (bukan seluruh versi); claim memakai settlement current aktif.
 */
const { queryAll, queryOne } = require('../../../db/database');
const { fromMinorUnits } = require('../../../db/canonical');
const { validation, notFound, AppError } = require('../middleware/errors');
const { parseDateParam } = require('../util/http');
const { loadRules } = require('./settings');
const exportSvc = require('./export');

const RATE_TYPES = ['MID', 'BUY', 'SELL', 'CENTRAL_BANK', 'CONTRACTUAL'];

const GROUP_BY = {
  transactionType: { sql: 'p.transaction_type', label: 'Transaction Type' },
  branch: { sql: 'p.branch_code', label: 'Branch' },
  product: { sql: 'p.product_code', label: 'Product' },
  coverage: { sql: 'p.coverage_code', label: 'Coverage' },
  currency: { sql: 'p.currency', label: 'Currency' },
  agent: { sql: 'p.agent_id_internal', label: 'Agent' },
};

const REPORT_DEFS = {
  'production-summary': {
    title: 'Ringkasan Produksi',
    permission: 'report.production',
    csvPermission: 'report.production',
    dateBases: ['EFFECTIVE_DATE', 'TRANSACTION_DATE'],
    defaultBasis: 'EFFECTIVE_DATE',
    groupByOptions: Object.keys(GROUP_BY),
    amountFields: ['tsi', 'premium'],
    primaryAmount: 'premium',
  },
  'policy-positions': {
    title: 'Posisi Polis Terkini',
    permission: 'report.production',
    csvPermission: 'report.production',
    dateBases: ['EFFECTIVE_DATE', 'TRANSACTION_DATE'],
    defaultBasis: 'EFFECTIVE_DATE',
    groupByOptions: [],
    amountFields: ['tsi', 'premium'],
    primaryAmount: 'premium',
  },
  'production-by-agent': {
    title: 'Produksi per Agent',
    permission: 'report.production',
    csvPermission: 'report.production',
    dateBases: ['EFFECTIVE_DATE', 'TRANSACTION_DATE'],
    defaultBasis: 'EFFECTIVE_DATE',
    groupByOptions: ['agent'],
    amountFields: ['premium', 'tsi'],
    primaryAmount: 'premium',
  },
  'production-by-branch': {
    title: 'Produksi per Cabang',
    permission: 'report.production',
    csvPermission: 'report.production',
    dateBases: ['EFFECTIVE_DATE', 'TRANSACTION_DATE'],
    defaultBasis: 'EFFECTIVE_DATE',
    groupByOptions: ['branch'],
    amountFields: ['premium', 'tsi'],
    primaryAmount: 'premium',
  },
  'settled-claims': {
    title: 'Claim Settled per Periode',
    permission: 'report.claim',
    csvPermission: 'export.claim',
    dateBases: ['SETTLEMENT_DATE'],
    defaultBasis: 'SETTLEMENT_DATE',
    groupByOptions: [],
    amountFields: ['grossClaim', 'indemnity', 'deductible', 'salvage', 'subrogation'],
    primaryAmount: 'grossClaim',
  },
  'claims-by-policy': {
    title: 'Claim per Polis',
    permission: 'report.claim',
    csvPermission: 'export.claim',
    dateBases: ['SETTLEMENT_DATE'],
    defaultBasis: 'SETTLEMENT_DATE',
    groupByOptions: [],
    amountFields: ['grossClaim', 'indemnity'],
    primaryAmount: 'grossClaim',
  },
  'claims-by-uw-year': {
    title: 'Claim per UW Year',
    permission: 'report.claim',
    csvPermission: 'export.claim',
    dateBases: ['SETTLEMENT_DATE'],
    defaultBasis: 'SETTLEMENT_DATE',
    groupByOptions: [],
    amountFields: ['grossClaim', 'indemnity'],
    primaryAmount: 'grossClaim',
  },
  'cause-of-loss': {
    title: 'Cause of Loss',
    permission: 'report.claim',
    csvPermission: 'export.claim',
    dateBases: ['SETTLEMENT_DATE'],
    defaultBasis: 'SETTLEMENT_DATE',
    groupByOptions: [],
    amountFields: ['grossClaim', 'indemnity'],
    primaryAmount: 'grossClaim',
  },
  recovery: {
    title: 'Recovery',
    permission: 'report.claim',
    csvPermission: 'export.claim',
    dateBases: ['SETTLEMENT_DATE'],
    defaultBasis: 'SETTLEMENT_DATE',
    groupByOptions: [],
    amountFields: ['salvage', 'subrogation'],
    primaryAmount: 'salvage',
  },
  'upload-audit': {
    title: 'Audit Upload',
    permission: 'report.view',
    csvPermission: 'report.view',
    dateBases: ['UPLOADED_AT'],
    defaultBasis: 'UPLOADED_AT',
    groupByOptions: [],
    amountFields: [],
    primaryAmount: null,
  },
};

const COLUMNS = {
  'production-summary': (groupLabel) => [
    { key: 'groupBy', label: groupLabel, type: 'text', align: 'left' },
    { key: 'currency', label: 'Currency', type: 'text', align: 'left' },
    { key: 'transactionCount', label: 'Transactions', type: 'number', align: 'right' },
    { key: 'policyCount', label: 'Policies', type: 'number', align: 'right' },
    { key: 'tsi', label: 'TSI', type: 'currency', align: 'right' },
    { key: 'premium', label: 'Premium', type: 'currency', align: 'right' },
  ],
  'policy-positions': () => [
    { key: 'policyNo', label: 'Policy No', type: 'text', align: 'left' },
    { key: 'policyRiskId', label: 'Policy Risk ID', type: 'text', align: 'left' },
    { key: 'agent', label: 'Agent', type: 'text', align: 'left' },
    { key: 'branch', label: 'Branch', type: 'text', align: 'left' },
    { key: 'product', label: 'Product', type: 'text', align: 'left' },
    { key: 'coverage', label: 'Coverage', type: 'text', align: 'left' },
    { key: 'effectiveDate', label: 'Effective Date', type: 'date', align: 'left' },
    { key: 'expiryDate', label: 'Expiry Date', type: 'date', align: 'left' },
    { key: 'tsi', label: 'TSI', type: 'currency', align: 'right' },
    { key: 'premium', label: 'Premium', type: 'currency', align: 'right' },
    { key: 'currency', label: 'Currency', type: 'text', align: 'left' },
  ],
  'production-by-agent': () => [
    { key: 'agentId', label: 'Agent ID', type: 'text', align: 'left' },
    { key: 'agentName', label: 'Agent Name', type: 'text', align: 'left' },
    { key: 'branch', label: 'Branch', type: 'text', align: 'left' },
    { key: 'transactionCount', label: 'Transactions', type: 'number', align: 'right' },
    { key: 'policyCount', label: 'Policies', type: 'number', align: 'right' },
    { key: 'premium', label: 'Premium', type: 'currency', align: 'right' },
    { key: 'tsi', label: 'TSI', type: 'currency', align: 'right' },
    { key: 'currency', label: 'Currency', type: 'text', align: 'left' },
  ],
  'production-by-branch': () => [
    { key: 'branchCode', label: 'Branch Code', type: 'text', align: 'left' },
    { key: 'branchName', label: 'Branch Name', type: 'text', align: 'left' },
    { key: 'transactionCount', label: 'Transactions', type: 'number', align: 'right' },
    { key: 'policyCount', label: 'Policies', type: 'number', align: 'right' },
    { key: 'premium', label: 'Premium', type: 'currency', align: 'right' },
    { key: 'tsi', label: 'TSI', type: 'currency', align: 'right' },
    { key: 'currency', label: 'Currency', type: 'text', align: 'left' },
  ],
  'settled-claims': () => [
    { key: 'claimNo', label: 'Claim No', type: 'text', align: 'left' },
    { key: 'policyNo', label: 'Policy No', type: 'text', align: 'left' },
    { key: 'dateOfSettlement', label: 'Date Of Settlement', type: 'date', align: 'left' },
    { key: 'grossClaim', label: 'Gross Claim', type: 'currency', align: 'right' },
    { key: 'indemnity', label: 'Indemnity', type: 'currency', align: 'right' },
    { key: 'deductible', label: 'Deductible', type: 'currency', align: 'right' },
    { key: 'salvage', label: 'Salvage', type: 'currency', align: 'right' },
    { key: 'subrogation', label: 'Subrogation', type: 'currency', align: 'right' },
    { key: 'currency', label: 'Currency', type: 'text', align: 'left' },
  ],
  'claims-by-policy': () => [
    { key: 'policyNo', label: 'Policy No', type: 'text', align: 'left' },
    { key: 'claimCount', label: 'Claims', type: 'number', align: 'right' },
    { key: 'settlementCount', label: 'Settlements', type: 'number', align: 'right' },
    { key: 'grossClaim', label: 'Gross Claim', type: 'currency', align: 'right' },
    { key: 'indemnity', label: 'Indemnity', type: 'currency', align: 'right' },
    { key: 'currency', label: 'Currency', type: 'text', align: 'left' },
  ],
  'claims-by-uw-year': () => [
    { key: 'uwYear', label: 'UW Year', type: 'number', align: 'left' },
    { key: 'claimCount', label: 'Claims', type: 'number', align: 'right' },
    { key: 'settlementCount', label: 'Settlements', type: 'number', align: 'right' },
    { key: 'grossClaim', label: 'Gross Claim', type: 'currency', align: 'right' },
    { key: 'indemnity', label: 'Indemnity', type: 'currency', align: 'right' },
    { key: 'currency', label: 'Currency', type: 'text', align: 'left' },
  ],
  'cause-of-loss': () => [
    { key: 'causeOfLoss', label: 'Cause Of Loss', type: 'text', align: 'left' },
    { key: 'claimCount', label: 'Claims', type: 'number', align: 'right' },
    { key: 'grossClaim', label: 'Gross Claim', type: 'currency', align: 'right' },
    { key: 'indemnity', label: 'Indemnity', type: 'currency', align: 'right' },
    { key: 'currency', label: 'Currency', type: 'text', align: 'left' },
  ],
  recovery: () => [
    { key: 'claimNo', label: 'Claim No', type: 'text', align: 'left' },
    { key: 'dateOfSettlement', label: 'Date Of Settlement', type: 'date', align: 'left' },
    { key: 'salvage', label: 'Salvage', type: 'currency', align: 'right' },
    { key: 'subrogation', label: 'Subrogation', type: 'currency', align: 'right' },
    { key: 'currency', label: 'Currency', type: 'text', align: 'left' },
  ],
  'upload-audit': () => [
    { key: 'uploadBatchId', label: 'Upload Batch ID', type: 'text', align: 'left' },
    { key: 'uploadType', label: 'Upload Type', type: 'text', align: 'left' },
    { key: 'originalFileName', label: 'File Name', type: 'text', align: 'left' },
    { key: 'uploadedBy', label: 'Uploaded By', type: 'text', align: 'left' },
    { key: 'uploadedAt', label: 'Uploaded At', type: 'text', align: 'left' },
    { key: 'totalRows', label: 'Total Rows', type: 'number', align: 'right' },
    { key: 'newRows', label: 'New', type: 'number', align: 'right' },
    { key: 'duplicateRows', label: 'Duplicate', type: 'number', align: 'right' },
    { key: 'changedRows', label: 'Changed', type: 'number', align: 'right' },
    { key: 'rejectedRows', label: 'Rejected', type: 'number', align: 'right' },
    { key: 'postedRows', label: 'Posted', type: 'number', align: 'right' },
    { key: 'processingStatus', label: 'Status', type: 'text', align: 'left' },
  ],
};

const DATE_BASIS_LABEL = {
  EFFECTIVE_DATE: 'Effective Date',
  TRANSACTION_DATE: 'Transaction Date',
  SETTLEMENT_DATE: 'Date Of Settlement',
  UW_YEAR: 'UW Year',
  UPLOADED_AT: 'Uploaded At',
};

function money(minor) {
  return minor === null || minor === undefined ? 0 : fromMinorUnits(minor);
}

function upperParam(query, key) {
  const value = query[key];
  if (value === undefined || value === null || value === '') return null;
  return String(value).trim().toUpperCase();
}

function textParam(query, key) {
  const value = query[key];
  if (value === undefined || value === null || value === '') return null;
  return String(value).trim();
}

function parseReportFilters(reportKey, query) {
  const def = REPORT_DEFS[reportKey];
  const from = parseDateParam(query.from, 'from');
  const to = parseDateParam(query.to, 'to');
  if (from && to && from > to) {
    throw validation('Rentang periode tidak valid', [{ field: 'from', message: 'from tidak boleh setelah to' }]);
  }
  const dateBasis = upperParam(query, 'dateBasis') || def.defaultBasis;
  if (!def.dateBases.includes(dateBasis)) {
    throw validation('dateBasis tidak valid untuk laporan ini', [{
      field: 'dateBasis', message: `Gunakan: ${def.dateBases.join(', ')}`,
    }]);
  }
  const rateType = upperParam(query, 'rateType') || 'MID';
  if (!RATE_TYPES.includes(rateType)) {
    throw validation('rateType tidak valid', [{ field: 'rateType', message: `Gunakan: ${RATE_TYPES.join(', ')}` }]);
  }
  const convertTo = upperParam(query, 'convertTo');
  if (convertTo) {
    const currency = queryOne('SELECT currency_code FROM master_currency WHERE currency_code = ?', [convertTo]);
    if (!currency) {
      throw validation('convertTo tidak valid', [{ field: 'convertTo', message: 'Currency tidak ada di master' }]);
    }
  }
  const groupBy = textParam(query, 'groupBy');
  if (groupBy && !def.groupByOptions.includes(groupBy)) {
    throw validation('groupBy tidak valid', [{
      field: 'groupBy', message: `Gunakan: ${def.groupByOptions.join(', ') || '(tidak ada)'}`,
    }]);
  }
  const format = String(query.format || 'json').toLowerCase();
  if (!['json', 'csv'].includes(format)) {
    throw validation('format tidak valid', [{ field: 'format', message: 'Gunakan json atau csv' }]);
  }
  return {
    from,
    to,
    dateBasis,
    groupBy: groupBy || (reportKey === 'production-summary' ? 'transactionType' : null),
    convertTo,
    rateType,
    format,
    agentId: textParam(query, 'agentId'),
    branch: upperParam(query, 'branch'),
    product: upperParam(query, 'product'),
    coverage: upperParam(query, 'coverage'),
    currency: upperParam(query, 'currency'),
    causeOfLoss: upperParam(query, 'causeOfLoss'),
    transactionType: textParam(query, 'transactionType'),
    type: upperParam(query, 'type'),
    status: textParam(query, 'status'),
  };
}

function echoFilters(filters) {
  return {
    from: filters.from,
    to: filters.to,
    dateBasis: filters.dateBasis,
    agentId: filters.agentId,
    branch: filters.branch,
    product: filters.product,
    coverage: filters.coverage,
    currency: filters.currency,
    causeOfLoss: filters.causeOfLoss,
    transactionType: filters.transactionType,
    groupBy: filters.groupBy,
    convertTo: filters.convertTo,
    rateType: filters.rateType,
  };
}

function productionFilterSql(filters, scope, dateColumn, params, { positions = false } = {}) {
  const where = [];
  if (!positions) where.push("p.record_status = 'Active'");
  if (filters.branch) { where.push('p.branch_code = ?'); params.push(filters.branch); }
  if (filters.product) { where.push('p.product_code = ?'); params.push(filters.product); }
  if (filters.coverage) { where.push('p.coverage_code = ?'); params.push(filters.coverage); }
  if (filters.currency) { where.push('p.currency = ?'); params.push(filters.currency); }
  if (filters.agentId) { where.push('p.agent_id_internal = ?'); params.push(filters.agentId); }
  if (filters.transactionType) { where.push('p.transaction_type = ?'); params.push(filters.transactionType); }
  if (filters.from) { where.push(`${dateColumn} >= ?`); params.push(filters.from); }
  if (filters.to) { where.push(`${dateColumn} <= ?`); params.push(filters.to); }
  if (scope && scope.length > 0) {
    where.push(`p.branch_code IN (${scope.map(() => '?').join(',')})`);
    params.push(...scope);
  }
  return where.length ? ` AND ${where.join(' AND ')}` : '';
}

function claimFilterSql(filters, scope, params) {
  const where = [];
  if (filters.branch) { where.push('c.branch_code = ?'); params.push(filters.branch); }
  if (filters.product) { where.push('c.product_at_loss = ?'); params.push(filters.product); }
  if (filters.coverage) { where.push('c.coverage_at_loss = ?'); params.push(filters.coverage); }
  if (filters.currency) { where.push('s.currency = ?'); params.push(filters.currency); }
  if (filters.agentId) { where.push('c.agent_id_internal = ?'); params.push(filters.agentId); }
  if (filters.causeOfLoss) { where.push('c.cause_of_loss = ?'); params.push(filters.causeOfLoss); }
  if (filters.from) { where.push('s.date_of_settlement >= ?'); params.push(filters.from); }
  if (filters.to) { where.push('s.date_of_settlement <= ?'); params.push(filters.to); }
  if (scope && scope.length > 0) {
    where.push(`c.branch_code IN (${scope.map(() => '?').join(',')})`);
    params.push(...scope);
  }
  return where.length ? ` AND ${where.join(' AND ')}` : '';
}

// ---------------------------------------------------------------------------
// Query builders per report
// ---------------------------------------------------------------------------

function runProductionRows(reportKey, filters, scope) {
  const params = [];
  const dateColumn = filters.dateBasis === 'TRANSACTION_DATE' ? 'p.transaction_date' : 'p.effective_date';
  const filterSql = productionFilterSql(filters, scope, dateColumn, params);

  if (reportKey === 'production-summary') {
    const group = GROUP_BY[filters.groupBy];
    const sql = `SELECT ${group.sql} AS group_value, p.currency,
                        COUNT(*) AS transaction_count,
                        COUNT(DISTINCT p.policy_no || '|' || COALESCE(p.policy_risk_id, '')) AS policy_count,
                        SUM(COALESCE(p.tsi_minor, 0)) AS tsi_minor,
                        SUM(COALESCE(p.premium_minor, 0)) AS premium_minor
                   FROM master_produksi p
                  WHERE p.is_current = 1 ${filterSql}
                  GROUP BY group_value, p.currency
                  ORDER BY group_value, p.currency`;
    const rows = queryAll(sql, params).map((row) => ({
      groupBy: row.group_value,
      currency: row.currency,
      transactionCount: row.transaction_count,
      policyCount: row.policy_count,
      tsi: money(row.tsi_minor),
      premium: money(row.premium_minor),
    }));
    return {
      rows,
      columns: COLUMNS[reportKey](group.label),
      basis: `Berdasarkan ${DATE_BASIS_LABEL[filters.dateBasis]}; hanya transaksi valid (bukan seluruh versi)`,
      basisLabel: DATE_BASIS_LABEL[filters.dateBasis],
    };
  }

  if (reportKey === 'policy-positions') {
    const sql = `SELECT p.policy_no, p.policy_risk_id, p.source_agent_code, p.branch_code,
                        p.product_code, p.coverage_code, p.effective_date, p.expiry_date,
                        p.tsi_minor, p.premium_minor, p.currency,
                        a.nama_agent AS agent_name
                   FROM master_produksi p
              LEFT JOIN master_agent a ON a.agent_id_internal = p.agent_id_internal
                  WHERE p.is_current = 1 AND p.record_status = 'Active' ${filterSql}
                  ORDER BY p.effective_date DESC, p.policy_no ASC`;
    const rows = queryAll(sql, params).map((row) => ({
      policyNo: row.policy_no,
      policyRiskId: row.policy_risk_id,
      agent: row.agent_name || row.source_agent_code,
      branch: row.branch_code,
      product: row.product_code,
      coverage: row.coverage_code,
      effectiveDate: row.effective_date,
      expiryDate: row.expiry_date,
      tsi: money(row.tsi_minor),
      premium: money(row.premium_minor),
      currency: row.currency,
    }));
    return {
      rows,
      columns: COLUMNS[reportKey](),
      basis: 'Berdasarkan posisi terkini (is_current=1) per Policy + PolicyRiskID; record historis tidak dihitung',
      basisLabel: 'Policy + PolicyRiskID',
    };
  }

  if (reportKey === 'production-by-agent') {
    const sql = `SELECT p.agent_id_internal AS agent_id, a.nama_agent AS agent_name,
                        p.branch_code AS branch, p.currency,
                        COUNT(*) AS transaction_count,
                        COUNT(DISTINCT p.policy_no || '|' || COALESCE(p.policy_risk_id, '')) AS policy_count,
                        SUM(COALESCE(p.premium_minor, 0)) AS premium_minor,
                        SUM(COALESCE(p.tsi_minor, 0)) AS tsi_minor
                   FROM master_produksi p
              LEFT JOIN master_agent a ON a.agent_id_internal = p.agent_id_internal
                  WHERE p.is_current = 1 ${filterSql}
                  GROUP BY p.agent_id_internal, a.nama_agent, p.branch_code, p.currency
                  ORDER BY premium_minor DESC`;
    const rows = queryAll(sql, params).map((row) => ({
      agentId: row.agent_id,
      agentName: row.agent_name,
      branch: row.branch,
      transactionCount: row.transaction_count,
      policyCount: row.policy_count,
      premium: money(row.premium_minor),
      tsi: money(row.tsi_minor),
      currency: row.currency,
    }));
    return {
      rows,
      columns: COLUMNS[reportKey](),
      basis: `Berdasarkan ${DATE_BASIS_LABEL[filters.dateBasis]}; hanya transaksi valid (bukan seluruh versi)`,
      basisLabel: DATE_BASIS_LABEL[filters.dateBasis],
    };
  }

  // production-by-branch
  const sql = `SELECT p.branch_code AS branch_code, b.branch_name AS branch_name, p.currency,
                      COUNT(*) AS transaction_count,
                      COUNT(DISTINCT p.policy_no || '|' || COALESCE(p.policy_risk_id, '')) AS policy_count,
                      SUM(COALESCE(p.premium_minor, 0)) AS premium_minor,
                      SUM(COALESCE(p.tsi_minor, 0)) AS tsi_minor
                 FROM master_produksi p
            LEFT JOIN master_branch b ON b.branch_code = p.branch_code
                WHERE p.is_current = 1 ${filterSql}
                GROUP BY p.branch_code, b.branch_name, p.currency
                ORDER BY premium_minor DESC`;
  const rows = queryAll(sql, params).map((row) => ({
    branchCode: row.branch_code,
    branchName: row.branch_name,
    transactionCount: row.transaction_count,
    policyCount: row.policy_count,
    premium: money(row.premium_minor),
    tsi: money(row.tsi_minor),
    currency: row.currency,
  }));
  return {
    rows,
    columns: COLUMNS[reportKey](),
    basis: `Berdasarkan ${DATE_BASIS_LABEL[filters.dateBasis]}; hanya transaksi valid (bukan seluruh versi)`,
    basisLabel: DATE_BASIS_LABEL[filters.dateBasis],
  };
}

const CLAIM_BASE = `FROM claim_settlement s
                     JOIN claim_master c ON c.claim_id = s.claim_id
                    WHERE s.is_current = 1 AND s.record_status = 'Active'`;

function runClaimRows(reportKey, filters, scope) {
  const params = [];
  const filterSql = claimFilterSql(filters, scope, params);
  const where = `${CLAIM_BASE}${filterSql}`;

  if (reportKey === 'settled-claims') {
    const rows = queryAll(
      `SELECT c.claim_no, c.policy_no, s.date_of_settlement, s.gross_claim_minor,
              s.indemnity_minor, s.deductible_minor, s.salvage_minor, s.subrogation_minor,
              s.currency
         ${where}
        ORDER BY s.date_of_settlement ASC, c.claim_no ASC`,
      params,
    ).map((row) => ({
      claimNo: row.claim_no,
      policyNo: row.policy_no,
      dateOfSettlement: row.date_of_settlement,
      grossClaim: money(row.gross_claim_minor),
      indemnity: money(row.indemnity_minor),
      deductible: money(row.deductible_minor),
      salvage: money(row.salvage_minor),
      subrogation: money(row.subrogation_minor),
      currency: row.currency,
    }));
    return {
      rows,
      columns: COLUMNS[reportKey](),
      basis: 'Berdasarkan Date Of Settlement; hanya settlement terkini yang aktif',
      basisLabel: 'Date Of Settlement',
    };
  }

  if (reportKey === 'claims-by-policy') {
    const rows = queryAll(
      `SELECT c.policy_no, s.currency,
              COUNT(DISTINCT c.claim_id) AS claim_count,
              COUNT(*) AS settlement_count,
              SUM(COALESCE(s.gross_claim_minor, 0)) AS gross_claim_minor,
              SUM(COALESCE(s.indemnity_minor, 0)) AS indemnity_minor
         ${where}
        GROUP BY c.policy_no, s.currency
        ORDER BY gross_claim_minor DESC`,
      params,
    ).map((row) => ({
      policyNo: row.policy_no,
      claimCount: row.claim_count,
      settlementCount: row.settlement_count,
      grossClaim: money(row.gross_claim_minor),
      indemnity: money(row.indemnity_minor),
      currency: row.currency,
    }));
    return {
      rows,
      columns: COLUMNS[reportKey](),
      basis: 'Berdasarkan settlement aktif; COUNT(DISTINCT claim_id) per Policy No (bukan hanya claim terakhir)',
      basisLabel: 'Date Of Settlement',
    };
  }

  if (reportKey === 'claims-by-uw-year') {
    const rows = queryAll(
      `SELECT c.uw_year, s.currency,
              COUNT(DISTINCT c.claim_id) AS claim_count,
              COUNT(*) AS settlement_count,
              SUM(COALESCE(s.gross_claim_minor, 0)) AS gross_claim_minor,
              SUM(COALESCE(s.indemnity_minor, 0)) AS indemnity_minor
         ${where}
        GROUP BY c.uw_year, s.currency
        ORDER BY c.uw_year ASC, s.currency ASC`,
      params,
    ).map((row) => ({
      uwYear: row.uw_year,
      claimCount: row.claim_count,
      settlementCount: row.settlement_count,
      grossClaim: money(row.gross_claim_minor),
      indemnity: money(row.indemnity_minor),
      currency: row.currency,
    }));
    return {
      rows,
      columns: COLUMNS[reportKey](),
      basis: 'Berdasarkan UW Year dari ClaimMaster; periode memakai Date Of Settlement',
      basisLabel: 'UW Year',
    };
  }

  if (reportKey === 'cause-of-loss') {
    const rows = queryAll(
      `SELECT c.cause_of_loss, s.currency,
              COUNT(DISTINCT c.claim_id) AS claim_count,
              SUM(COALESCE(s.gross_claim_minor, 0)) AS gross_claim_minor,
              SUM(COALESCE(s.indemnity_minor, 0)) AS indemnity_minor
         ${where}
        GROUP BY c.cause_of_loss, s.currency
        ORDER BY gross_claim_minor DESC`,
      params,
    ).map((row) => ({
      causeOfLoss: row.cause_of_loss,
      claimCount: row.claim_count,
      grossClaim: money(row.gross_claim_minor),
      indemnity: money(row.indemnity_minor),
      currency: row.currency,
    }));
    return {
      rows,
      columns: COLUMNS[reportKey](),
      basis: 'Berdasarkan Cause Of Loss; hanya settlement terkini yang aktif',
      basisLabel: 'Date Of Settlement',
    };
  }

  // recovery
  const rows = queryAll(
    `SELECT c.claim_no, s.date_of_settlement, s.salvage_minor, s.subrogation_minor, s.currency
       ${where}
      ORDER BY s.date_of_settlement ASC`,
    params,
  ).map((row) => ({
    claimNo: row.claim_no,
    dateOfSettlement: row.date_of_settlement,
    salvage: money(row.salvage_minor),
    subrogation: money(row.subrogation_minor),
    currency: row.currency,
  }));
  return {
    rows,
    columns: COLUMNS[reportKey](),
    basis: 'Berdasarkan Salvage dan Subrogation pada settlement aktif (Date Of Settlement)',
    basisLabel: 'Date Of Settlement',
  };
}

function runUploadAudit(filters) {
  const where = [];
  const params = [];
  if (filters.from) { where.push('date(b.uploaded_at) >= ?'); params.push(filters.from); }
  if (filters.to) { where.push('date(b.uploaded_at) <= ?'); params.push(filters.to); }
  if (filters.type) { where.push('b.upload_type = ?'); params.push(filters.type); }
  if (filters.status) { where.push('b.processing_status = ?'); params.push(filters.status); }
  const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const rows = queryAll(
    `SELECT b.*, u.full_name AS uploaded_by_name
       FROM upload_batches b
  LEFT JOIN users u ON u.user_id = b.uploaded_by
       ${whereSql}
   ORDER BY b.uploaded_at DESC`,
    params,
  ).map((row) => ({
    uploadBatchId: row.upload_batch_id,
    uploadType: row.upload_type,
    originalFileName: row.original_file_name,
    uploadedBy: row.uploaded_by_name || row.uploaded_by,
    uploadedAt: row.uploaded_at,
    totalRows: row.total_rows,
    newRows: row.new_rows,
    duplicateRows: row.duplicate_rows,
    changedRows: row.changed_rows,
    rejectedRows: row.rejected_rows,
    postedRows: row.posted_rows,
    processingStatus: row.processing_status,
  }));
  return {
    rows,
    columns: COLUMNS['upload-audit'](),
    basis: 'Berdasarkan batch upload dan ringkasan hasil validasi',
    basisLabel: 'Uploaded At',
  };
}

// ---------------------------------------------------------------------------
// Totals & conversion
// ---------------------------------------------------------------------------

function computeTotals(rows, amountFields) {
  if (!Array.isArray(amountFields) || amountFields.length === 0) return [];
  const byCurrency = new Map();
  for (const row of rows) {
    const currency = row.currency || 'UNKNOWN';
    if (!byCurrency.has(currency)) {
      const entry = { currency };
      for (const field of amountFields) entry[field] = 0;
      byCurrency.set(currency, entry);
    }
    const entry = byCurrency.get(currency);
    for (const field of amountFields) {
      if (typeof row[field] === 'number') entry[field] = Number((entry[field] + row[field]).toFixed(2));
    }
  }
  return [...byCurrency.values()].sort((a, b) => String(a.currency).localeCompare(String(b.currency)));
}

function findRate(fromCurrency, toCurrency, rateType, anchorDate) {
  const direct = queryOne(
    `SELECT * FROM exchange_rate
      WHERE from_currency = ? AND to_currency = ? AND rate_type = ? AND rate_date <= ?
      ORDER BY rate_date DESC LIMIT 1`,
    [fromCurrency, toCurrency, rateType, anchorDate],
  );
  if (direct) return { rate: direct.exchange_rate, row: direct, inverted: false };
  const reverse = queryOne(
    `SELECT * FROM exchange_rate
      WHERE from_currency = ? AND to_currency = ? AND rate_type = ? AND rate_date <= ?
      ORDER BY rate_date DESC LIMIT 1`,
    [toCurrency, fromCurrency, rateType, anchorDate],
  );
  if (reverse) return { rate: 1 / reverse.exchange_rate, row: reverse, inverted: true };
  return null;
}

function applyConversion(report, filters, rules) {
  if (!filters.convertTo) {
    return { conversion: null, totalsByCurrency: report.totalsByCurrency, warnings: [] };
  }
  const method = rules.reportRateMethod || 'RATE_AS_OF_PERIOD_END';
  const anchorDate = filters.to || new Date().toISOString().slice(0, 10);
  const warnings = [];
  const rates = [];
  const rateCache = new Map();
  const totalsByCurrency = report.totalsByCurrency.map((entry) => {
    if (entry.currency === filters.convertTo) {
      const primary = report.primaryAmount ? entry[report.primaryAmount] || 0 : 0;
      return { ...entry, convertedAmount: primary, rate: 1, rateDate: anchorDate };
    }
    let found = rateCache.get(entry.currency);
    if (found === undefined) {
      found = findRate(entry.currency, filters.convertTo, filters.rateType, anchorDate);
      rateCache.set(entry.currency, found);
    }
    if (!found) {
      warnings.push({
        code: 'RATE_MISSING',
        message: `Kurs ${entry.currency}->${filters.convertTo} (${filters.rateType}) per ${anchorDate} tidak tersedia`,
      });
      return { ...entry, convertedAmount: null, rate: null, rateDate: null };
    }
    rates.push({
      fromCurrency: entry.currency,
      rate: found.rate,
      rateDate: found.row.rate_date,
      exchangeRateId: found.row.exchange_rate_id,
      inverted: found.inverted,
    });
    const primary = report.primaryAmount ? entry[report.primaryAmount] || 0 : 0;
    return {
      ...entry,
      convertedAmount: Number((primary * found.rate).toFixed(2)),
      rate: found.rate,
      rateDate: found.row.rate_date,
    };
  });
  for (const row of report.rows) {
    if (report.primaryAmount && typeof row[report.primaryAmount] === 'number') {
      if (row.currency === filters.convertTo) {
        row.convertedAmount = row[report.primaryAmount];
        row.rate = 1;
        row.rateDate = anchorDate;
      } else {
        const found = rateCache.get(row.currency);
        if (found) {
          row.convertedAmount = Number((row[report.primaryAmount] * found.rate).toFixed(2));
          row.rate = found.rate;
          row.rateDate = found.row.rate_date;
        } else if (!warnings.some((warning) => warning.code === 'RATE_MISSING')) {
          // warning sudah ditambahkan pada level totals
          row.convertedAmount = null;
        }
      }
    }
  }
  return {
    conversion: {
      toCurrency: filters.convertTo,
      rateType: filters.rateType,
      method,
      rates,
    },
    totalsByCurrency,
    warnings,
  };
}

function buildReport(reportKey, { query = {}, scope = [] }) {
  const def = REPORT_DEFS[reportKey];
  if (!def) throw notFound(`Laporan tidak dikenal: ${reportKey}`);
  const filters = parseReportFilters(reportKey, query);
  const rules = loadRules();
  const report = reportKey === 'upload-audit'
    ? runUploadAudit(filters)
    : (reportKey.startsWith('production') || reportKey === 'policy-positions')
      ? runProductionRows(reportKey, filters, scope)
      : runClaimRows(reportKey, filters, scope);

  const totalsByCurrency = computeTotals(report.rows, def.amountFields);
  const conversionResult = applyConversion(
    { ...report, totalsByCurrency, primaryAmount: def.primaryAmount },
    filters,
    rules,
  );
  return {
    reportKey,
    title: def.title,
    basis: report.basis,
    basisLabel: report.basisLabel,
    period: { from: filters.from, to: filters.to },
    filters: echoFilters(filters),
    currencyMode: filters.convertTo ? 'CONVERTED' : 'BY_CURRENCY',
    columns: report.columns,
    rows: report.rows,
    totals: conversionResult.totalsByCurrency,
    totalsByCurrency: conversionResult.totalsByCurrency,
    conversion: conversionResult.conversion,
    warnings: conversionResult.warnings,
    generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    rowCount: report.rows.length,
    _format: filters.format,
  };
}

function reportMeta() {
  const branches = queryAll('SELECT branch_code, branch_name FROM master_branch WHERE is_active = 1 ORDER BY branch_code')
    .map((row) => ({ code: row.branch_code, name: row.branch_name }));
  const products = queryAll('SELECT product_code, product_name FROM master_product WHERE is_active = 1 ORDER BY product_code')
    .map((row) => ({ code: row.product_code, name: row.product_name }));
  const currencies = queryAll('SELECT currency_code, currency_name FROM master_currency WHERE is_active = 1 ORDER BY currency_code')
    .map((row) => ({ code: row.currency_code, name: row.currency_name }));
  const coverages = queryAll('SELECT coverage_code, coverage_name FROM master_coverage WHERE is_active = 1 ORDER BY coverage_code')
    .map((row) => ({ code: row.coverage_code, name: row.coverage_name }));
  const causesOfLoss = queryAll('SELECT cause_code, cause_name FROM master_cause_of_loss WHERE is_active = 1 ORDER BY cause_code')
    .map((row) => ({ code: row.cause_code, name: row.cause_name }));
  const net = netClaimsMeta();
  return {
    reports: Object.entries(REPORT_DEFS).map(([reportKey, def]) => ({
      reportKey,
      title: def.title,
      groupByOptions: def.groupByOptions,
      dateBases: def.dateBases,
    })),
    masters: { branches, products, currencies, coverages, causesOfLoss },
    netClaimFormula: net,
  };
}

function netClaimsMeta() {
  const row = queryOne('SELECT rule_value, status FROM business_rules WHERE rule_key = ?', ['net_claim_formula']);
  const available = Boolean(row && row.status === 'active' && String(JSON.parse(row.rule_value) || '').trim() !== '');
  return {
    available,
    message: available
      ? 'Rumus Net Claims Cost sudah aktif.'
      : 'Rumus Net Claims Cost belum disetujui Finance dan Claims. Laporan tidak menghitung net claim sampai formula resmi diaktifkan.',
    status: row ? row.status : 'pending_approval',
  };
}

// ---------------------------------------------------------------------------
// Net claims cost (hanya bila formula disetujui & aktif)
// ---------------------------------------------------------------------------

const FORMULA_VARS = {
  grossclaim: 'grossClaim',
  gross_claim: 'grossClaim',
  indemnity: 'indemnity',
  deductible: 'deductible',
  salvage: 'salvage',
  subrogation: 'subrogation',
};

function evaluateFormula(formula, vars) {
  let index = 0;
  const text = String(formula);
  const skip = () => { while (index < text.length && /\s/.test(text[index])) index += 1; };
  function parseExpression() {
    let value = parseTerm();
    for (;;) {
      skip();
      const op = text[index];
      if (op !== '+' && op !== '-') return value;
      index += 1;
      const rhs = parseTerm();
      value = op === '+' ? value + rhs : value - rhs;
    }
  }
  function parseTerm() {
    let value = parseFactor();
    for (;;) {
      skip();
      const op = text[index];
      if (op !== '*' && op !== '/') return value;
      index += 1;
      const rhs = parseFactor();
      value = op === '*' ? value * rhs : value / rhs;
    }
  }
  function parseFactor() {
    skip();
    if (text[index] === '(') {
      index += 1;
      const value = parseExpression();
      skip();
      if (text[index] !== ')') throw new Error('Kurung tutup tidak ditemukan');
      index += 1;
      return value;
    }
    if (text[index] === '-') { index += 1; return -parseFactor(); }
    if (text[index] === '+') { index += 1; return parseFactor(); }
    const numberMatch = /^\d+(\.\d+)?/.exec(text.slice(index));
    if (numberMatch) { index += numberMatch[0].length; return Number(numberMatch[0]); }
    const identMatch = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(index));
    if (identMatch) {
      index += identMatch[0].length;
      const key = FORMULA_VARS[identMatch[0].toLowerCase()];
      if (!key) throw new Error(`Variabel tidak dikenal: ${identMatch[0]}`);
      return vars[key] || 0;
    }
    throw new Error('Formula tidak valid');
  }
  if (text.trim() === '') throw new Error('Formula kosong');
  const value = parseExpression();
  skip();
  if (index !== text.length) throw new Error('Formula memiliki karakter tidak valid');
  return value;
}

function netClaimsCost({ query = {}, scope = [] }) {
  const meta = netClaimsMeta();
  if (!meta.available) {
    return {
      available: false,
      message: meta.message,
      status: meta.status,
    };
  }
  const row = queryOne('SELECT rule_value, version_no, approved_at, approved_by FROM business_rules WHERE rule_key = ?', ['net_claim_formula']);
  const formula = JSON.parse(row.rule_value);
  const filters = parseReportFilters('settled-claims', query);
  const params = [];
  const filterSql = claimFilterSql(filters, scope, params);
  const totals = queryAll(
    `SELECT s.currency,
            SUM(COALESCE(s.gross_claim_minor,0)) AS gross_claim,
            SUM(COALESCE(s.indemnity_minor,0)) AS indemnity,
            SUM(COALESCE(s.deductible_minor,0)) AS deductible,
            SUM(COALESCE(s.salvage_minor,0)) AS salvage,
            SUM(COALESCE(s.subrogation_minor,0)) AS subrogation
       FROM claim_settlement s
       JOIN claim_master c ON c.claim_id = s.claim_id
      WHERE s.is_current = 1 AND s.record_status = 'Active'${filterSql}
      GROUP BY s.currency`,
    params,
  ).map((entry) => {
    const vars = {
      grossClaim: money(entry.gross_claim),
      indemnity: money(entry.indemnity),
      deductible: money(entry.deductible),
      salvage: money(entry.salvage),
      subrogation: money(entry.subrogation),
    };
    let netClaimCost;
    try {
      netClaimCost = Number(evaluateFormula(formula, vars).toFixed(2));
    } catch (error) {
      throw new AppError('INVALID_STATE', 409, `Formula Net Claims Cost tidak dapat dievaluasi: ${error.message}`);
    }
    return {
      currency: entry.currency,
      ...vars,
      netClaimCost,
      formulaVersion: row.version_no,
      formulaApprovedAt: row.approved_at,
    };
  });
  return {
    available: true,
    formula,
    status: meta.status,
    period: { from: filters.from, to: filters.to },
    totals,
    generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };
}

function reportToCsv(report) {
  return exportSvc.toCsv(report.columns, report.rows);
}

module.exports = {
  REPORT_DEFS,
  buildReport,
  reportMeta,
  netClaimsCost,
  netClaimsMeta,
  reportToCsv,
  computeTotals,
  evaluateFormula,
  parseReportFilters,
};
