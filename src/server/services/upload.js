'use strict';
/**
 * Pipeline upload: create -> staging/normalisasi/hash/klasifikasi -> review ->
 * posting. Semua tulisan multi-tabel dibungkus satu transaksi (termasuk audit).
 */
const fs = require('node:fs');
const path = require('node:path');
const { queryAll, queryOne, execute, withTransaction, newId, nowIso } = require('../../../db/database');
const { sha256Hex, businessKey } = require('../../../db/canonical');
const config = require('../config');
const { AppError, validation, invalidState, notFound, conflict } = require('../middleware/errors');
const { recordAudit } = require('./audit');
const { parseFile } = require('./parse-file');
const normalize = require('./normalize');
const hashSvc = require('./hash');
const { loadRules } = require('./settings');
const { parseJson, batchSummary } = require('../util/serialize');

const UPLOAD_TYPES = ['AGENT', 'PRODUCTION', 'CLAIM'];
const EXTENSIONS = ['.csv', '.xlsx', '.xls'];
const MIME_ALLOWED = {
  '.csv': ['text/csv', 'application/csv', 'application/vnd.ms-excel', 'text/plain', 'application/octet-stream', ''],
  '.xlsx': [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/zip',
    'application/octet-stream',
    '',
  ],
  '.xls': ['application/vnd.ms-excel', 'application/octet-stream', ''],
};

function now() {
  return nowIso();
}

function getBatchRow(uploadBatchId) {
  return queryOne(
    `SELECT b.*, u.full_name AS uploaded_by_name
       FROM upload_batches b
  LEFT JOIN users u ON u.user_id = b.uploaded_by
      WHERE b.upload_batch_id = ?`,
    [uploadBatchId],
  );
}

function requireBatch(uploadBatchId) {
  const batch = getBatchRow(uploadBatchId);
  if (!batch) throw notFound('Batch upload tidak ditemukan');
  return batch;
}

function duplicateFilesFor(batch) {
  return queryAll(
    `SELECT upload_batch_id, original_file_name, uploaded_at, uploaded_by
       FROM upload_batches
      WHERE file_content_hash = ? AND upload_batch_id <> ?
      ORDER BY uploaded_at DESC
      LIMIT 20`,
    [batch.file_content_hash, batch.upload_batch_id],
  );
}

function absoluteStoredPath(batch) {
  if (!batch.stored_file_path) return null;
  const resolved = path.isAbsolute(batch.stored_file_path)
    ? batch.stored_file_path
    : path.join(config.appRoot, batch.stored_file_path);
  if (!fs.existsSync(resolved)) return null;
  return resolved;
}

function assertUploadType(uploadType) {
  const type = String(uploadType || '').trim().toUpperCase();
  if (!UPLOAD_TYPES.includes(type)) {
    throw validation('Jenis upload tidak valid', [{
      field: 'uploadType',
      message: `Gunakan salah satu dari: ${UPLOAD_TYPES.join(', ')}`,
    }]);
  }
  return type;
}

function assertDateFormat(dateFormat) {
  if (dateFormat === undefined || dateFormat === null || dateFormat === '') return null;
  const normalized = String(dateFormat).trim().toUpperCase();
  if (!normalize.DATE_FORMATS.includes(normalized)) {
    throw validation('Format tanggal tidak valid', [{
      field: 'dateFormat',
      message: `Gunakan salah satu dari: ${normalize.DATE_FORMATS.join(', ')}`,
    }]);
  }
  return normalized;
}

function createBatch({ file, uploadType, remarks = null, dateFormat = null, actor }) {
  if (!file || !file.buffer || file.buffer.length === 0) {
    throw new AppError('UPLOAD_INVALID', 422, 'File wajib diunggah', [{ field: 'file', message: 'File wajib diunggah' }]);
  }
  const type = assertUploadType(uploadType);
  const originalFileName = path.basename(String(file.originalname || 'upload.csv'));
  const ext = path.extname(originalFileName).toLowerCase();
  if (!EXTENSIONS.includes(ext)) {
    throw new AppError('UPLOAD_INVALID', 422, `Ekstensi file tidak didukung: ${ext || '(tanpa ekstensi)'}`, [
      { field: 'file', message: 'Gunakan file .csv, .xlsx, atau .xls' },
    ]);
  }
  const mime = String(file.mimetype || '').toLowerCase();
  if (!MIME_ALLOWED[ext].includes(mime)) {
    throw new AppError('UPLOAD_INVALID', 422, `Tipe file (${mime}) tidak sesuai dengan ekstensi ${ext}`, [
      { field: 'file', message: 'MIME type tidak diizinkan' },
    ]);
  }
  if (file.size !== undefined && file.size > config.maxUploadBytes) {
    throw new AppError('UPLOAD_INVALID', 422, 'Ukuran file melebihi batas 10 MB', [
      { field: 'file', message: 'Ukuran file terlalu besar' },
    ]);
  }
  const format = assertDateFormat(dateFormat);
  const hashCfg = hashSvc.requireConfig(type);
  const batchId = newId('UPL');
  const contentHash = `sha256:${sha256Hex(file.buffer)}`;
  fs.mkdirSync(config.uploadDir, { recursive: true });
  const storedName = `${batchId}__${contentHash.slice(7, 19)}${ext}`;
  const storedAbsolute = path.join(config.uploadDir, storedName);
  fs.writeFileSync(storedAbsolute, file.buffer);
  const storedRelative = path.relative(config.appRoot, storedAbsolute);
  const ts = now();
  const remarksText = remarks === null || remarks === undefined || String(remarks).trim() === ''
    ? null
    : String(remarks).trim();

  withTransaction(() => {
    execute(
      `INSERT INTO upload_batches
         (upload_batch_id, upload_type, original_file_name, stored_file_path, file_size_bytes,
          file_content_hash, uploaded_by, uploaded_at, processing_status, hash_config_version,
          date_format, remarks, created_at, created_by, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Uploaded', ?, ?, ?, ?, ?, ?, ?)`,
      [
        batchId, type, originalFileName, storedRelative, file.size ?? file.buffer.length,
        contentHash, actor.userId, ts, hashCfg.version, format, remarksText, ts, actor.userId, ts, actor.userId,
      ],
    );
    recordAudit({
      entityType: 'UPLOAD_BATCH',
      entityId: batchId,
      action: 'CREATE',
      actor,
      after: {
        uploadType: type,
        originalFileName,
        fileContentHash: contentHash,
        fileSizeBytes: file.size ?? file.buffer.length,
        processingStatus: 'Uploaded',
      },
      uploadBatchId: batchId,
    });
  });

  const batch = getBatchRow(batchId);
  return {
    batch,
    duplicateFiles: duplicateFilesFor(batch),
  };
}

