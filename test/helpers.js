'use strict';
/** Helper test: DB sementara, server pada port acak, dan klien HTTP dengan cookie sesi. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function setupEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-test-'));
  process.env.NODE_ENV = 'test';
  process.env.DB_PATH = path.join(dir, 'test.db');
  process.env.UPLOAD_DIR = path.join(dir, 'uploads');
  return { dir };
}

async function startServer() {
  const { createApp } = require('../src/server/app');
  const app = createApp();
  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    instance.on('error', reject);
  });
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

async function stopServer(server, dir) {
  if (server) await new Promise((resolve) => server.close(resolve));
  const { closeDb } = require('../db/database');
  closeDb();
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
}

class Client {
  constructor(base) {
    this.base = base;
    this.cookie = '';
    this.user = null;
  }

  async request(endpoint, { method = 'GET', body } = {}) {
    const headers = { Accept: 'application/json' };
    if (this.cookie) headers.Cookie = this.cookie;
    let payload;
    if (body instanceof FormData) {
      payload = body;
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }

    const response = await fetch(`${this.base}${endpoint}`, { method, headers, body: payload });
    const setCookies = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie')].filter(Boolean);
    for (const cookie of setCookies) {
      if (cookie.startsWith('sid=')) this.cookie = cookie.split(';')[0];
    }

    const contentType = response.headers.get('content-type') || '';
    let data = null;
    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }
    return { status: response.status, body: data, headers: response.headers };
  }

  async login(email, password = 'Demo#2026') {
    const result = await this.request('/api/auth/login', { method: 'POST', body: { email, password } });
    if (result.status === 200) this.user = result.body.data.user;
    return result;
  }

  get(endpoint) { return this.request(endpoint); }

  post(endpoint, body = {}) { return this.request(endpoint, { method: 'POST', body }); }

  patch(endpoint, body = {}) { return this.request(endpoint, { method: 'PATCH', body }); }

  async upload(uploadType, csv, filename = 'upload.csv', extra = {}) {
    const form = new FormData();
    form.append('file', new Blob([csv], { type: 'text/csv' }), filename);
    form.append('uploadType', uploadType);
    for (const [key, value] of Object.entries(extra)) form.append(key, value);
    return this.request('/api/uploads', { method: 'POST', body: form });
  }
}

function csv(headers, rows) {
  const escape = (value) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [headers, ...rows].map((row) => row.map(escape).join(',')).join('\n');
}

const PRODUCTION_HEADERS = [
  'PolicyNo', 'PolicyRiskID', 'TransactionDate', 'EffectiveDate', 'ExpiryDate',
  'TransactionType', 'Product', 'Coverage', 'VehicleOrRiskDescription',
  'TSI', 'Premium', 'Currency', 'KodeAgen', 'Cabang',
];

const CLAIM_HEADERS = [
  'ClaimNo', 'PolicyNo', 'SettlementNo', 'SettlementDate', 'GrossClaim', 'Indemnity',
  'Deductible', 'Salvage', 'Subrogation', 'Currency', 'KodeAgen', 'Cabang', 'UWYear',
  'ProductAtLoss', 'CoverageAtLoss', 'TSIAtLoss', 'CauseOfLoss', 'LossDate', 'ClaimStatus',
];

function productionRow(overrides = {}) {
  const row = {
    PolicyNo: 'POL-T-2026-0001',
    PolicyRiskID: 'RISK-A',
    TransactionDate: '2026-02-10',
    EffectiveDate: '2026-03-01',
    ExpiryDate: '2027-03-01',
    TransactionType: 'New Business',
    Product: 'MOTOR',
    Coverage: 'COMP',
    VehicleOrRiskDescription: 'Kendaraan uji acceptance',
    TSI: '100000000',
    Premium: '1000000',
    Currency: 'IDR',
    KodeAgen: 'AGT001',
    Cabang: 'JKT',
    ...overrides,
  };
  return Object.values(row);
}

function claimRow(overrides = {}) {
  const row = {
    ClaimNo: 'CLM-T-2026-0001',
    PolicyNo: 'POL-T-2026-0001',
    SettlementNo: 'SET-T-1',
    SettlementDate: '2026-04-02',
    GrossClaim: '1000000',
    Indemnity: '900000',
    Deductible: '100000',
    Salvage: '0',
    Subrogation: '0',
    Currency: 'IDR',
    KodeAgen: 'AGT001',
    Cabang: 'JKT',
    UWYear: '2026',
    ProductAtLoss: 'MOTOR',
    CoverageAtLoss: 'COMP',
    TSIAtLoss: '100000000',
    CauseOfLoss: 'COLLISION',
    LossDate: '2026-03-11',
    ClaimStatus: 'Settled',
    ...overrides,
  };
  return Object.values(row);
}

function data(result) {
  return result.body && result.body.data !== undefined ? result.body.data : null;
}

module.exports = {
  setupEnv,
  startServer,
  stopServer,
  Client,
  csv,
  data,
  PRODUCTION_HEADERS,
  CLAIM_HEADERS,
  productionRow,
  claimRow,
};
