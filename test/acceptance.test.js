'use strict';
/**
 * Uji kriteria penerimaan spesifikasi v1.0 (end-to-end lewat HTTP API).
 * Setiap file test memakai database sementara sendiri.
 */
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  setupEnv, startServer, stopServer, Client, csv, data,
  PRODUCTION_HEADERS, CLAIM_HEADERS, productionRow, claimRow,
} = require('./helpers');

const env = setupEnv();
const { seed } = require('../db/seed');

let server;
let base;
let client;

before(async () => {
  seed();
  ({ server, base } = await startServer());
  client = new Client(base);
  const login = await client.login('admin@demo.local');
  assert.equal(login.status, 200, 'login admin harus berhasil');
});

after(async () => {
  await stopServer(server, env.dir);
});

async function uploadValidatePost(uploadType, content, filename, extra = {}) {
  const uploaded = await client.upload(uploadType, content, filename, extra);
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
  const batchId = data(uploaded).batch.uploadBatchId;
  const validated = await client.post(`/api/uploads/${batchId}/validate`);
  assert.equal(validated.status, 200, JSON.stringify(validated.body));
  return { batchId, validated: data(validated) };
}

async function approveAndPost(batchId) {
  const approved = await client.post(`/api/uploads/${batchId}/approve`, { remarks: 'OK acceptance' });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  const posted = await client.post(`/api/uploads/${batchId}/post`, {});
  assert.equal(posted.status, 200, JSON.stringify(posted.body));
  return data(posted);
}

describe('Kriteria 1–4: dedup isi data, nama file sama, dan versioning', () => {
  let firstBatchId;

  test('upload pertama: dua baris New, lalu approve dan posting', async () => {
    const content = csv(PRODUCTION_HEADERS, [
      productionRow(),
      productionRow({
        PolicyNo: 'POL-T-2026-0002', PolicyRiskID: 'RISK-B', Premium: '2000000',
        VehicleOrRiskDescription: 'Kendaraan uji kedua',
      }),
    ]);
    const result = await uploadValidatePost('PRODUCTION', content, 'produksi-uji.csv');
    firstBatchId = result.batchId;
    assert.equal(result.validated.summary.totalRows, 2);
    assert.equal(result.validated.summary.newRows, 2);
    assert.equal(result.validated.summary.duplicateRows, 0);
    assert.equal(result.validated.batch.processingStatus, 'Ready for Review');

    const posted = await approveAndPost(firstBatchId);
    assert.equal(posted.batch.processingStatus, 'Posted');
    assert.equal(posted.summary.postedRows, 2);
  });

  test('re-upload isi identik dengan nama file sama: semua Duplicate, tidak ada record baru', async () => {
    const content = csv(PRODUCTION_HEADERS, [
      productionRow(),
      productionRow({
        PolicyNo: 'POL-T-2026-0002', PolicyRiskID: 'RISK-B', Premium: '2000000',
        VehicleOrRiskDescription: 'Kendaraan uji kedua',
      }),
    ]);
    const result = await uploadValidatePost('PRODUCTION', content, 'produksi-uji.csv');
    assert.equal(result.validated.summary.newRows, 0);
    assert.equal(result.validated.summary.duplicateRows, 2);
    assert.equal(result.validated.summary.postedRows, 0);

    const detail = data(await client.get(`/api/uploads/${result.batchId}`));
    assert.ok(detail.duplicateFiles.length >= 1, 'file dengan hash identik harus terdeteksi sebagai duplikat file');
    assert.equal(detail.duplicateFiles[0].originalFileName, 'produksi-uji.csv');

    const rows = data(await client.get(`/api/uploads/${result.batchId}/rows?pageSize=50`));
    assert.ok(rows.rows.every((row) => row.validationStatus === 'Duplicate'));
  });

  test('nama file sama dengan isi berbeda: baris diklasifikasi per isi (Duplicate/Changed/New), bukan per file', async () => {
    const content = csv(PRODUCTION_HEADERS, [
      productionRow(),
      productionRow({ Premium: '1500000', VehicleOrRiskDescription: 'Penyesuaian premi' }),
      productionRow({
        PolicyNo: 'POL-T-2026-0003', PolicyRiskID: 'RISK-C', Premium: '3000000',
        VehicleOrRiskDescription: 'Polis baru',
      }),
    ]);
    const result = await uploadValidatePost('PRODUCTION', content, 'produksi-uji.csv');
    assert.equal(result.validated.summary.totalRows, 3);
    assert.equal(result.validated.summary.duplicateRows, 1);
    assert.equal(result.validated.summary.changedRows, 1);
    assert.equal(result.validated.summary.newRows, 1);

    const rows = data(await client.get(`/api/uploads/${result.batchId}/rows?pageSize=50`));
    const statuses = rows.rows.map((row) => row.validationStatus);
    assert.deepEqual(statuses, ['Duplicate', 'Changed', 'New']);

    const postedBatchId = result.batchId;
    const posted = await approveAndPost(postedBatchId);
    assert.equal(posted.summary.postedRows, 2, 'Changed dan New yang diposting, Duplicate tidak');
  });

  test('perubahan premi menghasilkan versi 2 dan versi lama tidak lagi current', async () => {
    const current = data(await client.get('/api/production?policyNo=POL-T-2026-0001&isCurrent=1'));
    assert.equal(current.total, 1);
    const v2 = current.rows[0];
    assert.equal(v2.versionNo, 2);
    assert.equal(v2.premium, 1500000);
    assert.equal(v2.isCurrent, true);

    const all = data(await client.get('/api/production?policyNo=POL-T-2026-0001&pageSize=50'));
    assert.equal(all.total, 2);
    const v1 = all.rows.find((row) => row.versionNo === 1);
    assert.equal(v1.isCurrent, false);
    assert.equal(v1.premium, 1000000);
    assert.equal(v2.previousRecordId, v1.productionId);

    const detail = data(await client.get(`/api/production/${v2.productionId}`));
    assert.equal(detail.versions.length, 2);
  });
});

