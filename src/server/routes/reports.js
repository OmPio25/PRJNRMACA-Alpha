'use strict';
const express = require('express');
const { asyncHandler, notFound } = require('../middleware/errors');
const { requireAuth, requirePermission, attachScope } = require('../middleware/auth');
const { ok } = require('../util/http');
const reports = require('../services/reports');
const exportSvc = require('../services/export');
const rbac = require('../middleware/rbac');

const router = express.Router();

router.use(requireAuth, attachScope);

router.get('/meta', asyncHandler(async (req, res) => {
  ok(res, reports.reportMeta());
}));

router.get('/net-claims-cost', requirePermission('report.claim'), asyncHandler(async (req, res) => {
  ok(res, reports.netClaimsCost({ query: req.query, scope: req.branchScope }));
}));

router.get('/:reportKey', asyncHandler(async (req, res) => {
  const reportKey = String(req.params.reportKey);
  const def = reports.REPORT_DEFS[reportKey];
  if (!def) throw notFound(`Laporan tidak dikenal: ${reportKey}`);
  if (!rbac.can(req.user, def.permission)) {
    return res.status(403).json({
      ok: false,
      error: { code: 'FORBIDDEN', message: `Izin ${def.permission} diperlukan untuk laporan ini` },
    });
  }
  const report = reports.buildReport(reportKey, { query: req.query, scope: req.branchScope });
  const format = report._format;
  delete report._format;
  if (format === 'csv') {
    if (!rbac.can(req.user, def.csvPermission)) {
      return res.status(403).json({
        ok: false,
        error: { code: 'FORBIDDEN', message: `Izin ${def.csvPermission} diperlukan untuk ekspor laporan ini` },
      });
    }
    const filename = `${reportKey}-${report.period.from || 'all'}-${report.period.to || 'all'}.csv`;
    return exportSvc.sendTextCsv(res, filename, reports.reportToCsv(report));
  }
  return ok(res, report);
}));

module.exports = router;
