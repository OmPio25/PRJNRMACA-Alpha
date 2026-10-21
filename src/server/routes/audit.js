'use strict';
const express = require('express');
const { asyncHandler, notFound } = require('../middleware/errors');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { ok, paged, parsePaging, parseDateParam } = require('../util/http');
const audit = require('../services/audit');
const { loadRules } = require('../services/settings');
const {
  serializeAudit,
  serializeUploadRow,
  serializeBatch,
} = require('../util/serialize');

const router = express.Router();

router.use(requireAuth, requirePermission('audit.view'));

router.get('/trace', asyncHandler(async (req, res) => {
  const recordType = String(req.query.recordType || '').toUpperCase();
  const recordId = req.query.recordId ? String(req.query.recordId) : null;
  if (!['AGENT', 'PRODUCTION', 'CLAIM', 'SETTLEMENT'].includes(recordType)) {
    throw notFound('recordType harus AGENT, PRODUCTION, CLAIM, atau SETTLEMENT');
  }
  if (!recordId) throw notFound('recordId wajib diisi');
  const trace = audit.traceRecord(recordType, recordId);
  if (!trace) throw notFound('Record tidak ditemukan untuk traceability');
  ok(res, {
    recordType: trace.recordType,
    record: trace.record,
    uploadRow: serializeUploadRow(trace.uploadRow),
    batch: trace.batch ? serializeBatch(trace.batch, { approvalRequired: loadRules().batchApprovalRequired }) : null,
    actor: trace.actor
      ? { userId: trace.actor.user_id, fullName: trace.actor.full_name, roleKey: trace.actor.role_key, email: trace.actor.email }
      : null,
  });
}));

router.get('/', asyncHandler(async (req, res) => {
  const paging = parsePaging(req.query);
  const query = {
    entityType: req.query.entityType,
    entityId: req.query.entityId,
    action: req.query.action,
    actorId: req.query.actorId,
    from: req.query.from ? parseDateParam(req.query.from, 'from') : null,
    to: req.query.to ? parseDateParam(req.query.to, 'to') : null,
  };
  const result = audit.listAudit({ query, paging });
  paged(res, result.rows.map(serializeAudit), paging.page, paging.pageSize, result.total);
}));

module.exports = router;
