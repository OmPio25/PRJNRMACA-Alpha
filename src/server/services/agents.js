'use strict';
/** Master Agent: daftar, detail + versi, create/update, pending mapping, resolve. */
const { queryAll, queryOne, execute, withTransaction, newId, nowIso } = require('../../../db/database');
const { businessKey } = require('../../../db/canonical');
const { AppError, validation, notFound, conflict } = require('../middleware/errors');
const { recordAudit } = require('./audit');
const hashSvc = require('./hash');
const upload = require('./upload');
const { parseJson } = require('../util/serialize');

const STATUSES = ['Active', 'Inactive'];

const SORT_WHITELIST = {
  agentKey: 'a.agent_key',
  kodeagen: 'a.kodeagen',
  namaAgent: 'a.nama_agent',
  branchCode: 'a.branch_code',
  statusAgent: 'a.status_agent',
  currentVersionNo: 'a.current_version_no',
  createdAt: 'a.created_at',
  updatedAt: 'a.updated_at',
};

function buildWhere({ q, branch, statusKey, scope = [] }, params, alias = 'a') {
  const where = [];
  if (q) {
    where.push(`(${alias}.agent_key LIKE ? OR ${alias}.nama_agent LIKE ? OR ${alias}.kodeagen LIKE ?)`);
    const pattern = `%${String(q)}%`;
    params.push(pattern, pattern, pattern);
  }
  if (branch) {
    where.push(`${alias}.branch_code = ?`);
    params.push(String(branch).toUpperCase());
  }
  if (statusKey) {
    where.push(`${alias}.status_agent = ?`);
    params.push(statusKey);
  }
  if (scope && scope.length > 0) {
    where.push(`${alias}.branch_code IN (${scope.map(() => '?').join(',')})`);
    params.push(...scope);
  }
  return where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '';
}

function listAgents({ query = {}, paging, sort, scope = [] }) {
  const params = [];
  const whereSql = buildWhere({ ...query, scope }, params);
  const total = queryOne(`SELECT COUNT(*) AS c FROM master_agent a${whereSql}`, params).c;
  const rows = queryAll(
    `SELECT a.*, b.branch_name
       FROM master_agent a
  LEFT JOIN master_branch b ON b.branch_code = a.branch_code
      ${whereSql}
   ORDER BY ${sort.clause}
      LIMIT ? OFFSET ?`,
    [...params, paging.limit, paging.offset],
  );
  return { rows, total };
}

function getAgentRow(agentId) {
  return queryOne(
    `SELECT a.*, b.branch_name
       FROM master_agent a
  LEFT JOIN master_branch b ON b.branch_code = a.branch_code
      WHERE a.agent_id_internal = ?`,
    [agentId],
  );
}

function getAgentDetail(agentId) {
  const agent = getAgentRow(agentId);
  if (!agent) throw notFound('Agent tidak ditemukan');
  const versions = queryAll(
    `SELECT * FROM master_agent_version
      WHERE agent_id_internal = ?
      ORDER BY version_no DESC`,
    [agentId],
  );
  const productionSummary = queryAll(
    `SELECT currency, COUNT(*) AS transaction_count,
            SUM(COALESCE(premium_minor, 0)) AS premium_minor,
            SUM(COALESCE(tsi_minor, 0)) AS tsi_minor
       FROM master_produksi
      WHERE agent_id_internal = ? AND is_current = 1 AND record_status = 'Active'
      GROUP BY currency
      ORDER BY currency`,
    [agentId],
  );
  const claimSummary = queryAll(
    `SELECT c.currency, COUNT(DISTINCT c.claim_id) AS claim_count,
            COUNT(s.claim_settlement_id) AS settlement_count,
            SUM(COALESCE(s.gross_claim_minor, 0)) AS gross_claim_minor,
            SUM(COALESCE(s.indemnity_minor, 0)) AS indemnity_minor
       FROM claim_master c
  LEFT JOIN claim_settlement s ON s.claim_id = c.claim_id AND s.is_current = 1 AND s.record_status = 'Active'
      WHERE c.agent_id_internal = ?
      GROUP BY c.currency
      ORDER BY c.currency`,
    [agentId],
  );
  return { agent, versions, productionSummary, claimSummary };
}