describe('Kriteria 8: agent belum termapping', () => {
  test('baris dengan kode agen baru menjadi Pending Mapping dan dapat di-resolve', async () => {
    const content = csv(PRODUCTION_HEADERS, [
      productionRow({
        PolicyNo: 'POL-T-2026-0004', PolicyRiskID: 'RISK-D', KodeAgen: 'AGT-BARU-900',
        Premium: '4000000',
      }),
    ]);
    const { batchId, validated } = await uploadValidatePost('PRODUCTION', content, 'produksi-agent-baru.csv');
    assert.equal(validated.summary.pendingMappingRows, 1);
    assert.equal(validated.summary.rejectedRows, 0);

    const rows = data(await client.get(`/api/uploads/${batchId}/rows?pageSize=20`));
    assert.equal(rows.rows[0].validationStatus, 'Pending Mapping');

    const pending = data(await client.get('/api/agents/pending-mapping'));
    assert.ok(pending.rows.some((row) => row.kodeagen === 'AGT-BARU-900'));

    const resolved = await client.post('/api/agents/resolve-mapping', {
      kodeagen: 'AGT-BARU-900',
      action: 'CREATE',
      namaAgent: 'Agen Baru Acceptance',
      branchCode: 'JKT',
    });
    assert.equal(resolved.status, 200, JSON.stringify(resolved.body));
    assert.ok(data(resolved).affectedRows >= 1);
    assert.equal(data(resolved).agent.kodeagen, 'AGT-BARU-900');

    const afterRows = data(await client.get(`/api/uploads/${batchId}/rows?pageSize=20`));
    assert.notEqual(afterRows.rows[0].validationStatus, 'Pending Mapping');
  });
});

describe('Kriteria 9–10: validasi wajib claim', () => {
  test('claim tanpa Claim No dan settlement tanpa tanggal ditolak', async () => {
    const content = csv(CLAIM_HEADERS, [
      claimRow({ ClaimNo: '' }),
      claimRow({ ClaimNo: 'CLM-T-2026-0009', SettlementNo: 'SET-T-9', SettlementDate: '' }),
    ]);
    const result = await uploadValidatePost('CLAIM', content, 'claim-tidak-valid.csv');
    assert.equal(result.validated.summary.totalRows, 2);
    assert.equal(result.validated.summary.rejectedRows, 2);
    assert.equal(result.validated.summary.postedRows, 0);

    const rows = data(await client.get(`/api/uploads/${result.batchId}/rows?pageSize=20`));
    const missingClaimNo = rows.rows.find((row) => row.sourceRowNumber === 2);
    const missingDate = rows.rows.find((row) => row.sourceRowNumber === 3);
    assert.equal(missingClaimNo.validationStatus, 'Rejected');
    assert.match(String(missingClaimNo.validationMessage), /claim/i);
    assert.equal(missingDate.validationStatus, 'Rejected');
    assert.match(String(missingDate.validationMessage), /tanggal|date|settlement/i);
  });
});

