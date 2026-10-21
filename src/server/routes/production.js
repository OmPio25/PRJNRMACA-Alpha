'use strict';
const express = require('express');
const { asyncHandler } = require('../middleware/errors');
const { requireAuth, requirePermission, attachScope } = require('../middleware/auth');
const { ok, paged, parsePaging, parseSort, parseBody } = require('../util/http');
const production = require('../services/production');
const { loadRules } = require('../services/settings');
const exportSvc = require('../services/export');
const {
  serializeProduction,
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

function listHandler(positions) {
  return asyncHandler(async (req, res) => {
    const paging = parsePaging(req.query);
    const sort = parseSort(req.query.sort, req.query.order, production.SORT_WHITELIST, positions ? 'effectiveDate' : 'createdAt');
    const result = production.listProduction({
      query: req.query,
      paging,
      sort,
      scope: req.branchScope,
      positions,
    });
    paged(res, result.rows.map(serializeProduction), paging.page, paging.pageSize, result.total);
  });
}

router.get('/positions', requirePermission('report.production'), listHandler(true));
router.get('/export', requirePermission('report.production'), asyncHandler(async (req, res) => {
  const sort = parseSort(req.query.sort, req.query.order, production.SORT_WHITELIST, 'effectiveDate');
  const result = production.listProduction({
    query: req.query,
    paging: { limit: production.maxExportRows, offset: 0, page: 1, pageSize: production.maxExportRows },
    sort,
    scope: req.branchScope,
    limitOverride: production.maxExportRows,
  });
  const columns = [
    { key: 'productionId', label: 'Production ID' },
    { key: 'policyNo', label: 'Policy No' },
    { key: 'policyRiskId', label: 'Policy Risk ID' },
    { key: 'agentName', label: 'Agent Name' },
    { key: 'sourceAgentCode', label: 'Agent Code' },
    { key: 'transactionDate', label: 'Transaction Date' },
    { key: 'effectiveDate', label: 'Effective Date' },
    { key: 'expiryDate', label: 'Expiry Date' },
    { key: 'transactionType', label: 'Transaction Type' },
    { key: 'productCode', label: 'Product' },
    { key: 'coverageCode', label: 'Coverage' },
    { key: 'vehicleOrRiskDescription', label: 'Description' },
    { key: 'tsi', label: 'TSI' },
    { key: 'premium', label: 'Premium' },
    { key: 'currency', label: 'Currency' },
    { key: 'branchCode', label: 'Branch' },
    { key: 'uwYear', label: 'UW Year' },
    { key: 'versionNo', label: 'Version' },
    { key: 'isCurrent', label: 'Is Current' },
    { key: 'recordStatus', label: 'Status' },
  ];
  exportSvc.sendCsv(res, 'production.csv', columns, result.rows.map(serializeProduction));
}));

router.get('/', requirePermission('report.production'), listHandler(false));

router.get('/:id', requirePermission('report.production'), asyncHandler(async (req, res) => {
  const detail = production.getProductionDetail(req.params.id);
  ok(res, {
    record: serializeProduction(detail.record),
    versions: detail.versions.map(serializeProduction),
    trace: serializeTrace(detail.trace),
  });
}));

router.post('/:id/cancel', requirePermission('production.write'), asyncHandler(async (req, res) => {
  const body = parseBody(req.body || {}, {
    reason: { type: 'string', required: true, maxLength: 1000 },
  });
  const record = production.cancelProduction(req.params.id, body.reason, req.user);
  ok(res, { record: serializeProduction(record) });
}));

module.exports = router;
