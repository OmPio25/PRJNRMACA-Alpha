import { api } from '../api.js';
import * as ui from '../ui.js';

const DATE_BASIS_LABEL = {
  EFFECTIVE_DATE: 'Effective Date',
  TRANSACTION_DATE: 'Transaction Date',
  SETTLEMENT_DATE: 'Date Of Settlement',
  UPLOADED_AT: 'Uploaded At',
};

const GROUP_BY_LABEL = {
  transactionType: 'Transaction Type',
  branch: 'Branch',
  product: 'Product',
  coverage: 'Coverage',
  currency: 'Currency',
  agent: 'Agent',
};

export async function render(el, ctx) {
  el.innerHTML = ctx.shell(ui.loadingTable(6), { title: 'Laporan', subtitle: 'Laporan produksi dan claim' });

  let meta;
  try {
    meta = await api.reportMeta();
  } catch (error) {
    el.innerHTML = ctx.shell(`<div class="card"><div class="empty">
      <div class="empty-title">Laporan tidak dapat dimuat</div>
      <div class="empty-desc">${ui.esc(error.message)}</div></div></div>`, { title: 'Laporan' });
    return;
  }

  const reports = meta.reports;
  const activeKey = reports.some((r) => r.reportKey === ctx.query.report)
    ? ctx.query.report
    : reports[0].reportKey;
  const active = reports.find((r) => r.reportKey === activeKey);

  const tabs = reports.map((report) =>
    `<button class="report-tab" role="tab" data-report="${ui.esc(report.reportKey)}"
      aria-selected="${report.reportKey === activeKey}">${ui.esc(report.title)}</button>`).join('');

  const content = `
    <div class="page-head">
      <div>
        <h1 class="page-title">Laporan</h1>
        <p class="page-desc">Setiap laporan mencetak basis perhitungan, periode, dan currency. Nominal IDR
          dan USD dipisahkan; konversi memakai tabel kurs resmi dan tidak mengubah data sumber.</p>
      </div>
      <div class="page-actions" id="report-actions"></div>
    </div>

    ${meta.netClaimFormula && !meta.netClaimFormula.available
      ? `<div style="margin-bottom:16px">${ui.banner(meta.netClaimFormula.message, 'info', { title: 'Net Claims Cost belum tersedia' })}</div>`
      : ''}

    <section class="card">
      <div class="report-tabs" role="tablist" aria-label="Daftar laporan">${tabs}</div>
      <form class="filters" id="report-filter" style="border-bottom:1px solid var(--border)">
        <div class="field"><label class="label" for="f-from">Dari</label>
          <input class="input" type="date" id="f-from" name="from" /></div>
        <div class="field"><label class="label" for="f-to">Sampai</label>
          <input class="input" type="date" id="f-to" name="to" /></div>
        <div class="field"><label class="label" for="f-basis">Basis tanggal</label>
          <select class="select" id="f-basis" name="dateBasis">
            ${active.dateBases.map((basis) => `<option value="${basis}">${DATE_BASIS_LABEL[basis] || basis}</option>`).join('')}
          </select></div>
        <div class="field" id="groupby-field" style="${active.groupByOptions.length ? '' : 'display:none'}">
          <label class="label" for="f-group">Group by</label>
          <select class="select" id="f-group" name="groupBy">
            <option value="">Default</option>
            ${active.groupByOptions.map((group) => `<option value="${group}">${GROUP_BY_LABEL[group] || group}</option>`).join('')}
          </select></div>
        <div class="field"><label class="label" for="f-branch">Cabang</label>
          <select class="select" id="f-branch" name="branch">
            <option value="">Semua</option>
            ${meta.masters.branches.map((row) => `<option value="${ui.esc(row.code)}">${ui.esc(row.code)} — ${ui.esc(row.name)}</option>`).join('')}
          </select></div>
        <div class="field"><label class="label" for="f-product">Produk</label>
          <select class="select" id="f-product" name="product">
            <option value="">Semua</option>
            ${meta.masters.products.map((row) => `<option value="${ui.esc(row.code)}">${ui.esc(row.code)}</option>`).join('')}
          </select></div>
        <div class="field"><label class="label" for="f-coverage">Coverage</label>
          <select class="select" id="f-coverage" name="coverage">
            <option value="">Semua</option>
            ${meta.masters.coverages.map((row) => `<option value="${ui.esc(row.code)}">${ui.esc(row.code)}</option>`).join('')}
          </select></div>
        <div class="field"><label class="label" for="f-currency">Currency</label>
          <select class="select" id="f-currency" name="currency">
            <option value="">Semua</option>
            ${meta.masters.currencies.map((row) => `<option value="${ui.esc(row.code)}">${ui.esc(row.code)}</option>`).join('')}
          </select></div>
        <div class="field"><label class="label" for="f-cause">Cause of loss</label>
          <select class="select" id="f-cause" name="causeOfLoss">
            <option value="">Semua</option>
            ${meta.masters.causesOfLoss.map((row) => `<option value="${ui.esc(row.code)}">${ui.esc(row.code)}</option>`).join('')}
          </select></div>
        <div class="field"><label class="label" for="f-tx">Jenis transaksi</label>
          <select class="select" id="f-tx" name="transactionType">
            <option value="">Semua</option>
            <option>New Business</option><option>Renewal</option><option>Endorsement</option><option>Cancellation</option>
          </select></div>
        <div class="field"><label class="label" for="f-convert">Konversi ke</label>
          <select class="select" id="f-convert" name="convertTo">
            <option value="">Tanpa konversi</option>
            ${meta.masters.currencies.map((row) => `<option value="${ui.esc(row.code)}">${ui.esc(row.code)}</option>`).join('')}
          </select></div>
        <div class="field"><label class="label" for="f-rate">Jenis kurs</label>
          <select class="select" id="f-rate" name="rateType">
            <option value="MID">MID</option><option value="BUY">BUY</option><option value="SELL">SELL</option>
          </select></div>
        <button class="btn btn-secondary" type="submit">Tampilkan</button>
        <button class="btn btn-ghost" type="reset">Reset</button>
      </form>
      <div id="report-output">${ui.loadingTable(6)}</div>
    </section>`;

  el.innerHTML = ctx.shell(content, { title: 'Laporan', subtitle: active.title });

  const form = document.getElementById('report-filter');
  for (const key of ['from', 'to', 'dateBasis', 'groupBy', 'branch', 'product', 'coverage', 'currency', 'causeOfLoss', 'transactionType', 'convertTo', 'rateType']) {
    if (ctx.query[key]) {
      const field = form.querySelector(`[name="${key}"]`);
      if (field) field.value = ctx.query[key];
    }
  }

  const output = document.getElementById('report-output');
  const actions = document.getElementById('report-actions');
  const currentParams = () => {
    const values = ui.serializeForm(form);
    const params = {};
    for (const [key, value] of Object.entries(values)) {
      if (value && !(key === 'groupBy' && !active.groupByOptions.length)) params[key] = value;
    }
    return params;
  };

  const run = async () => {
    output.innerHTML = ui.loadingTable(6);
    try {
      const report = await api.report(activeKey, currentParams());
      actions.innerHTML = `<a class="btn btn-secondary" href="${api.reportCsvUrl(activeKey, currentParams())}">Unduh CSV</a>`;
      output.innerHTML = renderReport(report);
    } catch (error) {
      actions.innerHTML = '';
      output.innerHTML = `<div style="padding:16px">${ui.banner(error.message, 'danger')}</div>`;
    }
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    run();
  });
  form.addEventListener('reset', () => {
    setTimeout(() => {
      const hash = `#/reports?report=${encodeURIComponent(activeKey)}`;
      if (window.location.hash === hash) run();
      else window.location.hash = hash;
    }, 0);
  });

  document.querySelectorAll('[data-report]').forEach((tab) => {
    tab.addEventListener('click', () => {
      const next = tab.getAttribute('data-report');
      if (next === activeKey) return;
      window.location.hash = `#/reports?report=${encodeURIComponent(next)}`;
    });
  });

  await run();
}