function pendingFromErrors(errors, rules) {
  if (errors.length === 0) return false;
  const allPending = errors.every((error) => error.pending === true);
  return allPending && rules.unmappedAgentAction !== 'REJECT';
}

function errorMessage(errors) {
  const shown = errors.slice(0, 3).map((error) => error.message);
  const suffix = errors.length > 3 ? ` (+${errors.length - 3} error lain)` : '';
  return shown.join('; ') + suffix;
}

function classifyAgent(normalized, ctx, cfg) {
  const key = businessKey([normalized.KODEAGEN || normalized.AgentIDSource || '']);
  const hash = hashSvc.hashFor('AGENT', normalized, cfg);
  const existing = queryOne(
    'SELECT agent_id_internal, source_row_hash FROM master_agent WHERE agent_key = ?',
    [key],
  );
  if (!existing) return { status: 'New', businessKey: key, hash };
  if (existing.source_row_hash === hash) {
    return {
      status: 'Duplicate',
      businessKey: key,
      hash,
      duplicateOf: existing.agent_id_internal,
      message: `SourceRowHash sudah pernah diposting pada agent ${existing.agent_id_internal}`,
    };
  }
  return {
    status: 'Changed',
    businessKey: key,
    hash,
    message: 'Data agent berubah; akan dibuat versi master agent baru',
  };
}

function classifyProduction(normalized, ctx, cfg, rules) {
  const key = hashSvc.businessKeyFor('PRODUCTION', normalized, cfg, rules);
  const hash = hashSvc.hashFor('PRODUCTION', normalized, cfg);
  if (normalized.KodeAgen && !normalized.agentIdInternal) {
    const status = rules.unmappedAgentAction === 'REJECT' ? 'Rejected' : 'Pending Mapping';
    return {
      status,
      businessKey: key,
      hash,
      message: `Kode agen ${normalized.KodeAgen} belum termapping ke Master Agent`,
    };
  }
  const postedHash = queryOne(
    'SELECT production_id FROM master_produksi WHERE source_row_hash = ?',
    [hash],
  );
  if (postedHash) {
    return {
      status: 'Duplicate',
      businessKey: key,
      hash,
      duplicateOf: postedHash.production_id,
      message: `SourceRowHash sudah pernah diposting pada ${postedHash.production_id}`,
    };
  }
  const current = queryOne(
    `SELECT production_id, source_row_hash, version_no
       FROM master_produksi
      WHERE business_key = ?
      ORDER BY is_current DESC, version_no DESC
      LIMIT 1`,
    [key],
  );
  if (!current) return { status: 'New', businessKey: key, hash };
  return {
    status: 'Changed',
    businessKey: key,
    hash,
    message: `Business key sama dengan ${current.production_id}; akan dibuat versi ${current.version_no + 1}`,
  };
}

function classifyClaim(normalized, ctx, cfg, rules) {
  const key = hashSvc.businessKeyFor('CLAIM', normalized, cfg, rules);
  const hash = hashSvc.hashFor('CLAIM', normalized, cfg);
  const postedHash = queryOne(
    'SELECT claim_settlement_id, claim_id FROM claim_settlement WHERE source_row_hash = ?',
    [hash],
  );
  if (postedHash) {
    return {
      status: 'Duplicate',
      businessKey: key,
      hash,
      duplicateOf: postedHash.claim_settlement_id,
      message: `Settlement hash sudah pernah diposting pada ${postedHash.claim_settlement_id}`,
    };
  }
  const claim = queryOne('SELECT claim_id FROM claim_master WHERE claim_key = ?', [key]);
  if (!claim) return { status: 'New', businessKey: key, hash };
  if (normalized.SettlementNo) {
    const existing = queryOne(
      `SELECT claim_settlement_id, gross_claim_minor
         FROM claim_settlement
        WHERE claim_id = ? AND settlement_no = ? AND is_current = 1 AND record_status = 'Active'
        LIMIT 1`,
      [claim.claim_id, normalized.SettlementNo],
    );
    if (existing) {
      return {
        status: 'Changed',
        businessKey: key,
        hash,
        message: `Settlement ${normalized.SettlementNo} sudah ada; nominal berubah sehingga dibuat versi baru`,
      };
    }
  }
  return {
    status: 'New',
    businessKey: key,
    hash,
    message: 'Settlement tambahan untuk claim yang sudah ada',
  };
}

