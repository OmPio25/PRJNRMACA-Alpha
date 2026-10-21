'use strict';
/** Dashboard: KPI ringkas, produksi & settlement per currency, batch terbaru. */
const { queryAll, queryOne } = require('../../../db/database');
const { fromMinorUnits } = require('../../../db/canonical');
const { serializeBatch } = require('../util/serialize');
const { loadRules } = require('./settings');

function monthBounds(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function money(value) {
  return value === null || value === undefined ? 0 : fromMinorUnits(value);
}

function getDashboard({ user, canViewAll = false }) {
  const { start, end } = monthBounds();
  const rules = loadRules();

  const batchesThisMonth = queryOne(
    'SELECT COUNT(*) AS c FROM upload_batches WHERE uploaded_at >= ?',
    [start],
  ).c;
  const pendingReview = queryOne(
    `SELECT COUNT(*) AS c FROM upload_batches
      WHERE processing_status IN ('Uploaded', 'Validating', 'Ready for Review')`,
  ).c;
  const pendingMapping = queryOne(
    "SELECT COUNT(*) AS c FROM upload_rows WHERE validation_status = 'Pending Mapping'",
  ).c;
  const postedRowsThisMonth = queryOne(
    'SELECT COALESCE(SUM(posted_rows), 0) AS c FROM upload_batches WHERE processed_at >= ?',
    [start],
  ).c;
  const activeAgents = queryOne(
    "SELECT COUNT(*) AS c FROM master_agent WHERE is_current = 1 AND status_agent = 'Active'",
  ).c;
  const currentPolicies = queryOne(
    `SELECT COUNT(DISTINCT policy_no) AS c FROM master_produksi
      WHERE is_current = 1 AND record_status = 'Active'`,
  ).c;
  const openClaims = queryOne(
    `SELECT COUNT(*) AS c FROM claim_master c
      WHERE NOT EXISTS (
        SELECT 1 FROM claim_settlement s
         WHERE s.claim_id = c.claim_id AND s.is_current = 1 AND s.record_status = 'Active'
      ) OR c.claim_status IS NULL OR lower(c.claim_status) <> 'settled'`,
  ).c;
  const settlementsThisMonth = queryOne(
    `SELECT COUNT(*) AS c FROM claim_settlement
      WHERE is_current = 1 AND record_status = 'Active'
        AND date_of_settlement >= ? AND date_of_settlement < ?`,
    [start, end],
  ).c;

  const premiumByCurrency = queryAll(
    `SELECT currency, SUM(COALESCE(premium_minor,0)) AS premium_minor,
            SUM(COALESCE(tsi_minor,0)) AS tsi_minor, COUNT(*) AS transaction_count
       FROM master_produksi
      WHERE is_current = 1 AND record_status = 'Active'
      GROUP BY currency ORDER BY currency`,
  ).map((row) => ({
    currency: row.currency,
    premium: money(row.premium_minor),
    tsi: money(row.tsi_minor),
    transactionCount: row.transaction_count,
  }));

  const settledByCurrency = queryAll(
    `SELECT currency, SUM(COALESCE(gross_claim_minor,0)) AS gross_claim_minor,
            SUM(COALESCE(indemnity_minor,0)) AS indemnity_minor, COUNT(*) AS settlement_count
       FROM claim_settlement
      WHERE is_current = 1 AND record_status = 'Active'
      GROUP BY currency ORDER BY currency`,
  ).map((row) => ({
    currency: row.currency,
    grossClaim: money(row.gross_claim_minor),
    indemnity: money(row.indemnity_minor),
    settlementCount: row.settlement_count,
  }));

  const batchWhere = canViewAll ? '' : ' WHERE b.uploaded_by = ?';
  const batchParams = canViewAll ? [] : [user?.userId];
  const recentBatches = queryAll(
    `SELECT b.*, u.full_name AS uploaded_by_name
       FROM upload_batches b
  LEFT JOIN users u ON u.user_id = b.uploaded_by
       ${batchWhere}
   ORDER BY b.uploaded_at DESC LIMIT 6`,
    batchParams,
  ).map((row) => serializeBatch(row, { approvalRequired: rules.batchApprovalRequired }));

  const statusBreakdown = queryAll(
    `SELECT processing_status, COUNT(*) AS count
       FROM upload_batches GROUP BY processing_status ORDER BY count DESC`,
  ).map((row) => ({ processingStatus: row.processing_status, count: row.count }));

  return {
    kpis: {
      batchesThisMonth,
      pendingReview,
      pendingMapping,
      postedRowsThisMonth,
      activeAgents,
      currentPolicies,
      openClaims,
      claimSettlementsThisMonth: settlementsThisMonth,
    },
    premiumByCurrency,
    settledByCurrency,
    recentBatches,
    statusBreakdown,
  };
}

module.exports = { getDashboard, monthBounds };