function renderReport(report) {
  if (!report) return ui.emptyState({ title: 'Laporan kosong', desc: 'Tidak ada hasil.' });

  const amountColumns = report.columns.filter((column) => column.type === 'currency');
  const totals = (report.totalsByCurrency || []).map((total) => {
    const items = amountColumns.map((column) =>
      `<div class="totals-item">
        <span class="label">${ui.esc(column.label)}</span>
        <span class="value">${ui.money(total[column.key], total.currency)}</span>
      </div>`).join('');
    const converted = report.conversion
      ? `<div class="totals-item">
          <span class="label">Konversi ${ui.esc(report.conversion.toCurrency)}</span>
          <span class="value">${total.convertedAmount === null || total.convertedAmount === undefined
            ? '<span class="faint">kurs tidak tersedia</span>'
            : ui.money(total.convertedAmount, report.conversion.toCurrency)}</span>
          ${total.rate ? `<span class="faint tiny">kurs ${ui.num(total.rate)} · ${ui.date(total.rateDate)}</span>` : ''}
        </div>`
      : '';
    return `<div class="totals-item"><span class="label">Currency</span><span class="value mono">${ui.esc(total.currency || '—')}</span></div>${items}${converted}`;
  }).join('');

  const conversion = report.conversion ? `
    <span class="tag">Konversi ke ${ui.esc(report.conversion.toCurrency)}</span>
    <span class="tag">Kurs ${ui.esc(report.conversion.rateType)} · ${ui.esc(report.conversion.method)}</span>
    ${(report.conversion.rates || []).map((rate) =>
      `<span class="tag">1 ${ui.esc(rate.fromCurrency)} = ${ui.num(rate.rate)} ${ui.esc(report.conversion.toCurrency)} (${ui.date(rate.rateDate)})</span>`).join('')}`
    : '<span class="tag">Tanpa konversi — nominal per currency</span>';

  const warnings = (report.warnings || []).length
    ? `<div style="padding:12px 16px 0">${report.warnings.map((warning) => ui.banner(warning.message, 'warning', { title: warning.code })).join('')}</div>`
    : '';

  const table = ui.tableColumns(
    report.columns.map((column) => ({ ...column, render: (row) => ui.fmtCell(column, row) })),
    report.rows,
    {
      empty: ui.emptyState({
        title: 'Tidak ada baris pada periode ini',
        desc: 'Ubah periode atau filter. Laporan hanya memakai record aktif dan versi terkini sesuai basisnya.',
      }),
    },
  );

  return `
    <div style="padding:12px 16px 0" class="row-wrap">
      <span class="report-basis"><b>Basis:</b> ${ui.esc(report.basis || report.basisLabel || '—')}</span>
      <span class="report-meta">
        <span>Periode <b>${report.period?.from ? ui.date(report.period.from) : 'semua'}</b> – <b>${report.period?.to ? ui.date(report.period.to) : 'semua'}</b></span>
        <span>Baris <b>${ui.int(report.rowCount)}</b></span>
        <span>Mode <b>${ui.esc(report.currencyMode)}</b></span>
        <span>Dibuat <b>${ui.dateTime(report.generatedAt)}</b></span>
      </span>
    </div>
    <div style="padding:10px 16px" class="row-wrap">${conversion}</div>
    ${warnings}
    ${table}
    ${totals ? `<div class="totals-strip">${totals}</div>` : ''}`;
}
