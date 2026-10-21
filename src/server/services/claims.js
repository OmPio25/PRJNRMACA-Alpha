'use strict';
/** Claim: identitas claim + settlement, agregat per currency, pembatalan settlement. */
const { queryAll, queryOne, execute, withTransaction, nowIso } = require('../../../db/database');
const { validation, notFound, invalidState } = require('../middleware/errors');
const { recordAudit } = require('./audit');
const { serializeClaim, serializeSettlement, parseJson } = require('../util/serialize');
const { parseDateParam } = require('../util/http');
const config = require('../config');

const SORT_WHITELIST = {
  claimNo: 'c.claim_no',
  policyNo: 'c.policy_no',
  uwYear: 'c.uw_year',
  lossDate: 'c.loss_date',
  claimStatus: 'c.claim_status',
  createdAt: 'c.created_at',
  settlementCount: `(SELECT COUNT(*) FROM claim_settlement s WHERE s.claim_id = c.claim_id AND s.is_current = 1 AND s.record_status = 'Active')`,
};

function buildWhere(filters = {}, scope = []) {
  const where = [];
  const params = [];
  if (filters.claimNo) {
    where.push('c.claim_no LIKE ?');
    params.push(`%${String(filters.claimNo).toUpperCase()}%`);
  }
  if (filters.policyNo) {
    where.push('c.policy_no LIKE ?');
    params.push(`%${String(filters.policyNo).toUpperCase()}%`);
  }
  if (filters.agentId) {
    where.push('c.agent_id_internal = ?');
    params.push(filters.agentId);
  }
  if (filters.uwYear !== undefined && filters.uwYear !== null && filters.uwYear !== '') {
    const year = Number(filters.uwYear);
    if (!Number.isInteger(year)) {
      throw validation('Filter uwYear tidak valid', [{ field: 'uwYear', message: 'Harus tahun 4 digit' }]);
    }
    where.push('c.uw_year = ?');
    params.push(year);
  }
  if (filters.branch) {
    where.push('c.branch_code = ?');
    params.push(String(filters.branch).toUpperCase());
  }
  if (filters.currency) {
    where.push('c.currency = ?');
    params.push(String(filters.currency).toUpperCase());
  }
  if (filters.causeOfLoss) {
    where.push('c.cause_of_loss = ?');
    params.push(String(filters.causeOfLoss).toUpperCase());
  }
  if (filters.settledFrom) {
    where.push(`EXISTS (SELECT 1 FROM claim_settlement sx WHERE sx.claim_id = c.claim_id
                 AND sx.is_current = 1 AND sx.record_status = 'Active' AND sx.date_of_settlement >= ?)`);
    params.push(parseDateParam(filters.settledFrom, 'settledFrom'));
  }
  if (filters.settledTo) {
    where.push(`EXISTS (SELECT 1 FROM claim_settlement sx WHERE sx.claim_id = c.claim_id
                 AND sx.is_current = 1 AND sx.record_status = 'Active' AND sx.date_of_settlement <= ?)`);
    params.push(parseDateParam(filters.settledTo, 'settledTo'));
  }
  if (scope && scope.length > 0) {
    where.push(`c.branch_code IN (${scope.map(() => '?').join(',')})`);
    params.push(...scope);
  }
  return { whereSql: where.length ? ` WHERE ${where.join(' AND ')}` : '', params };
}

function baseSelect(whereSql) {
  return `SELECT c.*, a.nama_agent AS agent_name, b.branch_name
            FROM claim_master c
       LEFT JOIN master_agent a ON a.agent_id_internal = c.agent_id_internal
       LEFT JOIN master_branch b ON b.branch_code = c.branch_code
            ${whereSql}`;
}

function settlementsByCurrency(claimIds) {
  if (claimIds.length === 0) return new Map();
  const placeholders = claimIds.map(() => '?').join(',');
  const rows = queryAll(
    `SELECT claim_id, currency, COUNT(*) AS settlement_count,
            SUM(COALESCE(gross_claim_minor, 0)) AS gross_claim_minor,
            SUM(COALESCE(indemnity_minor, 0)) AS indemnity_minor,
            SUM(COALESCE(deductible_minor, 0)) AS deductible_minor,
            SUM(COALESCE(salvage_minor, 0)) AS salvage_minor,
            SUM(COALESCE(subrogation_minor, 0)) AS subrogation_minor
       FROM claim_settlement
      WHERE is_current = 1 AND record_status = 'Active'
        AND claim_id IN (${placeholders})
      GROUP BY claim_id, currency
      ORDER BY currency`,
    claimIds,
  );
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.claim_id)) map.set(row.claim_id, []);
    map.get(row.claim_id).push(row);
  }
  return map;
}