function classifyRow(uploadType, normalized, ctx, cfg, rules) {
  if (uploadType === 'AGENT') return classifyAgent(normalized, ctx, cfg);
  if (uploadType === 'PRODUCTION') return classifyProduction(normalized, ctx, cfg, rules);
  return classifyClaim(normalized, ctx, cfg, rules);
}

function refreshBatchCounters(batchId) {
  const counts = queryOne(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN COALESCE(classification, validation_status) = 'New' THEN 1 ELSE 0 END) AS new_rows,
            SUM(CASE WHEN COALESCE(classification, validation_status) = 'Duplicate' THEN 1 ELSE 0 END) AS duplicate_rows,
            SUM(CASE WHEN COALESCE(classification, validation_status) = 'Changed' THEN 1 ELSE 0 END) AS changed_rows,
            SUM(CASE WHEN COALESCE(classification, validation_status) = 'Rejected' THEN 1 ELSE 0 END) AS rejected_rows,
            SUM(CASE WHEN COALESCE(classification, validation_status) = 'Pending Mapping' THEN 1 ELSE 0 END) AS pending_rows,
            SUM(CASE WHEN validation_status = 'Posted' THEN 1 ELSE 0 END) AS posted_rows
       FROM upload_rows WHERE upload_batch_id = ?`,
    [batchId],
  ) || {};
  execute(
    `UPDATE upload_batches
        SET total_rows = ?, new_rows = ?, duplicate_rows = ?, changed_rows = ?,
            rejected_rows = ?, pending_mapping_rows = ?, posted_rows = ?, updated_at = ?
      WHERE upload_batch_id = ?`,
    [
      counts.total || 0, counts.new_rows || 0, counts.duplicate_rows || 0, counts.changed_rows || 0,
      counts.rejected_rows || 0, counts.pending_rows || 0, counts.posted_rows || 0, now(), batchId,
    ],
  );
}

async function validateBatch(batchId, actor) {
  const batch = requireBatch(batchId);
  if (!['Uploaded', 'Ready for Review', 'Failed'].includes(batch.processing_status)) {
    throw invalidState(`Batch berstatus ${batch.processing_status} tidak dapat divalidasi ulang`);
  }
  const absolute = absoluteStoredPath(batch);
  if (!absolute) {
    throw new AppError('UPLOAD_INVALID', 422, 'File asli batch tidak ditemukan di storage');
  }
  const type = batch.upload_type;
  const cfg = hashSvc.decodeConfig(
    hashSvc.loadHashConfig(type, batch.hash_config_version) || hashSvc.requireConfig(type),
  );
  if (!cfg || !cfg.columns || cfg.columns.length === 0) {
    throw new AppError('INVALID_STATE', 409, `Konfigurasi hash untuk ${type} tidak tersedia`);
  }
  const rules = loadRules();
  const ctx = normalize.loadNormalizationContext({ dateFormat: batch.date_format });

  execute(
    'UPDATE upload_batches SET processing_status = ?, updated_at = ?, updated_by = ? WHERE upload_batch_id = ?',
    ['Validating', now(), actor.userId, batchId],
  );
  recordAudit({
    entityType: 'UPLOAD_BATCH',
    entityId: batchId,
    action: 'STATUS_CHANGE',
    actor,
    before: { processingStatus: batch.processing_status },
    after: { processingStatus: 'Validating' },
    uploadBatchId: batchId,
  });

  let parsed;
  try {
    parsed = await parseFile(fs.readFileSync(absolute), batch.original_file_name);
  } catch (error) {
    const message = error instanceof AppError ? error.message : 'File tidak dapat dibaca';
    execute(
      `UPDATE upload_batches SET processing_status = 'Failed', remarks = ?, processed_at = ?,
              updated_at = ?, updated_by = ? WHERE upload_batch_id = ?`,
      [message, now(), now(), actor.userId, batchId],
    );
    recordAudit({
      entityType: 'UPLOAD_BATCH',
      entityId: batchId,
      action: 'STATUS_CHANGE',
      actor,
      before: { processingStatus: 'Validating' },
      after: { processingStatus: 'Failed', remarks: message },
      uploadBatchId: batchId,
    });
    if (error instanceof AppError) throw error;
    throw new AppError('UPLOAD_INVALID', 422, message);
  }

  let result;
  try {
    result = withTransaction(() => {
      execute('DELETE FROM upload_rows WHERE upload_batch_id = ?', [batchId]);
      const counters = {
        New: 0, Duplicate: 0, Changed: 0, Rejected: 0, 'Pending Mapping': 0,
      };
      const seenHashes = new Map();
      const ts = now();
      for (const row of parsed.rows) {
        const { normalized, errors } = normalize.normalizeRow(type, row.values, ctx);
        let classification;
        if (errors.length > 0) {
          const pending = pendingFromErrors(errors, rules);
          classification = {
            status: pending ? 'Pending Mapping' : 'Rejected',
            businessKey: pending ? null : null,
            hash: null,
            message: errorMessage(errors),
          };
        } else {
          classification = classifyRow(type, normalized, ctx, cfg, rules);
          if (seenHashes.has(classification.hash)) {
            classification = {
              ...classification,
              status: 'Duplicate',
              duplicateOf: null,
              message: 'Baris duplikat di dalam batch yang sama',
            };
          } else {
            seenHashes.set(classification.hash, row.rowNumber);
          }
        }
        counters[classification.status] = (counters[classification.status] || 0) + 1;
        execute(
          `INSERT INTO upload_rows
             (upload_row_id, upload_batch_id, source_row_number, business_key, source_row_hash,
              classification, validation_status, validation_message, duplicate_of_record_id,
              posted_record_id, raw_payload, normalized_payload, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
          [
            newId('ROW'), batchId, row.rowNumber, classification.businessKey || null,
            classification.hash || null, classification.status, classification.status,
            classification.message || null,
            classification.duplicateOf || null, JSON.stringify(normalize.rawPayloadOf(row.values)),
            JSON.stringify(normalized), ts, ts,
          ],
        );
      }
      execute(
        `UPDATE upload_batches
            SET processing_status = 'Ready for Review', total_rows = ?, new_rows = ?,
                duplicate_rows = ?, changed_rows = ?, rejected_rows = ?, pending_mapping_rows = ?,
                posted_rows = 0, processed_at = ?, hash_config_version = ?,
                updated_at = ?, updated_by = ?
          WHERE upload_batch_id = ?`,
        [
          parsed.rows.length, counters.New || 0, counters.Duplicate || 0, counters.Changed || 0,
          counters.Rejected || 0, counters['Pending Mapping'] || 0, now(), cfg.version, now(),
          actor.userId, batchId,
        ],
      );
      const updated = getBatchRow(batchId);
      recordAudit({
        entityType: 'UPLOAD_BATCH',
        entityId: batchId,
        action: 'VALIDATE',
        actor,
        before: { processingStatus: 'Validating' },
        after: {
          processingStatus: 'Ready for Review',
          ...batchSummary(updated),
          warnings: parsed.warnings,
        },
        uploadBatchId: batchId,
      });
      return { batch: updated, summary: batchSummary(updated) };
    });
  } catch (error) {
    const message = error instanceof AppError ? error.message : 'Validasi batch gagal karena kesalahan teknis';
    execute(
      `UPDATE upload_batches SET processing_status = 'Failed', remarks = ?, processed_at = ?,
              updated_at = ?, updated_by = ? WHERE upload_batch_id = ?`,
      [message, now(), now(), actor.userId, batchId],
    );
    if (error instanceof AppError) throw error;
    throw new AppError('UPLOAD_INVALID', 422, message);
  }
  return result;
}