function validateBranch(branchCode) {
  if (!branchCode) return null;
  const code = String(branchCode).trim().toUpperCase();
  const row = queryOne('SELECT branch_code FROM master_branch WHERE branch_code = ?', [code]);
  if (!row) {
    throw validation('Cabang tidak ditemukan di master', [{ field: 'branchCode', message: 'Kode cabang tidak valid' }]);
  }
  return code;
}

function agentHash({ kodeagen, agentIdSource, namaAgent, branchCode, statusAgent }) {
  const cfg = hashSvc.requireConfig('AGENT');
  return hashSvc.hashFor('AGENT', {
    KODEAGEN: kodeagen,
    AgentIDSource: agentIdSource || null,
    NamaAgent: namaAgent || null,
    Cabang: branchCode || null,
    StatusAgent: statusAgent || null,
  }, cfg);
}

function createAgent(payload, actor) {
  const kodeagen = String(payload.kodeagen || '').trim().toUpperCase();
  if (!kodeagen) throw validation('KODEAGEN wajib diisi', [{ field: 'kodeagen', message: 'Wajib diisi' }]);
  const agentKey = businessKey([kodeagen]);
  const existing = queryOne('SELECT agent_id_internal FROM master_agent WHERE agent_key = ?', [agentKey]);
  if (existing) throw conflict(`Agent dengan kode ${kodeagen} sudah ada`, [{ field: 'kodeagen', message: 'Duplikat agent_key' }]);
  const branchCode = validateBranch(payload.branchCode);
  const statusAgent = payload.statusAgent ? String(payload.statusAgent).trim() : 'Active';
  if (!STATUSES.includes(statusAgent)) {
    throw validation('Status agent tidak valid', [{ field: 'statusAgent', message: `Gunakan: ${STATUSES.join(', ')}` }]);
  }
  const namaAgent = payload.namaAgent ? String(payload.namaAgent).trim() : null;
  const agentIdSource = payload.agentIdSource ? String(payload.agentIdSource).trim().toUpperCase() : kodeagen;
  const sourceHash = agentHash({ kodeagen, agentIdSource, namaAgent, branchCode, statusAgent });
  const agentId = newId('AGT');
  const ts = nowIso();
  withTransaction(() => {
    execute(
      `INSERT INTO master_agent
         (agent_id_internal, agent_key, kodeagen, agent_id_source, nama_agent, branch_code,
          status_agent, is_current, current_version_no, source_row_hash, upload_batch_id,
          created_at, created_by, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?, NULL, ?, ?, ?, ?)`,
      [agentId, agentKey, kodeagen, agentIdSource, namaAgent, branchCode, statusAgent, sourceHash, ts, actor.userId, ts, actor.userId],
    );
    execute(
      `INSERT INTO master_agent_version
         (agent_version_id, agent_id_internal, version_no, previous_version_id, kodeagen,
          agent_id_source, nama_agent, branch_code, status_agent, source_row_hash,
          upload_batch_id, is_current, change_reason, created_at, created_by)
       VALUES (?, ?, 1, NULL, ?, ?, ?, ?, ?, ?, NULL, 1, ?, ?, ?)`,
      [newId('AGV'), agentId, kodeagen, agentIdSource, namaAgent, branchCode, statusAgent, sourceHash, 'Dibuat manual oleh administrator', ts, actor.userId],
    );
    recordAudit({
      entityType: 'AGENT',
      entityId: agentId,
      action: 'CREATE',
      actor,
      after: { agentKey, kodeagen, namaAgent, branchCode, statusAgent },
    });
  });
  return getAgentDetail(agentId).agent;
}

