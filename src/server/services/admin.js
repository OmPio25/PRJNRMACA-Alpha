'use strict';
/** Administrasi: users, roles/permissions, master data, mapping, kurs, rules, hash config. */
const { queryAll, queryOne, execute, withTransaction, newId, nowIso } = require('../../../db/database');
const { hashPassword } = require('../../../db/password');
const { validation, notFound, conflict, forbidden, AppError } = require('../middleware/errors');
const { recordAudit } = require('./audit');
const identity = require('./identity');
const { loadRuleRows, decodeRule } = require('./settings');
const { parseJson, serializeUser } = require('../util/serialize');

const UPLOAD_TYPES = ['AGENT', 'PRODUCTION', 'CLAIM'];
const RATE_TYPES = ['MID', 'BUY', 'SELL', 'CENTRAL_BANK', 'CONTRACTUAL'];
const ROLE_KEYS = ['administrator', 'data_operations', 'uploader', 'underwriting', 'claims', 'finance', 'auditor'];
const KNOWN_PERMISSIONS = [
  'upload.create', 'upload.view.all', 'upload.approve', 'upload.post', 'upload.cancel',
  'agent.write', 'production.write', 'claim.write',
  'report.view', 'report.financial', 'report.claim', 'report.production',
  'export.claim', 'audit.view',
  'admin.users', 'admin.master', 'admin.rules', 'admin.hash',
];

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

function listUsers({ query = {}, paging }) {
  const where = [];
  const params = [];
  if (query.q) {
    where.push('(u.email LIKE ? OR u.full_name LIKE ?)');
    params.push(`%${query.q}%`, `%${query.q}%`);
  }
  if (query.role) { where.push('u.role_key = ?'); params.push(query.role); }
  if (query.status) { where.push('u.status = ?'); params.push(query.status); }
  const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const total = queryOne(`SELECT COUNT(*) AS c FROM users u${whereSql}`, params).c;
  const rows = queryAll(
    `SELECT u.*, r.role_name FROM users u
  LEFT JOIN roles r ON r.role_key = u.role_key
      ${whereSql}
   ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
    [...params, paging.limit, paging.offset],
  ).map((row) => ({
    ...serializeUser(row),
    status: row.status,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
  }));
  return { rows, total };
}

function assertRole(roleKey) {
  const row = queryOne('SELECT role_key FROM roles WHERE role_key = ?', [roleKey]);
  if (!row) throw validation('Role tidak ditemukan', [{ field: 'roleKey', message: 'Role tidak valid' }]);
}

function createUser(payload, actor) {
  const email = String(payload.email || '').trim().toLowerCase();
  if (!email) throw validation('Email wajib diisi', [{ field: 'email', message: 'Wajib diisi' }]);
  if (queryOne('SELECT user_id FROM users WHERE lower(email) = lower(?)', [email])) {
    throw conflict('Email sudah digunakan', [{ field: 'email', message: 'Email sudah terdaftar' }]);
  }
  const roleKey = payload.roleKey || 'uploader';
  assertRole(roleKey);
  const password = String(payload.password || '');
  if (password.length < 10) {
    throw validation('Password minimal 10 karakter', [{ field: 'password', message: 'Minimal 10 karakter' }]);
  }
  const allowed = Array.isArray(payload.allowedUploadTypes) ? payload.allowedUploadTypes : [];
  if (allowed.some((type) => !UPLOAD_TYPES.includes(type))) {
    throw validation('allowedUploadTypes tidak valid', [{ field: 'allowedUploadTypes', message: `Gunakan: ${UPLOAD_TYPES.join(', ')}` }]);
  }
  const branchScope = Array.isArray(payload.branchScope) ? payload.branchScope.map((b) => String(b).toUpperCase()) : [];
  const status = payload.status || 'active';
  if (!['active', 'inactive'].includes(status)) {
    throw validation('Status user tidak valid', [{ field: 'status', message: 'active atau inactive' }]);
  }
  const userId = newId('USR');
  const ts = nowIso();
  withTransaction(() => {
    execute(
      `INSERT INTO users
         (user_id, email, full_name, password_hash, role_key, status, allowed_upload_types,
          branch_scope, must_change_password, created_at, created_by, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
      [
        userId, email, String(payload.fullName || '').trim(), hashPassword(password), roleKey,
        status, JSON.stringify(allowed), JSON.stringify(branchScope), ts, actor.userId, ts, actor.userId,
      ],
    );
    recordAudit({
      entityType: 'USER',
      entityId: userId,
      action: 'CREATE',
      actor,
      after: { email, fullName: payload.fullName, roleKey, status, allowedUploadTypes: allowed, branchScope },
    });
  });
  return serializeUser(identity.getUserRow(userId));
}