function approveBatch(batchId, actor, remarks = null) {
  const batch = requireBatch(batchId);
  if (batch.processing_status !== 'Ready for Review') {
    throw invalidState(`Batch berstatus ${batch.processing_status} tidak dapat disetujui`);
  }
  withTransaction(() => {
    const ts = now();
    execute(
      `UPDATE upload_batches
          SET processing_status = 'Approved', approved_by = ?, approved_at = ?,
              remarks = COALESCE(?, remarks), updated_at = ?, updated_by = ?
        WHERE upload_batch_id = ?`,
      [actor.userId, ts, remarks ? String(remarks).trim() : null, ts, actor.userId, batchId],
    );
    recordAudit({
      entityType: 'UPLOAD_BATCH',
      entityId: batchId,
      action: 'APPROVE',
      actor,
      before: { processingStatus: 'Ready for Review' },
      after: { processingStatus: 'Approved', remarks: remarks || null },
      reason: remarks || null,
      uploadBatchId: batchId,
    });
  });
  return { batch: getBatchRow(batchId) };
}

function rejectBatch(batchId, actor, reason) {
  const batch = requireBatch(batchId);
  if (!reason || String(reason).trim() === '') {
    throw validation('Alasan penolakan wajib diisi', [{ field: 'reason', message: 'Wajib diisi' }]);
  }
  if (batch.processing_status !== 'Ready for Review') {
    throw invalidState(`Batch berstatus ${batch.processing_status} tidak dapat ditolak`);
  }
  withTransaction(() => {
    const ts = now();
    execute(
      `UPDATE upload_batches
          SET processing_status = 'Rejected', rejected_by = ?, rejected_at = ?,
              rejection_reason = ?, updated_at = ?, updated_by = ?
        WHERE upload_batch_id = ?`,
      [actor.userId, ts, String(reason).trim(), ts, actor.userId, batchId],
    );
    recordAudit({
      entityType: 'UPLOAD_BATCH',
      entityId: batchId,
      action: 'REJECT',
      actor,
      before: { processingStatus: 'Ready for Review' },
      after: { processingStatus: 'Rejected', rejectionReason: String(reason).trim() },
      reason: String(reason).trim(),
      uploadBatchId: batchId,
    });
  });
  return { batch: getBatchRow(batchId) };
}

function cancelBatch(batchId, actor, reason) {
  const batch = requireBatch(batchId);
  if (!reason || String(reason).trim() === '') {
    throw validation('Alasan pembatalan wajib diisi', [{ field: 'reason', message: 'Wajib diisi' }]);
  }
  if (!['Uploaded', 'Ready for Review', 'Approved'].includes(batch.processing_status)) {
    throw invalidState(`Batch berstatus ${batch.processing_status} tidak dapat dibatalkan`);
  }
  withTransaction(() => {
    const ts = now();
    execute(
      `UPDATE upload_batches
          SET processing_status = 'Cancelled', cancelled_by = ?, cancelled_at = ?,
              cancellation_reason = ?, updated_at = ?, updated_by = ?
        WHERE upload_batch_id = ?`,
      [actor.userId, ts, String(reason).trim(), ts, actor.userId, batchId],
    );
    recordAudit({
      entityType: 'UPLOAD_BATCH',
      entityId: batchId,
      action: 'CANCEL',
      actor,
      before: { processingStatus: batch.processing_status },
      after: { processingStatus: 'Cancelled', cancellationReason: String(reason).trim() },
      reason: String(reason).trim(),
      uploadBatchId: batchId,
    });
  });
  return { batch: getBatchRow(batchId) };
}

