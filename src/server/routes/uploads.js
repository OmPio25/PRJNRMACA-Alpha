'use strict';
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const multer = require('multer');
const config = require('../config');
const { asyncHandler, validation, notFound, AppError } = require('../middleware/errors');
const { requireAuth, requirePermission, assertUploadType, assertBatchAccess } = require('../middleware/auth');
const { ok, paged, parsePaging, parseSort, parseBody, assertNoExtraFields } = require('../util/http');
const uploadSvc = require('../services/upload');
const { loadRules } = require('../services/settings');
const exportSvc = require('../services/export');
const rbac = require('../middleware/rbac');
const {
  serializeBatch,
  serializeUploadRow,
  serializeDuplicateFile,
  batchSummary,
} = require('../util/serialize');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
});

const BATCH_STATUSES = [
  'Uploaded', 'Validating', 'Ready for Review', 'Approved', 'Posted',
  'Posted with Exceptions', 'Failed', 'Rejected', 'Cancelled',
];
const ROW_STATUSES = ['New', 'Duplicate', 'Changed', 'Rejected', 'Pending Mapping', 'Posted'];

const SORT_WHITELIST = {
  uploadedAt: 'b.uploaded_at',
  originalFileName: 'b.original_file_name',
  processingStatus: 'b.processing_status',
  totalRows: 'b.total_rows',
  newRows: 'b.new_rows',
  duplicateRows: 'b.duplicate_rows',
  changedRows: 'b.changed_rows',
  rejectedRows: 'b.rejected_rows',
  postedRows: 'b.posted_rows',
};

function approvalRequired() {
  return loadRules().batchApprovalRequired !== false;
}

function serializeBatchRow(row) {
  return serializeBatch(row, { approvalRequired: approvalRequired() });
}

// Template harus dideklarasikan sebelum /:id agar tidak dianggap ID.
router.get('/templates/:type', requireAuth, asyncHandler(async (req, res) => {
  const template = uploadSvc.templateRows(req.params.type);
  const csv = exportSvc.toCsv(template.headers, [template.example]);
  exportSvc.sendTextCsv(res, `template-${req.params.type.toLowerCase()}.csv`, csv);
}));

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const paging = parsePaging(req.query);
  const sort = parseSort(req.query.sort, req.query.order, SORT_WHITELIST, 'uploadedAt');
  const where = [];
  const params = [];
  const type = req.query.type ? String(req.query.type).toUpperCase() : null;
  if (type) {
    if (!uploadSvc.UPLOAD_TYPES.includes(type)) {
      throw validation('Filter type tidak valid', [{ field: 'type', message: 'AGENT, PRODUCTION, atau CLAIM' }]);
    }
    where.push('b.upload_type = ?');
    params.push(type);
  }
  if (req.query.status) {
    if (!BATCH_STATUSES.includes(req.query.status)) {
      throw validation('Filter status tidak valid', [{ field: 'status', message: 'Status batch tidak dikenal' }]);
    }
    where.push('b.processing_status = ?');
    params.push(req.query.status);
  }
  if (req.query.q) {
    where.push('(b.original_file_name LIKE ? OR b.upload_batch_id LIKE ?)');
    params.push(`%${req.query.q}%`, `%${req.query.q}%`);
  }
  if (req.query.from) {
    where.push('date(b.uploaded_at) >= ?');
    params.push(req.query.from);
  }
  if (req.query.to) {
    where.push('date(b.uploaded_at) <= ?');
    params.push(req.query.to);
  }
  if (req.query.mine === '1' || !rbac.can(req.user, 'upload.view.all')) {
    where.push('b.uploaded_by = ?');
    params.push(req.user.userId);
  }
  const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const total = require('../../../db/database').queryOne(
    `SELECT COUNT(*) AS c FROM upload_batches b${whereSql}`,
    params,
  ).c;
  const rows = require('../../../db/database').queryAll(
    `SELECT b.*, u.full_name AS uploaded_by_name
       FROM upload_batches b
  LEFT JOIN users u ON u.user_id = b.uploaded_by
       ${whereSql}
   ORDER BY ${sort.clause}
      LIMIT ? OFFSET ?`,
    [...params, paging.limit, paging.offset],
  ).map(serializeBatchRow);
  paged(res, rows, paging.page, paging.pageSize, total);
}));

router.post('/', requireAuth, requirePermission('upload.create'), upload.single('file'), asyncHandler(async (req, res) => {
  assertNoExtraFields(req.body || {}, ['uploadType', 'remarks', 'dateFormat']);
  const uploadType = assertUploadType(req, req.body?.uploadType);
  if (!req.file) {
    throw new AppError('UPLOAD_INVALID', 422, 'File wajib diunggah', [{ field: 'file', message: 'File wajib diunggah' }]);
  }
  const result = uploadSvc.createBatch({
    file: req.file,
    uploadType,
    remarks: req.body?.remarks || null,
    dateFormat: req.body?.dateFormat || null,
    actor: req.user,
  });
  ok(res, {
    batch: serializeBatchRow(result.batch),
    duplicateFiles: result.duplicateFiles.map(serializeDuplicateFile),
  }, 201);
}));

router.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  const batch = uploadSvc.requireBatch(req.params.id);
  assertBatchAccess(req, batch);
  ok(res, {
    batch: serializeBatchRow(batch),
    summary: batchSummary(batch),
    duplicateFiles: uploadSvc.duplicateFilesFor(batch).map(serializeDuplicateFile),
  });
}));