function decorate(row, aggregates) {
  const byCurrency = aggregates.get(row.claim_id) || [];
  const primary = byCurrency[0] || null;
  return serializeClaim({
    ...row,
    settlement_count: byCurrency.reduce((sum, entry) => sum + entry.settlement_count, 0),
    settlements_by_currency: byCurrency,
    settlement_currency: primary ? primary.currency : null,
    settled_amount: primary ? primary.gross_claim_minor : null,
  });
}

function listClaims({ query = {}, paging, sort, scope = [], limitOverride = null }) {
  const { whereSql, params } = buildWhere(query, scope);
  const total = queryOne(`SELECT COUNT(*) AS c FROM claim_master c${whereSql}`, params).c;
  const limit = limitOverride || paging.limit;
  const offset = limitOverride ? 0 : paging.offset;
  const rows = queryAll(
    `${baseSelect(whereSql)} ORDER BY ${sort.clause} LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  const aggregates = settlementsByCurrency(rows.map((row) => row.claim_id));
  return { rows: rows.map((row) => decorate(row, aggregates)), total };
}

function getClaimRow(claimId) {
  return queryOne(`${baseSelect(' WHERE c.claim_id = ?')}`, [claimId]);
}

function claimTrace(claimRow) {
  let uploadRow = queryOne(
    'SELECT * FROM upload_rows WHERE posted_record_id = ? ORDER BY created_at DESC LIMIT 1',
    [claimRow.claim_id],
  );
  if (!uploadRow) {
    uploadRow = queryOne(
      `SELECT r.* FROM upload_rows r
        WHERE r.business_key = ? AND r.validation_status = 'Posted'
        ORDER BY r.created_at DESC LIMIT 1`,
      [claimRow.claim_key],
    );
  }
  let batch = null;
  if (claimRow.upload_batch_id) {
    batch = queryOne(
      `SELECT b.*, u.full_name AS uploaded_by_name FROM upload_batches b
        LEFT JOIN users u ON u.user_id = b.uploaded_by WHERE b.upload_batch_id = ?`,
      [claimRow.upload_batch_id],
    );
  }
  const actor = batch
    ? queryOne('SELECT user_id, full_name, role_key, email FROM users WHERE user_id = ?', [batch.uploaded_by])
    : null;
  return { uploadRow, batch, actor };
}

function getClaimDetail(claimId) {
  const row = getClaimRow(claimId);
  if (!row) throw notFound('Claim tidak ditemukan');
  const aggregates = settlementsByCurrency([claimId]);
  const claim = decorate(row, aggregates);
  const settlements = queryAll(
    `SELECT * FROM claim_settlement WHERE claim_id = ? ORDER BY date_of_settlement DESC, version_no DESC`,
    [claimId],
  );
  return {
    claim,
    settlements: settlements.map(serializeSettlement),
    trace: claimTrace(row),
  };
}

function cancelSettlement(claimId, settlementId, reason, actor) {
  if (!reason || String(reason).trim() === '') {
    throw validation('Alasan pembatalan wajib diisi', [{ field: 'reason', message: 'Wajib diisi' }]);
  }
  const settlement = queryOne(
    'SELECT * FROM claim_settlement WHERE claim_settlement_id = ? AND claim_id = ?',
    [settlementId, claimId],
  );
  if (!settlement) throw notFound('Settlement tidak ditemukan untuk claim ini');
  if (settlement.record_status === 'Cancelled') throw invalidState('Settlement sudah dibatalkan');
  const ts = nowIso();
  withTransaction(() => {
    execute(
      `UPDATE claim_settlement
          SET record_status = 'Cancelled', is_current = 0, cancelled_at = ?, cancelled_by = ?,
              cancellation_reason = ?, updated_at = ?, updated_by = ?
        WHERE claim_settlement_id = ?`,
      [ts, actor.userId, String(reason).trim(), ts, actor.userId, settlementId],
    );
    recordAudit({
      entityType: 'SETTLEMENT',
      entityId: settlementId,
      action: 'CANCEL',
      actor,
      before: { recordStatus: settlement.record_status, isCurrent: settlement.is_current === 1, claimId },
      after: {
        recordStatus: 'Cancelled', isCurrent: false,
        cancellationReason: String(reason).trim(), claimId,
      },
      reason: String(reason).trim(),
      uploadBatchId: settlement.upload_batch_id,
    });
  });
  return serializeSettlement(queryOne('SELECT * FROM claim_settlement WHERE claim_settlement_id = ?', [settlementId]));
}

module.exports = {
  SORT_WHITELIST,
  buildWhere,
  baseSelect,
  listClaims,
  getClaimRow,
  getClaimDetail,
  cancelSettlement,
  settlementsByCurrency,
  maxExportRows: config.maxExportRows,
};
