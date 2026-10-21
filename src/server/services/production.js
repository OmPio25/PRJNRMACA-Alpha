'use strict';
/** Produksi: daftar/detail/versi, posisi terkini, pembatalan (tanpa DELETE), trace. */
const { queryAll, queryOne, execute, withTransaction, nowIso } = require('../../../db/database');
const { validation, notFound, invalidState } = require('../middleware/errors');
const { recordAudit } = require('./audit');
const { serializeProduction, parseJson } = require('../util/serialize');
const { parseDateParam } = require('../util/http');
const config = require('../config');

const SORT_WHITELIST = {
  policyNo: 'p.policy_no',
  policyRiskId: 'p.policy_risk_id',
  effectiveDate: 'p.effective_date',
  transactionDate: 'p.transaction_date',
  expiryDate: 'p.expiry_date',
  premium: 'p.premium_minor',
  tsi: 'p.tsi_minor',
  transactionType: 'p.transaction_type',
  currency: 'p.currency',
  branchCode: 'p.branch_code',
  versionNo: 'p.version_no',
  createdAt: 'p.created_at',
  updatedAt: 'p.updated_at',
};

function parseBoolFlag(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).toLowerCase();
  if (['true', '1', 'yes'].includes(normalized)) return 1;
  if (['false', '0', 'no'].includes(normalized)) return 0;
  throw validation(`Filter ${field} tidak valid`, [{ field, message: 'Gunakan true atau false' }]);
}

function buildWhere(filters = {}, scope = []) {
  const where = [];
  const params = [];
  if (filters.policyNo) {
    where.push('p.policy_no LIKE ?');
    params.push(`%${String(filters.policyNo).toUpperCase()}%`);
  }
  if (filters.agentId) {
    where.push('p.agent_id_internal = ?');
    params.push(filters.agentId);
  }
  if (filters.branch) {
    where.push('p.branch_code = ?');
    params.push(String(filters.branch).toUpperCase());
  }
  if (filters.product) {
    where.push('p.product_code = ?');
    params.push(String(filters.product).toUpperCase());
  }
  if (filters.coverage) {
    where.push('p.coverage_code = ?');
    params.push(String(filters.coverage).toUpperCase());
  }
  if (filters.currency) {
    where.push('p.currency = ?');
    params.push(String(filters.currency).toUpperCase());
  }
  if (filters.transactionType) {
    where.push('p.transaction_type = ?');
    params.push(filters.transactionType);
  }
  if (filters.status) {
    where.push('p.record_status = ?');
    params.push(filters.status);
  }
  const isCurrent = parseBoolFlag(filters.isCurrent, 'isCurrent');
  if (isCurrent !== null) {
    where.push('p.is_current = ?');
    params.push(isCurrent);
  }
  if (filters.effectiveFrom) {
    where.push('p.effective_date >= ?');
    params.push(parseDateParam(filters.effectiveFrom, 'effectiveFrom'));
  }
  if (filters.effectiveTo) {
    where.push('p.effective_date <= ?');
    params.push(parseDateParam(filters.effectiveTo, 'effectiveTo'));
  }
  if (filters.transactionFrom) {
    where.push('p.transaction_date >= ?');
    params.push(parseDateParam(filters.transactionFrom, 'transactionFrom'));
  }
  if (filters.transactionTo) {
    where.push('p.transaction_date <= ?');
    params.push(parseDateParam(filters.transactionTo, 'transactionTo'));
  }
  if (scope && scope.length > 0) {
    where.push(`p.branch_code IN (${scope.map(() => '?').join(',')})`);
    params.push(...scope);
  }
  return { whereSql: where.length ? ` WHERE ${where.join(' AND ')}` : '', params };
}

function baseSelect(extraWhere = '') {
  return `SELECT p.*, a.nama_agent AS agent_name, b.branch_name
            FROM master_produksi p
       LEFT JOIN master_agent a ON a.agent_id_internal = p.agent_id_internal
       LEFT JOIN master_branch b ON b.branch_code = p.branch_code
            ${extraWhere}`;
}

