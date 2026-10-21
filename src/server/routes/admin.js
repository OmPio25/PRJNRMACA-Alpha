'use strict';
const express = require('express');
const { asyncHandler, forbidden, validation } = require('../middleware/errors');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { ok, paged, parsePaging, parseBody, assertNoExtraFields } = require('../util/http');
const admin = require('../services/admin');

const router = express.Router();

router.use(requireAuth);

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

router.get('/users', requirePermission('admin.users'), asyncHandler(async (req, res) => {
  const paging = parsePaging(req.query);
  const result = admin.listUsers({
    query: { q: req.query.q, role: req.query.role, status: req.query.status },
    paging,
  });
  paged(res, result.rows, paging.page, paging.pageSize, result.total);
}));

router.post('/users', requirePermission('admin.users'), asyncHandler(async (req, res) => {
  const body = parseBody(req.body || {}, {
    email: { type: 'string', required: true, email: true, maxLength: 200 },
    fullName: { type: 'string', required: true, maxLength: 200 },
    password: { type: 'string', required: true, minLength: 10, maxLength: 200 },
    roleKey: { type: 'string', required: true, enum: admin.ROLE_KEYS },
    status: { type: 'string', enum: ['active', 'inactive'] },
    allowedUploadTypes: { type: 'array', of: 'string', enum: admin.UPLOAD_TYPES, upper: true },
    branchScope: { type: 'array', of: 'string', upper: true },
  });
  ok(res, { user: admin.createUser(body, req.user) }, 201);
}));

router.patch('/users/:id', requirePermission('admin.users'), asyncHandler(async (req, res) => {
  const body = parseBody(req.body || {}, {
    fullName: { type: 'string', maxLength: 200 },
    roleKey: { type: 'string', enum: admin.ROLE_KEYS },
    status: { type: 'string', enum: ['active', 'inactive'] },
    allowedUploadTypes: { type: 'array', of: 'string', enum: admin.UPLOAD_TYPES, upper: true },
    branchScope: { type: 'array', of: 'string', upper: true },
  });
  ok(res, { user: admin.updateUser(req.params.id, body, req.user) });
}));

router.post('/users/:id/reset-password', requirePermission('admin.users'), asyncHandler(async (req, res) => {
  const body = parseBody(req.body || {}, {
    newPassword: { type: 'string', required: true, minLength: 10, maxLength: 200 },
  });
  ok(res, admin.resetPassword(req.params.id, body.newPassword, req.user));
}));

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

router.get('/roles', requirePermission('admin.users'), asyncHandler(async (req, res) => {
  ok(res, { roles: admin.listRoles() });
}));

router.patch('/roles/:roleKey', requirePermission('admin.users'), asyncHandler(async (req, res) => {
  if (req.user.roleKey !== 'administrator') {
    throw forbidden('Hanya Administrator yang dapat mengubah permission role');
  }
  const body = parseBody(req.body || {}, {
    permissions: { type: 'array', of: 'string', required: true },
  });
  ok(res, { role: admin.updateRolePermissions(req.params.roleKey, body.permissions, req.user) });
}));

// ---------------------------------------------------------------------------
// Master data
// ---------------------------------------------------------------------------

for (const [resource, config] of Object.entries(admin.MASTER_CONFIG)) {
  const fieldKeys = Object.keys(config.fields);
  const codeKey = fieldKeys[0];
  const nameKey = fieldKeys[1];

  router.get(`/${resource}`, requirePermission('admin.master'), asyncHandler(async (req, res) => {
    ok(res, { rows: admin.listMasters(resource) });
  }));

  router.post(`/${resource}`, requirePermission('admin.master'), asyncHandler(async (req, res) => {
    const spec = {
      [codeKey]: { type: 'string', required: true, maxLength: 50 },
      [nameKey]: { type: 'string', required: true, maxLength: 200 },
    };
    if (config.fields.region) spec.region = { type: 'string', maxLength: 100 };
    spec.isActive = { type: 'bool' };
    const body = parseBody(req.body || {}, spec);
    ok(res, { row: admin.createMaster(resource, body, req.user) }, 201);
  }));

  router.patch(`/${resource}/:code`, requirePermission('admin.master'), asyncHandler(async (req, res) => {
    const spec = { [nameKey]: { type: 'string', maxLength: 200 } };
    if (config.fields.region) spec.region = { type: 'string', maxLength: 100 };
    spec.isActive = { type: 'bool' };
    const body = parseBody(req.body || {}, spec);
    ok(res, { row: admin.updateMaster(resource, String(req.params.code).toUpperCase(), body, req.user) });
  }));
}

// ---------------------------------------------------------------------------
// Mappings
// ---------------------------------------------------------------------------

