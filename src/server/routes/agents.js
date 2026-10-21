'use strict';
const express = require('express');
const { asyncHandler } = require('../middleware/errors');
const { requireAuth, requirePermission, attachScope } = require('../middleware/auth');
const { ok, paged, parsePaging, parseSort, parseBody } = require('../util/http');
const agents = require('../services/agents');
const { serializeAgent, serializeAgentVersion, amount } = require('../util/serialize');

const router = express.Router();

router.use(requireAuth, attachScope);

const SORT_KEYS = Object.keys(agents.SORT_WHITELIST);

router.get('/', asyncHandler(async (req, res) => {
  const paging = parsePaging(req.query);
  const sort = parseSort(req.query.sort, req.query.order, agents.SORT_WHITELIST, 'agentKey');
  const result = agents.listAgents({
    query: {
      q: req.query.q,
      branch: req.query.branch,
      statusKey: req.query.statusKey,
    },
    paging,
    sort,
    scope: req.branchScope,
  });
  paged(res, result.rows.map(serializeAgent), paging.page, paging.pageSize, result.total);
}));

router.get('/pending-mapping', requirePermission('agent.write'), asyncHandler(async (req, res) => {
  ok(res, { rows: agents.pendingMapping(req.branchScope) });
}));

router.post('/resolve-mapping', requirePermission('agent.write'), asyncHandler(async (req, res) => {
  const body = parseBody(req.body || {}, {
    kodeagen: { type: 'string', required: true, maxLength: 100 },
    action: { type: 'string', enum: ['CREATE', 'MAP', 'ASSIGN'] },
    agentIdInternal: { type: 'string', maxLength: 100 },
    namaAgent: { type: 'string', maxLength: 200 },
    branchCode: { type: 'string', maxLength: 20 },
    statusAgent: { type: 'string', maxLength: 30 },
    agentIdSource: { type: 'string', maxLength: 100 },
  });
  const result = agents.resolveMapping({
    kodeagen: body.kodeagen,
    action: body.action || 'CREATE',
    agentIdInternal: body.agentIdInternal || null,
    payload: body,
    actor: req.user,
  });
  ok(res, { agent: serializeAgent(result.agent), affectedRows: result.affectedRows });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const detail = agents.getAgentDetail(req.params.id);
  ok(res, {
    agent: serializeAgent(detail.agent),
    versions: detail.versions.map(serializeAgentVersion),
    productionSummary: detail.productionSummary.map((row) => ({
      currency: row.currency,
      transactionCount: row.transaction_count,
      premium: amount(row.premium_minor),
      tsi: amount(row.tsi_minor),
    })),
    claimSummary: detail.claimSummary.map((row) => ({
      currency: row.currency,
      claimCount: row.claim_count,
      settlementCount: row.settlement_count,
      grossClaim: amount(row.gross_claim_minor),
      indemnity: amount(row.indemnity_minor),
    })),
  });
}));

router.post('/', requirePermission('agent.write'), asyncHandler(async (req, res) => {
  const body = parseBody(req.body || {}, {
    kodeagen: { type: 'string', required: true, maxLength: 100 },
    agentIdSource: { type: 'string', maxLength: 100 },
    namaAgent: { type: 'string', maxLength: 200 },
    branchCode: { type: 'string', required: true, maxLength: 20 },
    statusAgent: { type: 'string', enum: ['Active', 'Inactive'] },
  });
  const agent = agents.createAgent(body, req.user);
  ok(res, { agent: serializeAgent(agent) }, 201);
}));

router.patch('/:id', requirePermission('agent.write'), asyncHandler(async (req, res) => {
  const body = parseBody(req.body || {}, {
    namaAgent: { type: 'string', maxLength: 200 },
    branchCode: { type: 'string', maxLength: 20 },
    statusAgent: { type: 'string', enum: ['Active', 'Inactive'] },
  });
  const agent = agents.updateAgent(req.params.id, body, req.user);
  ok(res, { agent: serializeAgent(agent) });
}));

module.exports = router;
module.exports.SORT_KEYS = SORT_KEYS;