function listProduction({ query = {}, paging, sort, scope = [], positions = false, limitOverride = null }) {
  const filters = { ...query };
  if (positions) filters.isCurrent = 'true';
  const { whereSql, params } = buildWhere(filters, scope);
  const finalWhere = positions
    ? `${whereSql ? `${whereSql} AND` : ' WHERE'} p.record_status = 'Active'`
    : whereSql;
  const total = queryOne(`SELECT COUNT(*) AS c FROM master_produksi p${finalWhere}`, params).c;
  const limit = limitOverride || paging.limit;
  const offset = limitOverride ? 0 : paging.offset;
  const rows = queryAll(
    `${baseSelect(finalWhere)} ORDER BY ${sort.clause} LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  return { rows, total };
}

function getProductionRow(productionId) {
  return queryOne(`${baseSelect(' WHERE p.production_id = ?')}`, [productionId]);
}

function traceFor(productionRow) {
  let uploadRow = queryOne(
    'SELECT * FROM upload_rows WHERE posted_record_id = ? ORDER BY created_at DESC LIMIT 1',
    [productionRow.production_id],
  );
  if (!uploadRow) {
    uploadRow = queryOne(
      'SELECT * FROM upload_rows WHERE source_row_hash = ? ORDER BY created_at DESC LIMIT 1',
      [productionRow.source_row_hash],
    );
  }
  let batch = null;
  let actor = null;
  if (uploadRow) {
    batch = queryOne(
      `SELECT b.*, u.full_name AS uploaded_by_name FROM upload_batches b
        LEFT JOIN users u ON u.user_id = b.uploaded_by
        WHERE b.upload_batch_id = ?`,
      [uploadRow.upload_batch_id],
    );
    if (batch) {
      actor = queryOne('SELECT user_id, full_name, role_key, email FROM users WHERE user_id = ?', [batch.uploaded_by]);
    }
  } else if (productionRow.upload_batch_id) {
    batch = queryOne(
      `SELECT b.*, u.full_name AS uploaded_by_name FROM upload_batches b
        LEFT JOIN users u ON u.user_id = b.uploaded_by
        WHERE b.upload_batch_id = ?`,
      [productionRow.upload_batch_id],
    );
  }
  return { uploadRow, batch, actor };
}

function getProductionDetail(productionId) {
  const record = getProductionRow(productionId);
  if (!record) throw notFound('Record produksi tidak ditemukan');
  const versions = queryAll(
    `${baseSelect(' WHERE p.business_key = ?')} ORDER BY p.version_no DESC`,
    [record.business_key],
  );
  return { record, versions, trace: traceFor(record) };
}

function cancelProduction(productionId, reason, actor) {
  const row = getProductionRow(productionId);
  if (!row) throw notFound('Record produksi tidak ditemukan');
  if (!reason || String(reason).trim() === '') {
    throw validation('Alasan pembatalan wajib diisi', [{ field: 'reason', message: 'Wajib diisi' }]);
  }
  if (row.record_status === 'Cancelled') {
    throw invalidState('Record produksi sudah dibatalkan');
  }
  const ts = nowIso();
  withTransaction(() => {
    execute(
      `UPDATE master_produksi
          SET record_status = 'Cancelled', is_current = 0, cancelled_at = ?, cancelled_by = ?,
              cancellation_reason = ?, updated_at = ?, updated_by = ?
        WHERE production_id = ?`,
      [ts, actor.userId, String(reason).trim(), ts, actor.userId, productionId],
    );
    recordAudit({
      entityType: 'PRODUCTION',
      entityId: productionId,
      action: 'CANCEL',
      actor,
      before: { recordStatus: row.record_status, isCurrent: row.is_current === 1 },
      after: { recordStatus: 'Cancelled', isCurrent: false, cancellationReason: String(reason).trim() },
      reason: String(reason).trim(),
      uploadBatchId: row.upload_batch_id,
    });
  });
  return getProductionRow(productionId);
}

module.exports = {
  SORT_WHITELIST,
  buildWhere,
  baseSelect,
  listProduction,
  getProductionRow,
  getProductionDetail,
  cancelProduction,
  traceFor,
  parseBoolFlag,
  maxExportRows: config.maxExportRows,
};