router.get('/mappings', requirePermission('admin.master'), asyncHandler(async (req, res) => {
  const paging = parsePaging(req.query);
  const result = admin.listMappings({
    query: { mappingType: req.query.mappingType, q: req.query.q },
    paging,
  });
  paged(res, result.rows, paging.page, paging.pageSize, result.total);
}));

router.post('/mappings', requirePermission('admin.master'), asyncHandler(async (req, res) => {
  const body = parseBody(req.body || {}, {
    mappingType: { type: 'string', required: true, enum: admin.MAPPING_TYPES },
    sourceCode: { type: 'string', required: true, maxLength: 100 },
    internalCode: { type: 'string', required: true, maxLength: 100 },
    notes: { type: 'string', maxLength: 500 },
  });
  ok(res, { mapping: admin.createMapping(body, req.user) }, 201);
}));

router.patch('/mappings/:id', requirePermission('admin.master'), asyncHandler(async (req, res) => {
  const body = parseBody(req.body || {}, {
    internalCode: { type: 'string', maxLength: 100 },
    notes: { type: 'string', maxLength: 500 },
    isActive: { type: 'bool' },
  });
  ok(res, { mapping: admin.updateMapping(req.params.id, body, req.user) });
}));

// ---------------------------------------------------------------------------
// Exchange rates
// ---------------------------------------------------------------------------

router.get('/exchange-rates', requirePermission('admin.rules'), asyncHandler(async (req, res) => {
  const paging = parsePaging(req.query);
  const result = admin.listExchangeRates({ query: req.query, paging });
  paged(res, result.rows, paging.page, paging.pageSize, result.total);
}));

router.post('/exchange-rates', requirePermission('admin.rules'), asyncHandler(async (req, res) => {
  const body = parseBody(req.body || {}, {
    rateDate: { type: 'string', required: true, maxLength: 10 },
    fromCurrency: { type: 'string', required: true, maxLength: 10 },
    toCurrency: { type: 'string', required: true, maxLength: 10 },
    rateType: { type: 'string', enum: admin.RATE_TYPES },
    exchangeRate: { type: 'number', required: true, min: 0.000001 },
  });
  ok(res, { rate: admin.createExchangeRate(body, req.user) }, 201);
}));

router.patch('/exchange-rates/:id', requirePermission('admin.rules'), asyncHandler(async (req, res) => {
  const body = parseBody(req.body || {}, {
    exchangeRate: { type: 'number', min: 0.000001 },
    rateType: { type: 'string', enum: admin.RATE_TYPES },
  });
  ok(res, { rate: admin.updateExchangeRate(req.params.id, body, req.user) });
}));

// ---------------------------------------------------------------------------
// Business rules
// ---------------------------------------------------------------------------

router.get('/business-rules', requirePermission('admin.rules'), asyncHandler(async (req, res) => {
  ok(res, { rules: admin.listBusinessRules() });
}));

function patchRule(ruleKey, body, actor) {
  assertNoExtraFields(body, ['ruleKey', 'ruleValue']);
  if (!Object.prototype.hasOwnProperty.call(body, 'ruleValue')) {
    throw validation('ruleValue wajib diisi', [{ field: 'ruleValue', message: 'Wajib diisi' }]);
  }
  return admin.updateBusinessRule(ruleKey, body.ruleValue, actor);
}

router.patch('/business-rules', requirePermission('admin.rules'), asyncHandler(async (req, res) => {
  const body = req.body || {};
  assertNoExtraFields(body, ['ruleKey', 'ruleValue']);
  if (!body.ruleKey) {
    throw validation('ruleKey wajib diisi', [{ field: 'ruleKey', message: 'Wajib diisi' }]);
  }
  const rule = patchRule(String(body.ruleKey), body, req.user);
  ok(res, { rule });
}));

router.patch('/business-rules/:ruleKey', requirePermission('admin.rules'), asyncHandler(async (req, res) => {
  const rule = patchRule(String(req.params.ruleKey), req.body || {}, req.user);
  ok(res, { rule });
}));

// ---------------------------------------------------------------------------
// Hash configs
// ---------------------------------------------------------------------------

router.get('/hash-configs', requirePermission('admin.hash'), asyncHandler(async (req, res) => {
  ok(res, { configs: admin.listHashConfigs(req.query.uploadType || null) });
}));

router.post('/hash-configs', requirePermission('admin.hash'), asyncHandler(async (req, res) => {
  const body = parseBody(req.body || {}, {
    uploadType: { type: 'string', required: true, enum: admin.UPLOAD_TYPES },
    hashConfigVersion: { type: 'string', maxLength: 100 },
    columns: { type: 'array', of: 'string', required: true },
    businessKeyColumns: { type: 'array', of: 'string', required: true },
    effectiveFrom: { type: 'string', maxLength: 10 },
    notes: { type: 'string', maxLength: 500 },
  });
  ok(res, { config: admin.createHashConfig(body, req.user) }, 201);
}));

module.exports = router;