router.post('/:id/validate', requireAuth, requirePermission('upload.create'), asyncHandler(async (req, res) => {
  assertNoExtraFields(req.body || {}, []);
  const batch = uploadSvc.requireBatch(req.params.id);
  assertBatchAccess(req, batch);
  const result = await uploadSvc.validateBatch(req.params.id, req.user);
  ok(res, { batch: serializeBatchRow(result.batch), summary: result.summary });
}));

router.get('/:id/rows', requireAuth, asyncHandler(async (req, res) => {
  const batch = uploadSvc.requireBatch(req.params.id);
  assertBatchAccess(req, batch);
  const paging = parsePaging(req.query);
  const status = req.query.status ? String(req.query.status) : null;
  if (status && !ROW_STATUSES.includes(status)) {
    throw validation('Filter status tidak valid', [{ field: 'status', message: ROW_STATUSES.join(', ') }]);
  }
  const result = uploadSvc.listRows({
    batchId: req.params.id,
    status,
    q: req.query.q ? String(req.query.q) : null,
    page: paging.page,
    pageSize: paging.pageSize,
  });
  paged(res, result.rows.map(serializeUploadRow), paging.page, paging.pageSize, result.total);
}));

router.get('/:id/rows/export', requireAuth, asyncHandler(async (req, res) => {
  const batch = uploadSvc.requireBatch(req.params.id);
  assertBatchAccess(req, batch);
  const result = uploadSvc.listRows({ batchId: req.params.id, all: true });
  const rawKeys = [];
  const seen = new Set();
  for (const row of result.rows) {
    let raw = {};
    try {
      raw = JSON.parse(row.raw_payload || '{}');
    } catch {
      raw = {};
    }
    for (const key of Object.keys(raw)) {
      if (!seen.has(key)) {
        seen.add(key);
        rawKeys.push(key);
      }
    }
  }
  const fixed = [
    { key: 'source_row_number', label: 'source_row_number' },
    { key: 'validation_status', label: 'validation_status' },
    { key: 'validation_message', label: 'validation_message' },
    { key: 'business_key', label: 'business_key' },
    { key: 'source_row_hash', label: 'source_row_hash' },
    { key: 'duplicate_of_record_id', label: 'duplicate_of_record_id' },
    { key: 'posted_record_id', label: 'posted_record_id' },
  ];
  const columns = [...fixed, ...rawKeys.map((key) => ({ key: `raw.${key}`, label: key }))];
  const rows = result.rows.map((row) => {
    let raw = {};
    try {
      raw = JSON.parse(row.raw_payload || '{}');
    } catch {
      raw = {};
    }
    const out = {
      source_row_number: row.source_row_number,
      validation_status: row.validation_status,
      validation_message: row.validation_message || '',
      business_key: row.business_key || '',
      source_row_hash: row.source_row_hash || '',
      duplicate_of_record_id: row.duplicate_of_record_id || '',
      posted_record_id: row.posted_record_id || '',
    };
    for (const key of rawKeys) out[`raw.${key}`] = raw[key] === undefined ? '' : raw[key];
    return out;
  });
  exportSvc.sendCsv(res, `${batch.upload_batch_id}-rows.csv`, columns, rows);
}));

router.post('/:id/approve', requireAuth, requirePermission('upload.approve'), asyncHandler(async (req, res) => {
  const body = parseBody(req.body || {}, { remarks: { type: 'string', maxLength: 1000 } });
  const batch = uploadSvc.requireBatch(req.params.id);
  assertBatchAccess(req, batch);
  const result = uploadSvc.approveBatch(req.params.id, req.user, body.remarks || null);
  ok(res, { batch: serializeBatchRow(result.batch) });
}));

router.post('/:id/reject', requireAuth, requirePermission('upload.approve'), asyncHandler(async (req, res) => {
  const body = parseBody(req.body || {}, {
    reason: { type: 'string', required: true, maxLength: 1000 },
  });
  const batch = uploadSvc.requireBatch(req.params.id);
  assertBatchAccess(req, batch);
  const result = uploadSvc.rejectBatch(req.params.id, req.user, body.reason);
  ok(res, { batch: serializeBatchRow(result.batch) });
}));

router.post('/:id/post', requireAuth, requirePermission('upload.post'), asyncHandler(async (req, res) => {
  const body = parseBody(req.body || {}, { remarks: { type: 'string', maxLength: 1000 } });
  const batch = uploadSvc.requireBatch(req.params.id);
  assertBatchAccess(req, batch);
  const result = uploadSvc.postBatch(req.params.id, req.user, body.remarks || null);
  ok(res, { batch: serializeBatchRow(result.batch), summary: result.summary });
}));

router.post('/:id/cancel', requireAuth, requirePermission('upload.cancel'), asyncHandler(async (req, res) => {
  const body = parseBody(req.body || {}, {
    reason: { type: 'string', required: true, maxLength: 1000 },
  });
  const batch = uploadSvc.requireBatch(req.params.id);
  assertBatchAccess(req, batch);
  const result = uploadSvc.cancelBatch(req.params.id, req.user, body.reason);
  ok(res, { batch: serializeBatchRow(result.batch) });
}));

router.get('/:id/file', requireAuth, asyncHandler(async (req, res) => {
  const batch = uploadSvc.requireBatch(req.params.id);
  assertBatchAccess(req, batch);
  const absolute = uploadSvc.absoluteStoredPath(batch);
  if (!absolute) throw notFound('File asli batch tidak tersedia');
  const filename = exportSvc.sanitizeFilename(batch.original_file_name);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', fs.statSync(absolute).size);
  fs.createReadStream(absolute).pipe(res);
}));

module.exports = router;
