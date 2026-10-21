'use strict';
const express = require('express');
const { asyncHandler } = require('../middleware/errors');
const { requireAuth, requirePermission, attachScope } = require('../middleware/auth');
const { ok, paged, parsePaging, parseSort, parseBody } = require('../util/http');
const claims = require('../services/claims');
const { loadRules } = require('../services/settings');
const exportSvc = require('../services/export');
const {
  serializeClaim,
  serializeSettlement,
  serializeUploadRow,
  serializeBatch,
} = require('../util/serialize');

const router = express.Router();

router.use(requireAuth, attachScope);

function serializeTrace(trace) {
  if (!trace) return null;
  return {
    uploadRow: serializeUploadRow(trace.uploadRow),
    batch: trace.batch ? serializeBatch(trace.batch, { approvalRequired: loadRules().batchApprovalRequired }) : null,
    uploadedBy: trace.actor
      ? { userId: trace.actor.user_id, fullName: trace.actor.full_name, roleKey: trace.actor.role_key, email: trace.actor.email }
      : null,
  };
}

router.get('/export', requirePermission('export.claim'), asyncHandler(async (req, res) => {
  const sort = parseSort(req.query.sort, req.query.order, claims.SORT_WHITELIST, 'claimNo');
  const result = claims.listClaims({
    query: req.query,
    paging: { limit: claims.maxExportRows, offset: 0, page: 1, pageSize: claims.maxExportRows },
    sort,
    scope: req.branchScope,
    limitOverride: claims.maxExportRows,
  });
  const columns = [
    { key: 'claimId', label: 'Claim ID' },
    { key: 'claimNo', label: 'Claim No' },
    { key: 'policyNo', label: 'Policy No' },
    { key: 'policyRiskId', label: 'Policy Risk ID' },
    { key: 'agentName', label: 'Agent' },
    { key: 'uwYear', label: 'UW Year' },
    { key: 'branchCode', label: 'Branch' },
    { key: 'productAtLoss', label: 'Product At Loss' },
    { key: 'coverageAtLoss', label: 'Coverage At Loss' },
    { key: 'tsiAtLoss', label: 'TSI At Loss' },
    { key: 'currency', label: 'Currency' },
    { key: 'causeOfLoss', label: 'Cause Of Loss' },
    { key: 'lossDate', label: 'Loss Date' },
    { key: 'claimStatus', label: 'Claim Status' },
    { key: 'settlementCount', label: 'Settlement Count' },
    { key: 'settledAmount', label: 'Settled Amount' },
    { key: 'settlementCurrency', label: 'Settlement Currency' },
  ];
  exportSvc.sendCsv(res, 'claims.csv', columns, result.rows);
}));

router.get('/', requirePermission('report.claim'), asyncHandler(async (req, res) => {
  const paging = parsePaging(req.query);
  const sort = parseSort(req.query.sort, req.query.order, claims.SORT_WHITELIST, 'claimNo');
  const result = claims.listClaims({
    query: req.query,
    paging,
    sort,
    scope: req.branchScope,
  });
  paged(res, result.rows, paging.page, paging.pageSize, result.total);
}));

router.get('/:id/export', requirePermission('export.claim'), asyncHandler(async (req, res) => {
  const detail = claims.getClaimDetail(req.params.id);
  const columns = [
    { key: 'claimSettlementId', label: 'Settlement ID' },
    { key: 'claimNo', label: 'Claim No' },
    { key: 'settlementNo', label: 'Settlement No' },
    { key: 'dateOfSettlement', label: 'Date Of Settlement' },
    { key: 'grossClaim', label: 'Gross Claim' },
    { key: 'indemnity', label: 'Indemnity' },
    { key: 'deductible', label: 'Deductible' },
    { key: 'salvage', label: 'Salvage' },
    { key: 'subrogation', label: 'Subrogation' },
    { key: 'currency', label: 'Currency' },
    { key: 'versionNo', label: 'Version' },
    { key: 'isCurrent', label: 'Is Current' },
    { key: 'recordStatus', label: 'Status' },
  ];
  exportSvc.sendCsv(res, `claim-${detail.claim.claimNo.replace(/[^A-Za-z0-9._-]/g, '_')}-settlements.csv`, columns, detail.settlements);
}));

router.get('/:id', requirePermission('report.claim'), asyncHandler(async (req, res) => {
  const detail = claims.getClaimDetail(req.params.id);
  ok(res, {
    claim: detail.claim,
    settlements: detail.settlements,
    trace: serializeTrace(detail.trace),
  });
}));

router.post('/:id/settlements/:settlementId/cancel', requirePermission('claim.write'), asyncHandler(async (req, res) => {
  const body = parseBody(req.body || {}, {
    reason: { type: 'string', required: true, maxLength: 1000 },
  });
  const settlement = claims.cancelSettlement(req.params.id, req.params.settlementId, body.reason, req.user);
  ok(res, { settlement });
}));

module.exports = router;