describe('Kriteria 5–7, 11–12: claim, settlement, dan basis laporan', () => {
  test('satu polis memiliki tiga claim (COUNT DISTINCT, bukan claim terakhir)', async () => {
    const report = data(await client.get('/api/reports/claims-by-policy?from=2026-01-01&to=2026-12-31'));
    const row = report.rows.find((entry) => entry.policyNo === 'POL-2026-0001');
    assert.ok(row, 'POL-2026-0001 harus muncul');
    assert.equal(row.claimCount, 3);
    assert.equal(row.currency, 'IDR');
  });

  test('satu claim memiliki dua settlement aktif', async () => {
    const detail = data(await client.get('/api/claims/CLM-0001'));
    assert.equal(detail.claim.settlementCount, 2);
    assert.equal(detail.settlements.filter((row) => row.recordStatus === 'Active').length, 2);
  });

  test('laporan Claim Settled memakai Date Of Settlement', async () => {
    const report = data(await client.get('/api/reports/settled-claims?from=2026-04-01&to=2026-04-30'));
    assert.equal(report.basisLabel, 'Date Of Settlement');
    assert.ok(report.rows.length >= 1);
    for (const row of report.rows) {
      assert.ok(row.dateOfSettlement >= '2026-04-01' && row.dateOfSettlement <= '2026-04-30');
    }
    const april = report.rows.find((row) => row.claimNo === 'CLM-2026-0001');
    assert.ok(april, 'settlement April untuk CLM-2026-0001 harus masuk');
    assert.equal(april.dateOfSettlement, '2026-04-02');

    const june = data(await client.get('/api/reports/settled-claims?from=2026-06-01&to=2026-06-30'));
    assert.ok(june.rows.some((row) => row.dateOfSettlement === '2026-06-15'));
    assert.ok(!june.rows.some((row) => row.dateOfSettlement === '2026-04-02'));
  });

  test('laporan per UW Year memakai UW Year claim, termasuk tahun 2025', async () => {
    const report = data(await client.get('/api/reports/claims-by-uw-year?from=2026-01-01&to=2026-12-31'));
    const row = report.rows.find((entry) => Number(entry.uwYear) === 2025);
    assert.ok(row, 'claim UW 2025 harus muncul di laporan UW Year');
    assert.equal(Number(row.claimCount), 1);
  });

  test('nominal IDR dan USD dipisahkan per currency, tidak dijumlahkan', async () => {
    const report = data(await client.get('/api/reports/production-summary?from=2026-01-01&to=2026-12-31'));
    assert.equal(report.currencyMode, 'BY_CURRENCY');
    const currencies = report.totals.map((entry) => entry.currency).sort();
    assert.deepEqual(currencies, ['IDR', 'USD']);
    for (const total of report.totals) {
      assert.ok(Number.isFinite(total.premium));
      assert.notEqual(total.currency, 'UNKNOWN');
    }
    const idr = report.totals.find((entry) => entry.currency === 'IDR');
    const usd = report.totals.find((entry) => entry.currency === 'USD');
    assert.notEqual(idr.premium, usd.premium);
  });

  test('konversi memakai tabel kurs resmi dan menandai mode CONVERTED', async () => {
    const params = new URLSearchParams({ from: '2026-01-01', to: '2026-12-31', convertTo: 'IDR', rateType: 'MID' });
    const report = data(await client.get(`/api/reports/production-summary?${params}`));
    assert.equal(report.currencyMode, 'CONVERTED');
    assert.ok(report.conversion);
    assert.equal(report.conversion.toCurrency, 'IDR');
    const usdRate = report.conversion.rates.find((rate) => rate.fromCurrency === 'USD');
    assert.ok(usdRate, 'kurs USD->IDR harus tersedia');
    assert.equal(usdRate.rate, 16250);
  });
});

describe('Kriteria 13: traceability dan audit', () => {
  test('record produksi dapat ditelusuri ke batch dan baris sumber', async () => {
    const current = data(await client.get('/api/production?policyNo=POL-T-2026-0001&isCurrent=1'));
    const record = current.rows[0];
    const trace = data(await client.get(`/api/audit/trace?recordType=PRODUCTION&recordId=${encodeURIComponent(record.productionId)}`));
    assert.equal(trace.recordType, 'PRODUCTION');
    assert.ok(trace.batch);
    assert.ok(trace.uploadRow);
    assert.ok(trace.uploadRow.sourceRowNumber >= 2);
    assert.equal(trace.uploadRow.sourceRowHash, record.sourceRowHash);
    assert.ok(trace.batch.uploadBatchId.startsWith('UPL-'));
  });

  test('audit upload memuat counter batch yang dapat direkonsiliasi dengan detail batch', async () => {
    const report = data(await client.get('/api/reports/upload-audit'));
    const batches = data(await client.get('/api/uploads?pageSize=200'));
    assert.equal(report.rows.length, batches.total);
    for (const row of report.rows.slice(0, 5)) {
      const batch = batches.rows.find((entry) => entry.uploadBatchId === row.uploadBatchId);
      assert.ok(batch);
      assert.equal(row.totalRows, batch.totalRows);
      assert.equal(row.postedRows, batch.postedRows);
    }
  });

  test('audit trail mencatat posting dan perubahan versi', async () => {
    const audit = data(await client.get('/api/audit?entityType=PRODUCTION&pageSize=100'));
    assert.ok(audit.total >= 1);
    assert.ok(audit.rows.some((entry) => entry.action === 'POST'));
    assert.ok(audit.rows.every((entry) => entry.occurredAt));
  });
});

describe('Transisi status batch', () => {
  test('posting tanpa approval ditolak', async () => {
    const content = csv(PRODUCTION_HEADERS, [
      productionRow({ PolicyNo: 'POL-T-2026-0100', PolicyRiskID: 'RISK-X', Premium: '1234567' }),
    ]);
    const { batchId } = await uploadValidatePost('PRODUCTION', content, 'produksi-belum-approve.csv');
    const result = await client.post(`/api/uploads/${batchId}/post`, {});
    assert.equal(result.status, 409);
    assert.equal(result.body.error.code, 'INVALID_STATE');

    const cancelled = await client.post(`/api/uploads/${batchId}/cancel`, { reason: 'Bersih-bersih test' });
    assert.equal(cancelled.status, 200);
    assert.equal(data(cancelled).batch.processingStatus, 'Cancelled');
  });
});
