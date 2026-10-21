'use strict';
/**
 * Smoke test render halaman SPA di DOM (jsdom) terhadap API nyata.
 * Tujuannya menangkap error runtime (referensi salah, field hilang) yang tidak
 * terlihat dari pengecekan statis.
 */
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { JSDOM } = require('jsdom');
const { setupEnv, startServer, stopServer, Client, data } = require('./helpers');

const env = setupEnv();
const { seed } = require('../db/seed');

let server;
let base;
let dom;
let cookie;
let modules;
let user;

const PUBLIC_JS = path.join(__dirname, '..', 'public', 'js');

before(async () => {
  seed();
  ({ server, base } = await startServer());

  const client = new Client(base);
  const login = await client.login('admin@demo.local');
  assert.equal(login.status, 200);
  cookie = client.cookie;
  user = data(login).user;

  dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
    url: `${base}/`,
    pretendToBeVisual: true,
  });
  global.window = dom.window;
  global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;
  global.Event = dom.window.Event;
  global.CustomEvent = dom.window.CustomEvent;
  // jsdom's FormData understands <form>; Node's does not.
  global.FormData = dom.window.FormData;

  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (input, init = {}) => {
    const url = typeof input === 'string' && input.startsWith('/') ? `${base}${input}` : input;
    const headers = { ...(init.headers || {}), Cookie: cookie };
    return nativeFetch(url, { ...init, headers });
  };

  // Modul halaman adalah ES module; salin ke direktori sementara bertipe module.
  const dir = path.join(env.dir, 'ui-modules');
  fs.cpSync(PUBLIC_JS, dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  modules = {};
  for (const page of ['dashboard', 'uploads', 'agents', 'production', 'claim', 'reports', 'audit', 'admin']) {
    modules[page] = await import(pathToFileURL(path.join(dir, 'pages', `${page}.js`)).href);
  }
});

after(async () => {
  delete globalThis.fetch;
  if (dom) dom.window.close();
  await stopServer(server, env.dir);
});

function context(params = [], query = {}) {
  return {
    params,
    query,
    state: { user, permissions: new Set([
      'upload.create', 'upload.view.all', 'upload.approve', 'upload.post', 'upload.cancel',
      'agent.write', 'production.write', 'claim.write',
      'report.view', 'report.financial', 'report.claim', 'report.production',
      'export.claim', 'audit.view', 'admin.users', 'admin.master', 'admin.rules', 'admin.hash',
    ]) },
    can: () => true,
    navigate: () => {},
    shell: (content) => content,
    setTitle: () => {},
    reload: () => {},
  };
}

async function renderPage(name, params = [], query = {}) {
  const el = document.getElementById('app');
  el.innerHTML = '';
  await modules[name].render(el, context(params, query));
  const html = el.innerHTML;
  assert.ok(html.length > 100, `halaman ${name} harus menghasilkan markup`);
  assert.ok(!/Halaman gagal dimuat|tidak dapat dimuat|gagal dimuat/i.test(html),
    `halaman ${name} tidak boleh menampilkan galat: ${html.slice(0, 200)}`);
  assert.ok(!html.includes('undefined</'), `halaman ${name} tidak boleh mencetak undefined`);
  return html;
}

describe('Render halaman SPA', () => {
  test('dashboard', async () => {
    const html = await renderPage('dashboard');
    assert.match(html, /Ringkasan operasional/);
  });

  test('daftar dan detail upload', async () => {
    const list = await renderPage('uploads');
    assert.match(list, /Upload Data/);
    const detail = await renderPage('uploads', ['UPL-0005']);
    assert.match(detail, /UPL-0005/);
  });

  test('master agent: daftar dan detail', async () => {
    const list = await renderPage('agents');
    assert.match(list, /Master Agent/);
    const detail = await renderPage('agents', ['AGT-0001']);
    assert.match(detail, /Histori versi/);
  });

  test('produksi: daftar, posisi, dan detail', async () => {
    const list = await renderPage('production');
    assert.match(list, /Basis: seluruh transaksi produksi/);
    const positions = await renderPage('production', [], { positions: '1' });
    assert.match(positions, /posisi terkini/);
    const detail = await renderPage('production', ['PRD-0001']);
    assert.match(detail, /Riwayat versi/);
  });

  test('claim: daftar dan detail multi-settlement', async () => {
    const list = await renderPage('claim');
    assert.match(list, /Claim &amp; Settlement/);
    const detail = await renderPage('claim', ['CLM-0001']);
    assert.match(detail, /Settlement/);
    assert.match(detail, /STL-0001|SET-0001/);
  });

  test('laporan: seluruh tab dapat dimuat', async () => {
    const keys = ['production-summary', 'policy-positions', 'production-by-agent',
      'production-by-branch', 'settled-claims', 'claims-by-policy', 'claims-by-uw-year',
      'cause-of-loss', 'recovery', 'upload-audit'];
    for (const key of keys) {
      const html = await renderPage('reports', [], { report: key });
      assert.match(html, /Basis:/, `laporan ${key} harus menampilkan basis`);
    }
  });

  test('audit trail', async () => {
    const html = await renderPage('audit');
    assert.match(html, /Traceability record/);
    assert.match(html, /UPL-|PRODUCTION|AGENT/);
  });

  test('pengaturan: tab pengguna dan master data', async () => {
    const users = await renderPage('admin', [], { tab: 'users' });
    assert.match(users, /Pengguna/);
    assert.match(users, /Role &amp; permission/);
    const master = await renderPage('admin', [], { tab: 'master' });
    assert.match(master, /Cabang|Produk/);
    const rules = await renderPage('admin', [], { tab: 'rules' });
    assert.match(rules, /Business rules/);
    const rates = await renderPage('admin', [], { tab: 'rates' });
    assert.match(rates, /Tabel kurs resmi/);
    const hash = await renderPage('admin', [], { tab: 'hash' });
    assert.match(hash, /Konfigurasi hash/);
  });
});
