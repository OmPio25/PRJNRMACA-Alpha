'use strict';
/**
 * Audit trail. `recordAudit` TIDAK membuka transaksi sendiri: harus dipanggil
 * di dalam transaksi perubahan agar audit dan data berubah bersama.
 */
const { execute, queryOne, queryAll, newId, nowIso } = require('../../../db/database');

function actorFields(actor) {
  if (!actor) return { id: null, role: null, name: null };
  if (typeof actor === 'string') return { id: actor, role: null, name: null };
  return {
    id: actor.userId || actor.user_id || null,
    role: actor.roleKey || actor.role_key || null,
    name: actor.fullName || actor.full_name || null,
  };
}

function recordAudit({
  entityType,
  entityId,
  action,
  actor = null,
  before = null,
  after = null,
  reason = null,
  uploadBatchId = null,
  ipAddress = null,
}) {
  if (!entityType || !entityId || !action) {
    throw new Error('recordAudit membutuhkan entityType, entityId, dan action');
  }
  const who = actorFields(actor);
  const auditId = newId('AUD');
  execute(
    `INSERT INTO audit_log
       (audit_id, entity_type, entity_id, action, actor_id, actor_role, actor_name,
        occurred_at, before_json, after_json, reason, upload_batch_id, ip_address)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      auditId,
      entityType,
      entityId,
      action,
      who.id,
      who.role,
      who.name,
      nowIso(),
      before === null || before === undefined ? null : JSON.stringify(before),
      after === null || after === undefined ? null : JSON.stringify(after),
      reason,
      uploadBatchId,
      ipAddress,
    ],
  );
  return auditId;
}

function listAudit({ query = {}, paging }) {
  const where = [];
  const params = [];
  if (query.entityType) { where.push('entity_type = ?'); params.push(String(query.entityType).toUpperCase()); }
  if (query.entityId) { where.push('entity_id = ?'); params.push(query.entityId); }
  if (query.action) { where.push('action = ?'); params.push(String(query.action).toUpperCase()); }
  if (query.actorId) { where.push('actor_id = ?'); params.push(query.actorId); }
  if (query.from) { where.push('date(occurred_at) >= ?'); params.push(query.from); }
  if (query.to) { where.push('date(occurred_at) <= ?'); params.push(query.to); }
  const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const total = queryOne(
    `SELECT COUNT(*) AS c FROM audit_log${whereSql}`,
    params,
  ).c;
  const rows = queryAll(
    `SELECT * FROM audit_log${whereSql}
      ORDER BY occurred_at DESC, audit_id DESC
      LIMIT ? OFFSET ?`,
    [...params, paging.limit, paging.offset],
  );
  return { rows, total };
}

function traceRecord(recordType, recordId) {
  const { serializeAgent, serializeProduction, serializeClaim, serializeSettlement } = require('../util/serialize');
  const type = String(recordType || '').toUpperCase();
  let record = null;
  let uploadRow = null;
  let batch = null;
  let actor = null;
  let batchId = null;

  if (type === 'PRODUCTION') {
    const row = queryOne(
      `SELECT p.*, a.nama_agent AS agent_name, b.branch_name
         FROM master_produksi p
    LEFT JOIN master_agent a ON a.agent_id_internal = p.agent_id_internal
    LEFT JOIN master_branch b ON b.branch_code = p.branch_code
        WHERE p.production_id = ?`,
      [recordId],
    );
    if (!row) return null;
    record = serializeProduction(row);
    uploadRow = queryOne(
      'SELECT * FROM upload_rows WHERE posted_record_id = ? ORDER BY created_at DESC LIMIT 1',
      [recordId],
    ) || queryOne('SELECT * FROM upload_rows WHERE source_row_hash = ? ORDER BY created_at DESC LIMIT 1', [row.source_row_hash]);
    batchId = uploadRow ? uploadRow.upload_batch_id : row.upload_batch_id;
  } else if (type === 'AGENT') {
    const row = queryOne(
      `SELECT a.*, b.branch_name FROM master_agent a
    LEFT JOIN master_branch b ON b.branch_code = a.branch_code
        WHERE a.agent_id_internal = ?`,
      [recordId],
    );
    if (!row) return null;
    record = serializeAgent(row);
    uploadRow = queryOne(
      'SELECT * FROM upload_rows WHERE source_row_hash = ? ORDER BY created_at DESC LIMIT 1',
      [row.source_row_hash],
    );
    batchId = uploadRow ? uploadRow.upload_batch_id : row.upload_batch_id;
  } else if (type === 'CLAIM') {
    const row = queryOne(
      `SELECT c.*, a.nama_agent AS agent_name, b.branch_name
         FROM claim_master c
    LEFT JOIN master_agent a ON a.agent_id_internal = c.agent_id_internal
    LEFT JOIN master_branch b ON b.branch_code = c.branch_code
        WHERE c.claim_id = ?`,
      [recordId],
    );
    if (!row) return null;
    record = serializeClaim({ ...row, settlements_by_currency: [] });
    uploadRow = queryOne(
      `SELECT * FROM upload_rows WHERE business_key = ? AND validation_status = 'Posted'
        ORDER BY created_at DESC LIMIT 1`,
      [row.claim_key],
    );
    batchId = row.upload_batch_id;
  } else if (type === 'SETTLEMENT') {
    const row = queryOne(
      'SELECT s.*, c.claim_no FROM claim_settlement s JOIN claim_master c ON c.claim_id = s.claim_id WHERE s.claim_settlement_id = ?',
      [recordId],
    );
    if (!row) return null;
    record = serializeSettlement(row);
    uploadRow = queryOne(
      'SELECT * FROM upload_rows WHERE posted_record_id = ? ORDER BY created_at DESC LIMIT 1',
      [recordId],
    ) || queryOne('SELECT * FROM upload_rows WHERE source_row_hash = ? ORDER BY created_at DESC LIMIT 1', [row.source_row_hash]);
    batchId = uploadRow ? uploadRow.upload_batch_id : row.upload_batch_id;
  } else {
    return null;
  }

  if (batchId) {
    batch = queryOne(
      `SELECT b.*, u.full_name AS uploaded_by_name FROM upload_batches b
        LEFT JOIN users u ON u.user_id = b.uploaded_by
        WHERE b.upload_batch_id = ?`,
      [batchId],
    );
    if (batch) {
      actor = queryOne('SELECT user_id, full_name, role_key, email FROM users WHERE user_id = ?', [batch.uploaded_by]);
    }
  }
  return { recordType: type, record, uploadRow, batch, actor };
}

module.exports = { recordAudit, listAudit, traceRecord };