function updateUser(userId, payload, actor) {
  const before = identity.getUserRow(userId);
  if (!before) throw notFound('User tidak ditemukan');
  const fields = [];
  const params = [];
  if (payload.roleKey !== undefined) {
    assertRole(payload.roleKey);
    fields.push('role_key = ?');
    params.push(payload.roleKey);
  }
  if (payload.fullName !== undefined) {
    fields.push('full_name = ?');
    params.push(String(payload.fullName).trim());
  }
  if (payload.status !== undefined) {
    if (!['active', 'inactive'].includes(payload.status)) {
      throw validation('Status user tidak valid', [{ field: 'status', message: 'active atau inactive' }]);
    }
    fields.push('status = ?');
    params.push(payload.status);
  }
  if (payload.allowedUploadTypes !== undefined) {
    if (payload.allowedUploadTypes.some((type) => !UPLOAD_TYPES.includes(type))) {
      throw validation('allowedUploadTypes tidak valid', [{ field: 'allowedUploadTypes', message: `Gunakan: ${UPLOAD_TYPES.join(', ')}` }]);
    }
    fields.push('allowed_upload_types = ?');
    params.push(JSON.stringify(payload.allowedUploadTypes));
  }
  if (payload.branchScope !== undefined) {
    fields.push('branch_scope = ?');
    params.push(JSON.stringify(payload.branchScope.map((b) => String(b).toUpperCase())));
  }
  if (fields.length === 0) throw validation('Tidak ada field yang diubah');
  const ts = nowIso();
  fields.push('updated_at = ?', 'updated_by = ?');
  params.push(ts, actor.userId, userId);
  withTransaction(() => {
    execute(`UPDATE users SET ${fields.join(', ')} WHERE user_id = ?`, params);
    const after = identity.getUserRow(userId);
    recordAudit({
      entityType: 'USER',
      entityId: userId,
      action: 'UPDATE',
      actor,
      before: { ...serializeUser(before), status: before.status },
      after: { ...serializeUser(after), status: after.status },
    });
  });
  return serializeUser(identity.getUserRow(userId));
}