function updateAgent(agentId, payload, actor) {
  const before = getAgentRow(agentId);
  if (!before) throw notFound('Agent tidak ditemukan');
  const branchCode = payload.branchCode === undefined ? before.branch_code : validateBranch(payload.branchCode);
  const namaAgent = payload.namaAgent === undefined ? before.nama_agent : String(payload.namaAgent).trim();
  const statusAgent = payload.statusAgent === undefined ? before.status_agent : String(payload.statusAgent).trim();
  if (!STATUSES.includes(statusAgent)) {
    throw validation('Status agent tidak valid', [{ field: 'statusAgent', message: `Gunakan: ${STATUSES.join(', ')}` }]);
  }
  if (payload.namaAgent === undefined && payload.branchCode === undefined && payload.statusAgent === undefined) {
    throw validation('Tidak ada field yang diubah');
  }
  const sourceHash = agentHash({
    kodeagen: before.kodeagen,
    agentIdSource: before.agent_id_source,
    namaAgent,
    branchCode,
    statusAgent,
  });
  const currentVersion = queryOne(
    'SELECT * FROM master_agent_version WHERE agent_id_internal = ? AND is_current = 1',
    [agentId],
  );
  const nextVersion = (currentVersion?.version_no || before.current_version_no) + 1;
  const ts = nowIso();
  withTransaction(() => {
    if (currentVersion) {
      execute('UPDATE master_agent_version SET is_current = 0 WHERE agent_version_id = ?', [currentVersion.agent_version_id]);
    }
    execute(
      `UPDATE master_agent
          SET nama_agent = ?, branch_code = ?, status_agent = ?, current_version_no = ?,
              source_row_hash = ?, updated_at = ?, updated_by = ?
        WHERE agent_id_internal = ?`,
      [namaAgent, branchCode, statusAgent, nextVersion, sourceHash, ts, actor.userId, agentId],
    );
    execute(
      `INSERT INTO master_agent_version
         (agent_version_id, agent_id_internal, version_no, previous_version_id, kodeagen,
          agent_id_source, nama_agent, branch_code, status_agent, source_row_hash,
          upload_batch_id, is_current, change_reason, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      [
        newId('AGV'), agentId, nextVersion, currentVersion?.agent_version_id || null,
        before.kodeagen, before.agent_id_source, namaAgent, branchCode, statusAgent, sourceHash,
        before.upload_batch_id, 'Perubahan master agent manual', ts, actor.userId,
      ],
    );
    recordAudit({
      entityType: 'AGENT',
      entityId: agentId,
      action: 'UPDATE',
      actor,
      before: { namaAgent: before.nama_agent, branchCode: before.branch_code, statusAgent: before.status_agent, versionNo: before.current_version_no },
      after: { namaAgent, branchCode, statusAgent, versionNo: nextVersion },
    });
  });
  return getAgentDetail(agentId).agent;
}

function pendingMapping(scope = []) {
  const params = [];
  let scopeSql = '';
  if (scope.length > 0) {
    scopeSql = ` AND (json_extract(r.normalized_payload, '$.Cabang') IS NULL OR json_extract(r.normalized_payload, '$.Cabang') IN (${scope.map(() => '?').join(',')}))`;
    params.push(...scope);
  }
  const rows = queryAll(
    `SELECT r.*, b.upload_type, b.original_file_name, b.processing_status
       FROM upload_rows r
       JOIN upload_batches b ON b.upload_batch_id = r.upload_batch_id
      WHERE r.validation_status = 'Pending Mapping'${scopeSql}
      ORDER BY r.created_at DESC`,
    params,
  );
  const groups = new Map();
  for (const row of rows) {
    const normalized = parseJson(row.normalized_payload, {});
    const kodeagen = normalized.KodeAgen || normalized.KODEAGEN || null;
    if (!kodeagen) continue;
    if (!groups.has(kodeagen)) {
      groups.set(kodeagen, {
        kodeagen,
        count: 0,
        batchIds: [],
        sampleRows: [],
      });
    }
    const group = groups.get(kodeagen);
    group.count += 1;
    if (!group.batchIds.includes(row.upload_batch_id)) group.batchIds.push(row.upload_batch_id);
    if (group.sampleRows.length < 3) {
      group.sampleRows.push({
        uploadRowId: row.upload_row_id,
        uploadBatchId: row.upload_batch_id,
        sourceRowNumber: row.source_row_number,
        policyNo: normalized.PolicyNo || null,
        validationMessage: row.validation_message,
        rawPayload: parseJson(row.raw_payload, {}),
      });
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

function resolveMapping({ kodeagen, action, agentIdInternal = null, payload = {}, actor }) {
  const code = String(kodeagen || '').trim().toUpperCase();
  if (!code) throw validation('kodeagen wajib diisi', [{ field: 'kodeagen', message: 'Wajib diisi' }]);
  const normalizedAction = String(action || '').toUpperCase();
  if (!['CREATE', 'MAP', 'ASSIGN'].includes(normalizedAction)) {
    throw validation('action tidak valid', [{ field: 'action', message: 'Gunakan CREATE, MAP, atau ASSIGN' }]);
  }

  const staged = queryOne(
    `SELECT r.* FROM upload_rows r
      WHERE r.validation_status = 'Pending Mapping'
        AND upper(json_extract(r.normalized_payload, '$.KodeAgen')) = ?
      ORDER BY r.created_at DESC LIMIT 1`,
    [code],
  );
  const stagedNormalized = staged ? parseJson(staged.normalized_payload, {}) : {};

  let agent;
  if (normalizedAction === 'CREATE') {
    const existing = queryOne('SELECT agent_id_internal FROM master_agent WHERE agent_key = ?', [code]);
    if (existing) {
      agent = getAgentDetail(existing.agent_id_internal).agent;
    } else {
      agent = createAgent({
        kodeagen: code,
        agentIdSource: payload.agentIdSource || code,
        namaAgent: payload.namaAgent || stagedNormalized.NamaAgent || `Agen ${code}`,
        branchCode: payload.branchCode || stagedNormalized.Cabang || null,
        statusAgent: payload.statusAgent || 'Active',
      }, actor);
    }
  } else {
    if (!agentIdInternal) {
      throw validation('agentIdInternal wajib diisi untuk action MAP/ASSIGN', [
        { field: 'agentIdInternal', message: 'Wajib diisi' },
      ]);
    }
    const target = getAgentRow(agentIdInternal);
    if (!target) throw notFound('Agent tujuan tidak ditemukan');
    const resolved = queryOne(
      `SELECT agent_id_internal FROM master_agent
        WHERE agent_key = ? OR kodeagen = ? OR agent_id_source = ? LIMIT 1`,
      [code, code, code],
    );
    if (resolved && resolved.agent_id_internal !== target.agent_id_internal) {
      throw conflict(`Kode agen ${code} sudah termapping ke agent lain`, [
        { field: 'kodeagen', message: 'Sudah dipakai agent lain' },
      ]);
    }
    // Schema master_mapping tidak mengizinkan mapping_type AGENT, sehingga tautan
    // kode sumber disimpan sebagai agent_id_source pada agent tujuan (audit before/after).
    const ts = nowIso();
    withTransaction(() => {
      execute(
        'UPDATE master_agent SET agent_id_source = ?, updated_at = ?, updated_by = ? WHERE agent_id_internal = ?',
        [code, ts, actor.userId, target.agent_id_internal],
      );
      recordAudit({
        entityType: 'AGENT',
        entityId: target.agent_id_internal,
        action: 'UPDATE',
        actor,
        before: { agentIdSource: target.agent_id_source },
        after: { agentIdSource: code, mappedKodeagen: code },
        reason: `Mapping kode agen ${code} ke agent ${target.agent_id_internal}`,
      });
    });
    agent = getAgentDetail(target.agent_id_internal).agent;
  }

  const reclassified = upload.reclassifyPending({ kodeagen: code, actor });
  return { agent, affectedRows: reclassified.affectedRows };
}

module.exports = {
  SORT_WHITELIST,
  listAgents,
  getAgentDetail,
  createAgent,
  updateAgent,
  pendingMapping,
  resolveMapping,
  getAgentRow,
};