// ---------------------------------------------------------------------------
// Posting
// ---------------------------------------------------------------------------

function insertAgent(normalized, batch, actor) {
  const key = businessKey([normalized.KODEAGEN || normalized.AgentIDSource || '']);
  const existing = queryOne(
    'SELECT * FROM master_agent WHERE agent_key = ?',
    [key],
  );
  const ts = now();
  if (existing && existing.source_row_hash === normalized.__hash) {
    return { skipped: true, duplicateOf: existing.agent_id_internal, recordId: existing.agent_id_internal };
  }
  if (!existing) {
    const agentId = newId('AGT');
    execute(
      `INSERT INTO master_agent
         (agent_id_internal, agent_key, kodeagen, agent_id_source, nama_agent, branch_code,
          status_agent, is_current, current_version_no, source_row_hash, upload_batch_id,
          created_at, created_by, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?, ?, ?)`,
      [
        agentId, key, normalized.KODEAGEN, normalized.AgentIDSource, normalized.NamaAgent,
        normalized.Cabang, normalized.StatusAgent, normalized.__hash, batch.upload_batch_id,
        ts, actor.userId, ts, actor.userId,
      ],
    );
    execute(
      `INSERT INTO master_agent_version
         (agent_version_id, agent_id_internal, version_no, previous_version_id, kodeagen,
          agent_id_source, nama_agent, branch_code, status_agent, source_row_hash,
          upload_batch_id, is_current, change_reason, created_at, created_by)
       VALUES (?, ?, 1, NULL, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      [
        newId('AGV'), agentId, normalized.KODEAGEN, normalized.AgentIDSource, normalized.NamaAgent,
        normalized.Cabang, normalized.StatusAgent, normalized.__hash, batch.upload_batch_id,
        `Upload batch ${batch.upload_batch_id}`, ts, actor.userId,
      ],
    );
    recordAudit({
      entityType: 'AGENT', entityId: agentId, action: 'CREATE', actor,
      after: { agentKey: key, kodeagen: normalized.KODEAGEN, namaAgent: normalized.NamaAgent },
      uploadBatchId: batch.upload_batch_id,
    });
    return { skipped: false, recordId: agentId, created: true };
  }
  const currentVersion = queryOne(
    'SELECT * FROM master_agent_version WHERE agent_id_internal = ? AND is_current = 1',
    [existing.agent_id_internal],
  );
  const nextVersion = (currentVersion?.version_no || existing.current_version_no) + 1;
  if (currentVersion) {
    execute('UPDATE master_agent_version SET is_current = 0 WHERE agent_version_id = ?', [currentVersion.agent_version_id]);
  }
  execute(
    `UPDATE master_agent
        SET kodeagen = ?, agent_id_source = ?, nama_agent = ?, branch_code = ?, status_agent = ?,
            current_version_no = ?, source_row_hash = ?, upload_batch_id = ?, updated_at = ?, updated_by = ?
      WHERE agent_id_internal = ?`,
    [
      normalized.KODEAGEN, normalized.AgentIDSource, normalized.NamaAgent, normalized.Cabang,
      normalized.StatusAgent, nextVersion, normalized.__hash, batch.upload_batch_id, ts, actor.userId,
      existing.agent_id_internal,
    ],
  );
  execute(
    `INSERT INTO master_agent_version
       (agent_version_id, agent_id_internal, version_no, previous_version_id, kodeagen,
        agent_id_source, nama_agent, branch_code, status_agent, source_row_hash,
        upload_batch_id, is_current, change_reason, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    [
      newId('AGV'), existing.agent_id_internal, nextVersion, currentVersion?.agent_version_id || null,
      normalized.KODEAGEN, normalized.AgentIDSource, normalized.NamaAgent, normalized.Cabang,
      normalized.StatusAgent, normalized.__hash, batch.upload_batch_id,
      `Perubahan data agent dari batch ${batch.upload_batch_id}`, ts, actor.userId,
    ],
  );
  recordAudit({
    entityType: 'AGENT',
    entityId: existing.agent_id_internal,
    action: 'UPDATE',
    actor,
    before: {
      namaAgent: existing.nama_agent, branchCode: existing.branch_code,
      statusAgent: existing.status_agent, versionNo: currentVersion?.version_no,
    },
    after: {
      namaAgent: normalized.NamaAgent, branchCode: normalized.Cabang,
      statusAgent: normalized.StatusAgent, versionNo: nextVersion,
    },
    uploadBatchId: batch.upload_batch_id,
  });
  return { skipped: false, recordId: existing.agent_id_internal, created: false };
}

function insertProduction(normalized, batch, actor, row) {
  const existingHash = queryOne('SELECT production_id FROM master_produksi WHERE source_row_hash = ?', [normalized.__hash]);
  if (existingHash) {
    return { skipped: true, duplicateOf: existingHash.production_id, recordId: existingHash.production_id };
  }
  const current = queryOne(
    `SELECT production_id, version_no FROM master_produksi
      WHERE business_key = ? AND is_current = 1 LIMIT 1`,
    [normalized.__businessKey],
  );
  const productionId = newId('PRD');
  const ts = now();
  let versionNo = 1;
  let previousRecordId = null;
  if (current) {
    versionNo = current.version_no + 1;
    previousRecordId = current.production_id;
    execute(
      'UPDATE master_produksi SET is_current = 0, updated_at = ?, updated_by = ? WHERE production_id = ?',
      [ts, actor.userId, current.production_id],
    );
  }
  execute(
    `INSERT INTO master_produksi
       (production_id, agent_id_internal, source_agent_code, policy_no, policy_risk_id,
        transaction_date, effective_date, expiry_date, transaction_type, product_code,
        coverage_code, vehicle_or_risk_description, tsi_minor, premium_minor, currency,
        branch_code, uw_year, business_key, source_row_hash, upload_batch_id, version_no,
        previous_record_id, is_current, record_status, validation_status, created_at,
        created_by, updated_at, updated_by, approved_at, approved_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'Active',
             'Posted', ?, ?, ?, ?, ?, ?)`,
    [
      productionId, normalized.agentIdInternal || null, normalized.KodeAgen || null,
      normalized.PolicyNo, normalized.PolicyRiskID || null, normalized.TransactionDate,
      normalized.EffectiveDate, normalized.ExpiryDate || null, normalized.TransactionType,
      normalized.Product || null, normalized.Coverage || null,
      normalized.VehicleOrRiskDescription || null, normalized.TSI, normalized.Premium,
      normalized.Currency, normalized.Cabang || null, normalized.uwYear || null,
      normalized.__businessKey, normalized.__hash, batch.upload_batch_id, versionNo,
      previousRecordId, ts, actor.userId, ts, actor.userId, ts, actor.userId,
    ],
  );
  recordAudit({
    entityType: 'PRODUCTION',
    entityId: productionId,
    action: 'POST',
    actor,
    after: {
      policyNo: normalized.PolicyNo,
      businessKey: normalized.__businessKey,
      versionNo,
      previousRecordId,
      premium: normalized.Premium,
      tsi: normalized.TSI,
      currency: normalized.Currency,
    },
    uploadBatchId: batch.upload_batch_id,
  });
  return { skipped: false, recordId: productionId, versionNo, previousRecordId, row };
}

function resolveClaimKey(normalized, rules, cfg) {
  return hashSvc.businessKeyFor('CLAIM', normalized, cfg, rules);
}

function insertClaim(normalized, batch, actor, rules, cfg) {
  const existingHash = queryOne('SELECT claim_settlement_id, claim_id FROM claim_settlement WHERE source_row_hash = ?', [normalized.__hash]);
  if (existingHash) {
    return { skipped: true, duplicateOf: existingHash.claim_settlement_id, recordId: existingHash.claim_settlement_id };
  }
  const claimKey = resolveClaimKey(normalized, rules, cfg);
  let claim = queryOne('SELECT * FROM claim_master WHERE claim_key = ?', [claimKey]);
  const ts = now();
  let claimId;
  let claimCreated = false;
  if (!claim) {
    claimId = newId('CLM');
    const production = queryOne(
      `SELECT policy_risk_id, branch_code, product_code FROM master_produksi
        WHERE policy_no = ? ORDER BY is_current DESC, version_no DESC LIMIT 1`,
      [normalized.PolicyNo],
    );
    execute(
      `INSERT INTO claim_master
         (claim_id, claim_key, agent_id_internal, source_agent_code, claim_no, policy_no,
          policy_risk_id, uw_year, branch_code, product_name, product_at_loss, coverage_at_loss,
          tsi_at_loss_minor, currency, cause_of_loss, loss_date, claim_status, upload_batch_id,
          created_at, created_by, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        claimId, claimKey, normalized.agentIdInternal || null, normalized.KodeAgen || null,
        normalized.ClaimNo, normalized.PolicyNo,
        production?.policy_risk_id || normalized.PolicyRiskID || null,
        normalized.UWYear || null, normalized.Cabang || production?.branch_code || null,
        normalized.ProductAtLoss || null, normalized.CoverageAtLoss || null,
        normalized.TSIAtLoss, normalized.Currency, normalized.CauseOfLoss || null,
        normalized.LossDate || null, normalized.ClaimStatus || null, batch.upload_batch_id,
        ts, actor.userId, ts, actor.userId,
      ],
    );
    claim = queryOne('SELECT * FROM claim_master WHERE claim_id = ?', [claimId]);
    claimCreated = true;
    recordAudit({
      entityType: 'CLAIM',
      entityId: claimId,
      action: 'CREATE',
      actor,
      after: { claimNo: normalized.ClaimNo, policyNo: normalized.PolicyNo, claimKey },
      uploadBatchId: batch.upload_batch_id,
    });
  } else {
    claimId = claim.claim_id;
  }

  let previous = null;
  if (normalized.SettlementNo) {
    previous = queryOne(
      `SELECT claim_settlement_id, version_no FROM claim_settlement
        WHERE claim_id = ? AND settlement_no = ? AND is_current = 1
        ORDER BY version_no DESC LIMIT 1`,
      [claimId, normalized.SettlementNo],
    );
  }
  let versionNo = 1;
  let previousSettlementId = null;
  if (previous) {
    versionNo = previous.version_no + 1;
    previousSettlementId = previous.claim_settlement_id;
    execute('UPDATE claim_settlement SET is_current = 0, updated_at = ?, updated_by = ? WHERE claim_settlement_id = ?', [
      ts, actor.userId, previous.claim_settlement_id,
    ]);
  }
  const settlementId = newId('STL');
  execute(
    `INSERT INTO claim_settlement
       (claim_settlement_id, claim_id, settlement_no, date_of_settlement, gross_claim_minor,
        indemnity_minor, deductible_minor, salvage_minor, subrogation_minor, currency,
        source_row_hash, upload_batch_id, version_no, previous_settlement_id, is_current,
        record_status, validation_status, created_at, created_by, updated_at, updated_by,
        approved_at, approved_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'Active', 'Posted', ?, ?, ?, ?, ?, ?)`,
    [
      settlementId, claimId, normalized.SettlementNo || null, normalized.SettlementDate,
      normalized.GrossClaim, normalized.Indemnity, normalized.Deductible, normalized.Salvage,
      normalized.Subrogation, normalized.Currency, normalized.__hash, batch.upload_batch_id,
      versionNo, previousSettlementId, ts, actor.userId, ts, actor.userId, ts, actor.userId,
    ],
  );
  recordAudit({
    entityType: 'SETTLEMENT',
    entityId: settlementId,
    action: 'POST',
    actor,
    after: {
      claimId, claimNo: normalized.ClaimNo, settlementNo: normalized.SettlementNo,
      dateOfSettlement: normalized.SettlementDate, grossClaim: normalized.GrossClaim,
      currency: normalized.Currency, versionNo, previousSettlementId, claimCreated,
    },
    uploadBatchId: batch.upload_batch_id,
  });
  return { skipped: false, recordId: settlementId, claimId, claimCreated, versionNo };
}

function postBatch(batchId, actor, remarks = null) {
  const batch = requireBatch(batchId);
  const rules = loadRules();
  const approvalRequired = rules.batchApprovalRequired !== false;
  const allowedStatus = approvalRequired ? ['Approved'] : ['Approved', 'Ready for Review'];
  if (!allowedStatus.includes(batch.processing_status)) {
    throw invalidState(
      approvalRequired
        ? `Batch harus berstatus Approved sebelum posting (status sekarang ${batch.processing_status})`
        : `Batch berstatus ${batch.processing_status} tidak dapat diposting`,
    );
  }
  const type = batch.upload_type;
  const cfg = hashSvc.decodeConfig(hashSvc.loadHashConfig(type, batch.hash_config_version) || hashSvc.requireConfig(type));
  if (!cfg || !cfg.columns || cfg.columns.length === 0) {
    throw new AppError('INVALID_STATE', 409, `Konfigurasi hash untuk ${type} tidak tersedia`);
  }
  const rows = queryAll(
    'SELECT * FROM upload_rows WHERE upload_batch_id = ? ORDER BY source_row_number',
    [batchId],
  );

  const summary = withTransaction(() => {
    const ts = now();
    let posted = 0;
    for (const row of rows) {
      if (row.validation_status !== 'New' && row.validation_status !== 'Changed') continue;
      const normalized = parseJson(row.normalized_payload, null);
      if (!normalized) continue;
      normalized.__hash = row.source_row_hash;
      normalized.__businessKey = row.business_key;
      let outcome;
      if (type === 'AGENT') outcome = insertAgent(normalized, batch, actor);
      else if (type === 'PRODUCTION') outcome = insertProduction(normalized, batch, actor, row);
      else outcome = insertClaim(normalized, batch, actor, rules, cfg);
      if (outcome.skipped) {
        execute(
          `UPDATE upload_rows
              SET validation_status = 'Duplicate', validation_message = ?,
                  duplicate_of_record_id = ?, updated_at = ?
            WHERE upload_row_id = ?`,
          [`Sumber sudah diposting sebelumnya (${outcome.duplicateOf})`, outcome.duplicateOf, ts, row.upload_row_id],
        );
        continue;
      }
      execute(
        `UPDATE upload_rows
            SET validation_status = 'Posted', posted_record_id = ?, validation_message = NULL,
                updated_at = ?
          WHERE upload_row_id = ?`,
        [outcome.recordId, ts, row.upload_row_id],
      );
      posted += 1;
    }
    const counts = queryOne(
      `SELECT
         SUM(CASE WHEN validation_status = 'Rejected' THEN 1 ELSE 0 END) AS rejected,
         SUM(CASE WHEN validation_status = 'Pending Mapping' THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN validation_status = 'Duplicate' THEN 1 ELSE 0 END) AS duplicates,
         SUM(CASE WHEN validation_status = 'Posted' THEN 1 ELSE 0 END) AS posted
       FROM upload_rows WHERE upload_batch_id = ?`,
      [batchId],
    ) || {};
    const exceptions = (counts.rejected || 0) + (counts.pending || 0) + (counts.duplicates || 0) > 0;
    const finalStatus = exceptions ? 'Posted with Exceptions' : 'Posted';
    execute(
      `UPDATE upload_batches
          SET processing_status = ?, posted_rows = ?,
              remarks = COALESCE(?, remarks), updated_at = ?, updated_by = ?
        WHERE upload_batch_id = ?`,
      [
        finalStatus, counts.posted || 0, remarks ? String(remarks).trim() : null,
        ts, actor.userId, batchId,
      ],
    );
    refreshBatchCounters(batchId);
    const updated = getBatchRow(batchId);
    recordAudit({
      entityType: 'UPLOAD_BATCH',
      entityId: batchId,
      action: 'POST',
      actor,
      before: { processingStatus: batch.processing_status },
      after: { processingStatus: finalStatus, ...batchSummary(updated), postedThisRun: posted },
      reason: remarks || null,
      uploadBatchId: batchId,
    });
    return { batch: updated, summary: batchSummary(updated) };
  });
  return summary;
}

// ---------------------------------------------------------------------------
// Row listing / template / mapping resolution
// ---------------------------------------------------------------------------

function listRows({ batchId, status = null, q = null, page = 1, pageSize = 25, all = false }) {
  requireBatch(batchId);
  const where = ['upload_batch_id = ?'];
  const params = [batchId];
  if (status) {
    where.push('validation_status = ?');
    params.push(status);
  }
  if (q) {
    where.push('(business_key LIKE ? OR validation_message LIKE ? OR raw_payload LIKE ?)');
    const pattern = `%${String(q)}%`;
    params.push(pattern, pattern, pattern);
  }
  const whereSql = ` WHERE ${where.join(' AND ')}`;
  const total = queryOne(`SELECT COUNT(*) AS c FROM upload_rows${whereSql}`, params).c;
  const limit = all ? Math.max(total, 1) : pageSize;
  const offset = all ? 0 : (page - 1) * pageSize;
  const rows = queryAll(
    `SELECT * FROM upload_rows${whereSql}
      ORDER BY source_row_number ASC
      LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  return { rows, total };
}

function templateRows(uploadType) {
  const type = assertUploadType(uploadType);
  const spec = normalize.FIELD_SPECS[type];
  const headers = spec.map((field) => field.key);
  const examples = {
    AGENT: ['AGT001', 'AGT001', 'Budi Santoso', 'JKT', 'Active'],
    PRODUCTION: [
      'POL-2026-0001', 'RISK-001', '2026-01-20', '2026-02-01', '2027-02-01', 'New Business',
      'MOTOR', 'COMP', 'Toyota Avanza B 1234 XYZ', '150000000', '3500000', 'IDR', 'AGT001', 'JKT',
    ],
    CLAIM: [
      'CLM-2026-0001', 'POL-2026-0001', 'SET-0001', '2026-04-02', 'IDR', '12000000',
      '10000000', '2000000', '500000', '100000', '2026', 'MOTOR', 'COMP',
      '150000000', 'COLLISION', '2026-03-11', 'Settled', 'AGT001', 'JKT',
    ],
  };
  return { headers, example: examples[type], types: spec.map((field) => field.kind) };
}

/** Klasifikasi ulang baris Pending Mapping setelah mapping dibuat/diubah. */
function reclassifyPending({ kodeagen, batchId = null, actor = null }) {
  const code = String(kodeagen || '').trim().toUpperCase();
  const rules = loadRules();
  const contextCache = new Map();
  const configCache = new Map();
  let affectedRows = 0;
  const touchedBatches = new Set();

  const candidates = queryAll(
    `SELECT r.*, b.upload_type, b.hash_config_version
       FROM upload_rows r
       JOIN upload_batches b ON b.upload_batch_id = r.upload_batch_id
      WHERE r.validation_status = 'Pending Mapping'
        ${batchId ? 'AND r.upload_batch_id = ?' : ''}
      ORDER BY r.source_row_number`,
    batchId ? [batchId] : [],
  );

  for (const row of candidates) {
    const normalized = parseJson(row.normalized_payload, null);
    if (!normalized) continue;
    const rowCode = String(normalized.KodeAgen || '').toUpperCase();
    if (rowCode !== code) continue;
    const type = row.upload_type;
    if (!contextCache.has(type)) {
      contextCache.set(type, normalize.loadNormalizationContext({ dateFormat: null }));
    }
    if (!configCache.has(type)) {
      configCache.set(type, hashSvc.decodeConfig(hashSvc.loadHashConfig(type, row.hash_config_version) || hashSvc.requireConfig(type)));
    }
    const ctx = contextCache.get(type);
    const cfg = configCache.get(type);
    const agent = ctx.findAgent(code);
    if (!agent) continue;
    normalized.agentIdInternal = agent.agent_id_internal;
    normalized.agentFound = true;
    if (!normalized.Cabang && agent.branch_code) normalized.Cabang = agent.branch_code;
    const classification = classifyRow(type, normalized, ctx, cfg, rules);
    normalized.__hash = classification.hash;
    normalized.__businessKey = classification.businessKey;
    execute(
      `UPDATE upload_rows
          SET validation_status = ?, validation_message = ?, duplicate_of_record_id = ?,
              business_key = ?, source_row_hash = ?, normalized_payload = ?, updated_at = ?
        WHERE upload_row_id = ?`,
      [
        classification.status, classification.message || null, classification.duplicateOf || null,
        classification.businessKey || null, classification.hash || null, JSON.stringify(normalized),
        now(), row.upload_row_id,
      ],
    );
    touchedBatches.add(row.upload_batch_id);
    affectedRows += 1;
  }
  for (const id of touchedBatches) refreshBatchCounters(id);
  if (affectedRows > 0 && actor) {
    for (const id of touchedBatches) {
      recordAudit({
        entityType: 'UPLOAD_BATCH',
        entityId: id,
        action: 'OVERRIDE',
        actor,
        after: { reclassifiedAgentCode: code, affectedRows },
        reason: `Mapping agen ${code}`,
        uploadBatchId: id,
      });
    }
  }
  return { affectedRows, batchIds: [...touchedBatches] };
}

module.exports = {
  UPLOAD_TYPES,
  getBatchRow,
  requireBatch,
  duplicateFilesFor,
  absoluteStoredPath,
  createBatch,
  validateBatch,
  approveBatch,
  rejectBatch,
  cancelBatch,
  postBatch,
  listRows,
  templateRows,
  reclassifyPending,
  refreshBatchCounters,
  classifyRow,
};