function resetPassword(userId, newPassword, actor) {
  const row = identity.getUserRow(userId);
  if (!row) throw notFound('User tidak ditemukan');
  identity.setPassword(userId, newPassword, { mustChange: true, actor, reason: 'ADMIN_RESET_PASSWORD' });
  return { reset: true, userId, mustChangePassword: true };
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

function listRoles() {
  const roles = queryAll('SELECT * FROM roles ORDER BY role_key');
  const permissions = queryAll('SELECT role_key, permission FROM role_permissions ORDER BY permission');
  const byRole = new Map();
  for (const row of permissions) {
    if (!byRole.has(row.role_key)) byRole.set(row.role_key, []);
    byRole.get(row.role_key).push(row.permission);
  }
  return roles.map((role) => ({
    roleKey: role.role_key,
    roleName: role.role_name,
    description: role.description,
    permissions: byRole.get(role.role_key) || [],
  }));
}

function updateRolePermissions(roleKey, permissions, actor) {
  const role = queryOne('SELECT * FROM roles WHERE role_key = ?', [roleKey]);
  if (!role) throw notFound('Role tidak ditemukan');
  if (!Array.isArray(permissions)) {
    throw validation('permissions harus berupa array', [{ field: 'permissions', message: 'Harus array' }]);
  }
  const unknown = permissions.filter((permission) => !KNOWN_PERMISSIONS.includes(permission));
  if (unknown.length > 0) {
    throw validation('Permission tidak dikenal', unknown.map((permission) => ({
      field: 'permissions', message: permission,
    })));
  }
  const before = queryAll('SELECT permission FROM role_permissions WHERE role_key = ? ORDER BY permission', [roleKey])
    .map((row) => row.permission);
  withTransaction(() => {
    execute('DELETE FROM role_permissions WHERE role_key = ?', [roleKey]);
    for (const permission of [...new Set(permissions)]) {
      execute('INSERT INTO role_permissions (role_key, permission) VALUES (?, ?)', [roleKey, permission]);
    }
    recordAudit({
      entityType: 'ROLE',
      entityId: roleKey,
      action: 'UPDATE',
      actor,
      before: { permissions: before },
      after: { permissions: [...new Set(permissions)] },
    });
  });
  return listRoles().find((row) => row.roleKey === roleKey);
}

// ---------------------------------------------------------------------------
// Master data
// ---------------------------------------------------------------------------

const MASTER_CONFIG = {
  currencies: {
    table: 'master_currency', pk: 'currency_code',
    fields: { currencyCode: 'currency_code', currencyName: 'currency_name' },
    label: 'CURRENCY',
  },
  branches: {
    table: 'master_branch', pk: 'branch_code',
    fields: { branchCode: 'branch_code', branchName: 'branch_name', region: 'region' },
    label: 'BRANCH',
  },
  products: {
    table: 'master_product', pk: 'product_code',
    fields: { productCode: 'product_code', productName: 'product_name' },
    label: 'PRODUCT',
  },
  coverages: {
    table: 'master_coverage', pk: 'coverage_code',
    fields: { coverageCode: 'coverage_code', coverageName: 'coverage_name' },
    label: 'COVERAGE',
  },
  'causes-of-loss': {
    table: 'master_cause_of_loss', pk: 'cause_code',
    fields: { causeCode: 'cause_code', causeName: 'cause_name' },
    label: 'CAUSE_OF_LOSS',
  },
};

function masterConfig(resource) {
  const config = MASTER_CONFIG[resource];
  if (!config) throw notFound(`Master data tidak dikenal: ${resource}`);
  return config;
}

function serializeMaster(config, row) {
  const out = {};
  for (const [apiKey, column] of Object.entries(config.fields)) out[apiKey] = row[column];
  out.isActive = row.is_active === 1;
  out.createdAt = row.created_at;
  out.updatedAt = row.updated_at;
  return out;
}

function listMasters(resource) {
  const config = masterConfig(resource);
  return queryAll(`SELECT * FROM ${config.table} ORDER BY ${config.pk}`)
    .map((row) => serializeMaster(config, row));
}

function createMaster(resource, payload, actor) {
  const config = masterConfig(resource);
  const codeKey = Object.keys(config.fields)[0];
  const nameKey = Object.keys(config.fields)[1];
  const code = String(payload[codeKey] || '').trim().toUpperCase();
  const name = String(payload[nameKey] || '').trim();
  if (!code) throw validation(`${codeKey} wajib diisi`, [{ field: codeKey, message: 'Wajib diisi' }]);
  if (!name) throw validation(`${nameKey} wajib diisi`, [{ field: nameKey, message: 'Wajib diisi' }]);
  if (queryOne(`SELECT ${config.pk} FROM ${config.table} WHERE ${config.pk} = ?`, [code])) {
    throw conflict('Kode sudah ada', [{ field: codeKey, message: 'Duplikat' }]);
  }
  const columns = [config.pk, ...Object.values(config.fields).slice(1), 'is_active', 'created_at', 'created_by'];
  const values = [code, name];
  if (config.fields.region) values.push(payload.region ? String(payload.region).trim() : null);
  values.push(payload.isActive === false ? 0 : 1, nowIso(), actor.userId);
  withTransaction(() => {
    execute(
      `INSERT INTO ${config.table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
      values,
    );
    recordAudit({
      entityType: `MASTER_${config.label}`,
      entityId: code,
      action: 'CREATE',
      actor,
      after: { code, name },
    });
  });
  return serializeMaster(config, queryOne(`SELECT * FROM ${config.table} WHERE ${config.pk} = ?`, [code]));
}

function updateMaster(resource, code, payload, actor) {
  const config = masterConfig(resource);
  const before = queryOne(`SELECT * FROM ${config.table} WHERE ${config.pk} = ?`, [code]);
  if (!before) throw notFound('Master data tidak ditemukan');
  const fields = [];
  const params = [];
  const nameKey = Object.keys(config.fields)[1];
  if (payload[nameKey] !== undefined) {
    fields.push(`${config.fields[nameKey]} = ?`);
    params.push(String(payload[nameKey]).trim());
  }
  if (payload.region !== undefined && config.fields.region) {
    fields.push('region = ?');
    params.push(payload.region ? String(payload.region).trim() : null);
  }
  if (payload.isActive !== undefined) {
    fields.push('is_active = ?');
    params.push(payload.isActive ? 1 : 0);
  }
  if (fields.length === 0) throw validation('Tidak ada field yang diubah');
  fields.push('updated_at = ?', 'updated_by = ?');
  params.push(nowIso(), actor.userId, code);
  withTransaction(() => {
    execute(`UPDATE ${config.table} SET ${fields.join(', ')} WHERE ${config.pk} = ?`, params);
    const after = queryOne(`SELECT * FROM ${config.table} WHERE ${config.pk} = ?`, [code]);
    recordAudit({
      entityType: `MASTER_${config.label}`,
      entityId: code,
      action: 'UPDATE',
      actor,
      before: serializeMaster(config, before),
      after: serializeMaster(config, after),
    });
  });
  return serializeMaster(config, queryOne(`SELECT * FROM ${config.table} WHERE ${config.pk} = ?`, [code]));
}

// ---------------------------------------------------------------------------
// Mappings
// ---------------------------------------------------------------------------

const MAPPING_TYPES = ['PRODUCT', 'BRANCH', 'COVERAGE', 'CAUSE_OF_LOSS', 'CURRENCY'];

function serializeMapping(row) {
  return {
    mappingId: row.mapping_id,
    mappingType: row.mapping_type,
    sourceCode: row.source_code,
    internalCode: row.internal_code,
    notes: row.notes,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
  };
}

function listMappings({ query = {}, paging }) {
  const where = [];
  const params = [];
  if (query.mappingType) {
    const type = String(query.mappingType).toUpperCase();
    if (!MAPPING_TYPES.includes(type)) {
      throw validation('mappingType tidak valid', [{ field: 'mappingType', message: `Gunakan: ${MAPPING_TYPES.join(', ')}` }]);
    }
    where.push('mapping_type = ?');
    params.push(type);
  }
  if (query.q) {
    where.push('(source_code LIKE ? OR internal_code LIKE ?)');
    params.push(`%${query.q}%`, `%${query.q}%`);
  }
  const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const total = queryOne(`SELECT COUNT(*) AS c FROM master_mapping${whereSql}`, params).c;
  const rows = queryAll(
    `SELECT * FROM master_mapping${whereSql} ORDER BY mapping_type, source_code LIMIT ? OFFSET ?`,
    [...params, paging.limit, paging.offset],
  ).map(serializeMapping);
  return { rows, total };
}

function createMapping(payload, actor) {
  const mappingType = String(payload.mappingType || '').toUpperCase();
  if (!MAPPING_TYPES.includes(mappingType)) {
    throw validation('mappingType tidak valid', [{ field: 'mappingType', message: `Gunakan: ${MAPPING_TYPES.join(', ')}` }]);
  }
  const sourceCode = String(payload.sourceCode || '').trim().toUpperCase();
  const internalCode = String(payload.internalCode || '').trim().toUpperCase();
  if (!sourceCode || !internalCode) {
    throw validation('sourceCode dan internalCode wajib diisi', [
      { field: 'sourceCode', message: 'Wajib diisi' },
    ]);
  }
  if (queryOne('SELECT mapping_id FROM master_mapping WHERE mapping_type = ? AND source_code = ?', [mappingType, sourceCode])) {
    throw conflict('Mapping sumber sudah ada', [{ field: 'sourceCode', message: 'Duplikat' }]);
  }
  const mappingId = newId('MAP');
  const ts = nowIso();
  withTransaction(() => {
    execute(
      `INSERT INTO master_mapping
         (mapping_id, mapping_type, source_code, internal_code, notes, is_active, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      [mappingId, mappingType, sourceCode, internalCode, payload.notes || null, ts, actor.userId],
    );
    recordAudit({
      entityType: 'MASTER_MAPPING',
      entityId: mappingId,
      action: 'CREATE',
      actor,
      after: { mappingType, sourceCode, internalCode },
    });
  });
  return serializeMapping(queryOne('SELECT * FROM master_mapping WHERE mapping_id = ?', [mappingId]));
}

function updateMapping(mappingId, payload, actor) {
  const before = queryOne('SELECT * FROM master_mapping WHERE mapping_id = ?', [mappingId]);
  if (!before) throw notFound('Mapping tidak ditemukan');
  const fields = [];
  const params = [];
  if (payload.internalCode !== undefined) {
    fields.push('internal_code = ?');
    params.push(String(payload.internalCode).trim().toUpperCase());
  }
  if (payload.notes !== undefined) {
    fields.push('notes = ?');
    params.push(payload.notes ? String(payload.notes).trim() : null);
  }
  if (payload.isActive !== undefined) {
    fields.push('is_active = ?');
    params.push(payload.isActive ? 1 : 0);
  }
  if (fields.length === 0) throw validation('Tidak ada field yang diubah');
  fields.push('updated_at = ?', 'updated_by = ?');
  params.push(nowIso(), actor.userId, mappingId);
  withTransaction(() => {
    execute(`UPDATE master_mapping SET ${fields.join(', ')} WHERE mapping_id = ?`, params);
    recordAudit({
      entityType: 'MASTER_MAPPING',
      entityId: mappingId,
      action: 'UPDATE',
      actor,
      before: serializeMapping(before),
      after: serializeMapping(queryOne('SELECT * FROM master_mapping WHERE mapping_id = ?', [mappingId])),
    });
  });
  return serializeMapping(queryOne('SELECT * FROM master_mapping WHERE mapping_id = ?', [mappingId]));
}

// ---------------------------------------------------------------------------
// Exchange rates
// ---------------------------------------------------------------------------

function serializeRate(row) {
  return {
    exchangeRateId: row.exchange_rate_id,
    rateDate: row.rate_date,
    fromCurrency: row.from_currency,
    toCurrency: row.to_currency,
    rateType: row.rate_type,
    exchangeRate: row.exchange_rate,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    createdAt: row.created_at,
  };
}

function listExchangeRates({ query = {}, paging }) {
  const where = [];
  const params = [];
  if (query.fromCurrency) { where.push('from_currency = ?'); params.push(String(query.fromCurrency).toUpperCase()); }
  if (query.toCurrency) { where.push('to_currency = ?'); params.push(String(query.toCurrency).toUpperCase()); }
  if (query.rateType) {
    const rateType = String(query.rateType).toUpperCase();
    if (!RATE_TYPES.includes(rateType)) {
      throw validation('rateType tidak valid', [{ field: 'rateType', message: `Gunakan: ${RATE_TYPES.join(', ')}` }]);
    }
    where.push('rate_type = ?'); params.push(rateType);
  }
  if (query.from) { where.push('rate_date >= ?'); params.push(query.from); }
  if (query.to) { where.push('rate_date <= ?'); params.push(query.to); }
  const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const total = queryOne(`SELECT COUNT(*) AS c FROM exchange_rate${whereSql}`, params).c;
  const rows = queryAll(
    `SELECT * FROM exchange_rate${whereSql} ORDER BY rate_date DESC, exchange_rate_id LIMIT ? OFFSET ?`,
    [...params, paging.limit, paging.offset],
  ).map(serializeRate);
  return { rows, total };
}

function assertRateActor(actor) {
  if (!['finance', 'administrator'].includes(actor.roleKey)) {
    throw forbidden('Hanya Finance atau Administrator yang dapat menetapkan kurs resmi');
  }
}

function createExchangeRate(payload, actor) {
  assertRateActor(actor);
  const from = String(payload.fromCurrency || '').toUpperCase();
  const to = String(payload.toCurrency || '').toUpperCase();
  if (from === to) {
    throw validation('fromCurrency dan toCurrency harus berbeda', [{ field: 'toCurrency', message: 'Tidak boleh sama' }]);
  }
  for (const [field, code] of [['fromCurrency', from], ['toCurrency', to]]) {
    if (!queryOne('SELECT currency_code FROM master_currency WHERE currency_code = ?', [code])) {
      throw validation('Currency tidak ditemukan', [{ field, message: 'Tidak ada di master' }]);
    }
  }
  const rateType = String(payload.rateType || 'MID').toUpperCase();
  if (!RATE_TYPES.includes(rateType)) {
    throw validation('rateType tidak valid', [{ field: 'rateType', message: `Gunakan: ${RATE_TYPES.join(', ')}` }]);
  }
  const rate = Number(payload.exchangeRate);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw validation('exchangeRate tidak valid', [{ field: 'exchangeRate', message: 'Harus > 0' }]);
  }
  const rateDate = String(payload.rateDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rateDate)) {
    throw validation('rateDate tidak valid', [{ field: 'rateDate', message: 'Gunakan YYYY-MM-DD' }]);
  }
  if (queryOne(
    'SELECT exchange_rate_id FROM exchange_rate WHERE rate_date = ? AND from_currency = ? AND to_currency = ? AND rate_type = ?',
    [rateDate, from, to, rateType],
  )) {
    throw conflict('Kurs untuk tanggal, pasangan, dan tipe ini sudah ada');
  }
  const id = newId('RATE');
  const ts = nowIso();
  withTransaction(() => {
    execute(
      `INSERT INTO exchange_rate
         (exchange_rate_id, rate_date, from_currency, to_currency, rate_type, exchange_rate,
          approved_by, approved_at, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, rateDate, from, to, rateType, rate, actor.userId, ts, ts, actor.userId],
    );
    recordAudit({
      entityType: 'EXCHANGE_RATE',
      entityId: id,
      action: 'CREATE',
      actor,
      after: { rateDate, fromCurrency: from, toCurrency: to, rateType, exchangeRate: rate },
    });
  });
  return serializeRate(queryOne('SELECT * FROM exchange_rate WHERE exchange_rate_id = ?', [id]));
}

function updateExchangeRate(id, payload, actor) {
  assertRateActor(actor);
  const before = queryOne('SELECT * FROM exchange_rate WHERE exchange_rate_id = ?', [id]);
  if (!before) throw notFound('Kurs tidak ditemukan');
  const fields = [];
  const params = [];
  if (payload.exchangeRate !== undefined) {
    const rate = Number(payload.exchangeRate);
    if (!Number.isFinite(rate) || rate <= 0) {
      throw validation('exchangeRate tidak valid', [{ field: 'exchangeRate', message: 'Harus > 0' }]);
    }
    fields.push('exchange_rate = ?', 'approved_by = ?', 'approved_at = ?');
    params.push(rate, actor.userId, nowIso());
  }
  if (payload.rateType !== undefined) {
    const rateType = String(payload.rateType).toUpperCase();
    if (!RATE_TYPES.includes(rateType)) {
      throw validation('rateType tidak valid', [{ field: 'rateType', message: `Gunakan: ${RATE_TYPES.join(', ')}` }]);
    }
    fields.push('rate_type = ?');
    params.push(rateType);
  }
  if (fields.length === 0) throw validation('Tidak ada field yang diubah');
  fields.push('updated_at = ?', 'updated_by = ?');
  params.push(nowIso(), actor.userId, id);
  withTransaction(() => {
    execute(`UPDATE exchange_rate SET ${fields.join(', ')} WHERE exchange_rate_id = ?`, params);
    recordAudit({
      entityType: 'EXCHANGE_RATE',
      entityId: id,
      action: 'UPDATE',
      actor,
      before: serializeRate(before),
      after: serializeRate(queryOne('SELECT * FROM exchange_rate WHERE exchange_rate_id = ?', [id])),
    });
  });
  return serializeRate(queryOne('SELECT * FROM exchange_rate WHERE exchange_rate_id = ?', [id]));
}

// ---------------------------------------------------------------------------
// Business rules
// ---------------------------------------------------------------------------

function serializeRule(row) {
  return {
    ruleKey: row.rule_key,
    ruleValue: decodeRule(row),
    dataType: row.data_type,
    description: row.description,
    status: row.status,
    versionNo: row.version_no,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

function listBusinessRules() {
  return loadRuleRows().map((row) => serializeRule(queryOne('SELECT * FROM business_rules WHERE rule_key = ?', [row.rule_key])));
}

function coerceRuleValue(dataType, value) {
  switch (dataType) {
    case 'boolean':
      if (typeof value !== 'boolean') {
        throw validation('Nilai aturan harus boolean', [{ field: 'ruleValue', message: 'Boolean diperlukan' }]);
      }
      return value;
    case 'number': {
      const n = Number(value);
      if (!Number.isFinite(n)) throw validation('Nilai aturan harus angka');
      return n;
    }
    case 'json':
      if (value === null || typeof value !== 'object') {
        throw validation('Nilai aturan harus JSON array/objek', [{ field: 'ruleValue', message: 'JSON diperlukan' }]);
      }
      return value;
    case 'formula':
    case 'string':
      if (typeof value !== 'string') {
        throw validation('Nilai aturan harus teks', [{ field: 'ruleValue', message: 'Teks diperlukan' }]);
      }
      return value;
    default:
      return value;
  }
}

function updateBusinessRule(ruleKey, ruleValue, actor) {
  const before = queryOne('SELECT * FROM business_rules WHERE rule_key = ?', [ruleKey]);
  if (!before) throw notFound('Business rule tidak ditemukan');
  if (ruleKey === 'net_claim_formula' && !['finance', 'administrator'].includes(actor.roleKey)) {
    throw forbidden('Hanya Finance atau Administrator yang dapat menetapkan rumus Net Claims Cost');
  }
  const value = coerceRuleValue(before.data_type, ruleValue);
  const isNetFormula = ruleKey === 'net_claim_formula';
  let status = before.status;
  let approvedBy = before.approved_by;
  let approvedAt = before.approved_at;
  if (isNetFormula) {
    if (String(value).trim() === '') {
      status = 'pending_approval';
      approvedBy = null;
      approvedAt = null;
    } else {
      status = 'active';
      approvedBy = actor.userId;
      approvedAt = nowIso();
    }
  }
  const ts = nowIso();
  withTransaction(() => {
    execute(
      `UPDATE business_rules
          SET rule_value = ?, status = ?, version_no = version_no + 1,
              approved_by = ?, approved_at = ?, updated_at = ?, updated_by = ?
        WHERE rule_key = ?`,
      [JSON.stringify(value), status, approvedBy, approvedAt, ts, actor.userId, ruleKey],
    );
    recordAudit({
      entityType: 'BUSINESS_RULE',
      entityId: ruleKey,
      action: 'UPDATE',
      actor,
      before: { ruleValue: decodeRule(before), status: before.status, versionNo: before.version_no },
      after: { ruleValue: value, status, versionNo: before.version_no + 1 },
    });
  });
  return serializeRule(queryOne('SELECT * FROM business_rules WHERE rule_key = ?', [ruleKey]));
}

// ---------------------------------------------------------------------------
// Hash configs
// ---------------------------------------------------------------------------

function serializeHashConfig(row) {
  return {
    hashConfigVersion: row.hash_config_version,
    uploadType: row.upload_type,
    columns: parseJson(row.columns_json, []),
    businessKeyColumns: parseJson(row.business_key_json, []),
    effectiveFrom: row.effective_from,
    isActive: row.is_active === 1,
    notes: row.notes,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

function listHashConfigs(uploadType = null) {
  const where = uploadType ? ' WHERE upload_type = ?' : '';
  const params = uploadType ? [String(uploadType).toUpperCase()] : [];
  return queryAll(
    `SELECT * FROM hash_config${where} ORDER BY upload_type, effective_from DESC, created_at DESC`,
    params,
  ).map(serializeHashConfig);
}

function validateColumnList(columns, field) {
  if (!Array.isArray(columns) || columns.length === 0 || columns.some((c) => typeof c !== 'string' || !c.trim())) {
    throw validation(`${field} harus array kolom tidak kosong`, [{ field, message: 'Array kolom wajib diisi' }]);
  }
  return columns.map((c) => c.trim());
}

function createHashConfig(payload, actor) {
  const uploadType = String(payload.uploadType || '').toUpperCase();
  if (!UPLOAD_TYPES.includes(uploadType)) {
    throw validation('uploadType tidak valid', [{ field: 'uploadType', message: `Gunakan: ${UPLOAD_TYPES.join(', ')}` }]);
  }
  const columns = validateColumnList(payload.columns, 'columns');
  const businessKeyColumns = validateColumnList(payload.businessKeyColumns, 'businessKeyColumns');
  const existing = queryAll('SELECT hash_config_version FROM hash_config WHERE upload_type = ?', [uploadType]);
  const version = payload.hashConfigVersion
    ? String(payload.hashConfigVersion).trim()
    : `${uploadType}-v${existing.length + 1}`;
  if (queryOne('SELECT hash_config_version FROM hash_config WHERE upload_type = ? AND hash_config_version = ?', [uploadType, version])) {
    throw conflict('Versi konfigurasi hash sudah ada');
  }
  const effectiveFrom = payload.effectiveFrom ? String(payload.effectiveFrom).slice(0, 10) : nowIso().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
    throw validation('effectiveFrom tidak valid', [{ field: 'effectiveFrom', message: 'Gunakan YYYY-MM-DD' }]);
  }
  const ts = nowIso();
  withTransaction(() => {
    execute('UPDATE hash_config SET is_active = 0 WHERE upload_type = ?', [uploadType]);
    execute(
      `INSERT INTO hash_config
         (hash_config_version, upload_type, columns_json, business_key_json,
          effective_from, is_active, notes, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      [version, uploadType, JSON.stringify(columns), JSON.stringify(businessKeyColumns), effectiveFrom, payload.notes || null, ts, actor.userId],
    );
    recordAudit({
      entityType: 'HASH_CONFIG',
      entityId: version,
      action: 'CREATE',
      actor,
      after: { uploadType, columns, businessKeyColumns, effectiveFrom },
    });
  });
  return serializeHashConfig(queryOne('SELECT * FROM hash_config WHERE hash_config_version = ?', [version]));
}

module.exports = {
  MASTER_CONFIG,
  MAPPING_TYPES,
  RATE_TYPES,
  UPLOAD_TYPES,
  KNOWN_PERMISSIONS,
  ROLE_KEYS,
  listUsers,
  createUser,
  updateUser,
  resetPassword,
  listRoles,
  updateRolePermissions,
  listMasters,
  createMaster,
  updateMaster,
  listMappings,
  createMapping,
  updateMapping,
  listExchangeRates,
  createExchangeRate,
  updateExchangeRate,
  listBusinessRules,
  updateBusinessRule,
  listHashConfigs,
  createHashConfig,
};
