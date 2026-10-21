'use strict';
/** Uji kontrak API, RBAC, dan ketersediaan aset SPA. */
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { setupEnv, startServer, stopServer, Client, data } = require('./helpers');

const env = setupEnv();
const { seed } = require('../db/seed');

let server;
let base;

before(async () => {
  seed();
  ({ server, base } = await startServer());
});

after(async () => {
  await stopServer(server, env.dir);
});

async function loginAs(email) {
  const client = new Client(base);
  const result = await client.login(email);
  assert.equal(result.status, 200, `login ${email} harus berhasil`);
  return client;
}

describe('Autentikasi & keamanan dasar', () => {
  test('endpoint API tanpa sesi mengembalikan 401 AUTH_REQUIRED', async () => {
    const anonymous = new Client(base);
    const result = await anonymous.get('/api/agents');
    assert.equal(result.status, 401);
    assert.equal(result.body.error.code, 'AUTH_REQUIRED');
  });

  test('login salah tidak membocorkan detail internal', async () => {
    const anonymous = new Client(base);
    const result = await anonymous.login('admin@demo.local', 'salah-sekali');
    assert.equal(result.status, 401);
    assert.equal(result.body.ok, false);
    assert.equal(result.body.error.code, 'AUTH_REQUIRED');
    assert.equal(result.body.error.stack, undefined);
    assert.ok(!JSON.stringify(result.body).toLowerCase().includes('sqlite'));
  });

  test('/auth/me mengembalikan user, role, dan permission efektif', async () => {
    const admin = await loginAs('admin@demo.local');
    const me = data(await admin.get('/api/auth/me'));
    assert.equal(me.user.email, 'admin@demo.local');
    assert.equal(me.user.roleKey, 'administrator');
    assert.ok(me.permissions.includes('admin.users'));
    assert.ok(me.roles.length >= 1);
  });

  test('logout mengakhiri sesi', async () => {
    const client = await loginAs('auditor@demo.local');
    const logout = await client.post('/api/auth/logout');
    assert.equal(logout.status, 200);
    const after = await client.get('/api/dashboard');
    assert.equal(after.status, 401);
  });
});

describe('RBAC ditegakkan di server', () => {
  test('uploader tidak dapat menyetujui batch dan hanya melihat batch miliknya', async () => {
    const uploader = await loginAs('uploader@demo.local');
    const forbidden = await uploader.post('/api/uploads/UPL-0005/approve', {});
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.body.error.code, 'FORBIDDEN');

    const batches = data(await uploader.get('/api/uploads?pageSize=100'));
    assert.ok(batches.rows.every((batch) => batch.uploadedBy === 'USR-UPLOADER'));
  });

  test('auditor dapat membaca audit dan laporan, tetapi tidak mengubah data', async () => {
    const auditor = await loginAs('auditor@demo.local');
    assert.equal((await auditor.get('/api/audit?pageSize=5')).status, 200);
    assert.equal((await auditor.get('/api/reports/production-summary')).status, 200);
    assert.equal((await auditor.get('/api/admin/users')).status, 403);
    assert.equal((await auditor.post('/api/production/PRD-0001/cancel', { reason: 'test' })).status, 403);
  });

  test('claims dapat ekspor claim tetapi tidak melihat laporan produksi', async () => {
    const claims = await loginAs('claims@demo.local');
    const exportResult = await claims.get('/api/claims/export');
    assert.equal(exportResult.status, 200);
    assert.match(String(exportResult.headers.get('content-type')), /text\/csv/);
    assert.equal((await claims.get('/api/reports/production-summary')).status, 403);
    assert.equal((await claims.get('/api/reports/settled-claims')).status, 200);
  });

  test('finance dapat mengelola kurs dan rules, tetapi bukan pengguna', async () => {
    const finance = await loginAs('finance@demo.local');
    assert.equal((await finance.get('/api/admin/exchange-rates')).status, 200);
    assert.equal((await finance.get('/api/admin/business-rules')).status, 200);
    assert.equal((await finance.get('/api/admin/users')).status, 403);
    assert.equal((await finance.get('/api/admin/hash-configs')).status, 403);
  });

  test('data operations dapat master data tetapi tidak mengelola pengguna', async () => {
    const ops = await loginAs('ops@demo.local');
    assert.equal((await ops.get('/api/admin/branches')).status, 200);
    assert.equal((await ops.get('/api/admin/users')).status, 403);
  });
});

describe('Kontrak API & validasi', () => {
  test('dashboard mengembalikan KPI dan agregat per currency', async () => {
    const admin = await loginAs('admin@demo.local');
    const dashboard = data(await admin.get('/api/dashboard'));
    assert.ok(dashboard.kpis);
    assert.ok(Array.isArray(dashboard.premiumByCurrency));
    assert.ok(dashboard.premiumByCurrency.every((row) => row.currency));
    assert.ok(Array.isArray(dashboard.recentBatches));
  });

  test('dateBasis tidak valid untuk laporan ditolak 400', async () => {
    const admin = await loginAs('admin@demo.local');
    const result = await admin.get('/api/reports/production-summary?dateBasis=SETTLEMENT_DATE');
    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, 'VALIDATION_ERROR');
    assert.ok(result.body.error.details.length >= 1);
  });

  test('net claims cost tidak dihitung tanpa formula aktif', async () => {
    const admin = await loginAs('admin@demo.local');
    const result = data(await admin.get('/api/reports/net-claims-cost'));
    assert.equal(result.available, false);
    assert.ok(result.message);
  });

  test('meta laporan memuat 10 laporan dan master filter', async () => {
    const admin = await loginAs('admin@demo.local');
    const meta = data(await admin.get('/api/reports/meta'));
    assert.equal(meta.reports.length, 10);
    assert.ok(meta.masters.branches.length >= 1);
    assert.ok(meta.masters.currencies.some((row) => row.code === 'USD'));
    assert.equal(meta.netClaimFormula.available, false);
  });

  test('upload ekstensi tidak didukung ditolak UPLOAD_INVALID', async () => {
    const admin = await loginAs('admin@demo.local');
    const result = await admin.upload('PRODUCTION', 'a,b\n1,2\n', 'data.txt');
    assert.equal(result.status, 422);
    assert.equal(result.body.error.code, 'UPLOAD_INVALID');
  });

  test('jenis upload tidak dikenal ditolak 400/422 dengan pesan jelas', async () => {
    const admin = await loginAs('admin@demo.local');
    const result = await admin.upload('UNKNOWN', 'a,b\n1,2\n', 'data.csv');
    assert.ok([400, 422].includes(result.status));
    assert.equal(result.body.ok, false);
    assert.ok(result.body.error.message);
  });

  test('endpoint API tidak dikenal mengembalikan 404 JSON', async () => {
    const admin = await loginAs('admin@demo.local');
    const result = await admin.get('/api/tidak-ada');
    assert.equal(result.status, 404);
    assert.equal(result.body.error.code, 'NOT_FOUND');
  });

  test('administrasi: roles, users, master, aturan, hash config', async () => {
    const admin = await loginAs('admin@demo.local');
    assert.equal(data(await admin.get('/api/admin/roles')).roles.length, 7);
    assert.equal(data(await admin.get('/api/admin/business-rules')).rules.length, 11);
    assert.ok(data(await admin.get('/api/admin/hash-configs')).configs.length >= 3);
    assert.ok(data(await admin.get('/api/admin/products')).rows.length >= 1);
    assert.ok(data(await admin.get('/api/admin/mappings?pageSize=5')).rows.length >= 0);
  });

  test('pagination dibatasi dan bentuk respons konsisten', async () => {
    const admin = await loginAs('admin@demo.local');
    const result = data(await admin.get('/api/uploads?page=1&pageSize=2'));
    assert.equal(result.page, 1);
    assert.equal(result.pageSize, 2);
    assert.ok(result.rows.length <= 2);
    assert.ok(result.total >= result.rows.length);
    assert.ok(result.totalPages >= 1);
  });
});

describe('Aset SPA', () => {
  const assets = [
    '/', '/css/app.css', '/js/app.js', '/js/api.js', '/js/ui.js',
    '/js/pages/dashboard.js', '/js/pages/uploads.js', '/js/pages/agents.js',
    '/js/pages/production.js', '/js/pages/claim.js', '/js/pages/reports.js',
    '/js/pages/audit.js', '/js/pages/admin.js',
  ];

  test('semua modul halaman dan aset statis tersedia', async () => {
    const anonymous = new Client(base);
    for (const asset of assets) {
      const result = await anonymous.get(asset);
      assert.equal(result.status, 200, `aset ${asset} harus tersedia`);
      assert.ok(result.body && String(result.body).length > 0);
    }
    const index = await anonymous.get('/');
    assert.match(String(index.body), /NextMitracaReport/);
  });

  test('rute hash SPA jatuh ke index.html', async () => {
    const anonymous = new Client(base);
    const result = await anonymous.get('/uploads/UPL-0001');
    assert.equal(result.status, 200);
    assert.match(String(result.body), /id="app"/);
  });
});
