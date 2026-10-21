import { api } from '../api.js';
import * as ui from '../ui.js';

const TX_TYPES = ['New Business', 'Renewal', 'Endorsement', 'Cancellation'];

export async function render(el, ctx) {
  if (ctx.params[0]) return renderDetail(el, ctx, ctx.params[0]);
  return renderList(el, ctx);
}

async function renderList(el, ctx) {
  el.innerHTML = ctx.shell(ui.loadingTable(7), { title: 'Produksi', subtitle: 'Data transaksi produksi dan posisi polis' });

  const state = {
    ...ctx.query,
    page: ctx.query.page || 1,
    pageSize: ctx.query.pageSize || 25,
    positions: ctx.query.positions === '1',
  };

  const content = `
    <div class="page-head">
      <div>
        <h1 class="page-title">Produksi</h1>
        <p class="page-desc">Satu baris adalah satu transaksi. Versi lama tetap tersimpan; laporan hanya
          memakai transaksi yang valid atau posisi terkini sesuai basisnya.</p>
      </div>
      <div class="page-actions">
        <a class="btn btn-secondary" id="export-production" href="/api/production/export">Ekspor CSV</a>
      </div>
    </div>
    <section class="card">
      <form class="filters" id="filter-form">
        <div class="field grow">
          <label class="label" for="f-policy">Policy No</label>
          <input class="input" id="f-policy" name="policyNo" placeholder="POL-2026-0001" />
        </div>
        <div class="field">
          <label class="label" for="f-branch">Cabang</label>
          <input class="input" id="f-branch" name="branch" placeholder="JKT" style="width:96px" />
        </div>
        <div class="field">
          <label class="label" for="f-product">Produk</label>
          <input class="input" id="f-product" name="product" placeholder="MOTOR" style="width:110px" />
        </div>
        <div class="field">
          <label class="label" for="f-currency">Currency</label>
          <select class="select" id="f-currency" name="currency">
            <option value="">Semua</option><option value="IDR">IDR</option><option value="USD">USD</option>
          </select>
        </div>
        <div class="field">
          <label class="label" for="f-tx">Jenis transaksi</label>
          <select class="select" id="f-tx" name="transactionType">
            <option value="">Semua</option>
            ${TX_TYPES.map((t) => `<option value="${t}">${t}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label class="label" for="f-current">Posisi</label>
          <select class="select" id="f-current" name="isCurrent">
            <option value="">Semua versi</option>
            <option value="1">Hanya terkini</option>
          </select>
        </div>
        <button class="btn btn-secondary" type="submit">Terapkan</button>
        <button class="btn btn-ghost" type="reset">Reset</button>
      </form>
      <div class="row" style="padding:10px 16px;border-bottom:1px solid var(--border)">
        <label class="checkbox"><input type="checkbox" id="positions-toggle" ${state.positions ? 'checked' : ''} />
          Tampilkan hanya posisi polis terkini (Policy + PolicyRiskID)</label>
        <span class="spacer"></span>
        <span class="report-basis" id="positions-basis">${state.positions
          ? 'Basis: posisi terkini per Policy + PolicyRiskID'
          : 'Basis: seluruh transaksi produksi'}</span>
      </div>
      <div id="production-list">${ui.loadingTable(6)}</div>
    </section>`;

  el.innerHTML = ctx.shell(content, { title: 'Produksi', subtitle: 'Transaksi & posisi polis' });

  const form = document.getElementById('filter-form');
  for (const key of ['policyNo', 'branch', 'product', 'currency', 'transactionType', 'isCurrent']) {
    if (state[key]) {
      const field = form.querySelector(`[name="${key}"]`);
      if (field) field.value = state[key];
    }
  }

  const host = document.getElementById('production-list');
  const syncExport = () => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(state)) {
      if (['page', 'pageSize', 'positions'].includes(key)) continue;
      if (value !== undefined && value !== null && value !== '') params.set(key, value);
    }
    document.getElementById('export-production').href = `/api/production/export?${params.toString()}`;
  };

  const renderTable = async () => {
    host.innerHTML = ui.loadingTable(6);
    syncExport();
    try {
      const data = state.positions
        ? await api.listProductionPositions({ ...state, positions: undefined, isCurrent: undefined })
        : await api.listProduction(state);
      const rows = data.rows.map((row) => `
        <tr>
          <td>
            <a class="strong mono" href="#/production/${encodeURIComponent(row.productionId)}">${ui.esc(row.policyNo)}</a>
            <div class="cell-sub mono">${ui.esc(row.policyRiskId || '—')}</div>
          </td>
          <td>${ui.esc(row.agentName || row.sourceAgentCode || '—')}
            <div class="cell-sub mono">${ui.esc(row.sourceAgentCode || '')}</div></td>
          <td class="nowrap">${ui.date(row.effectiveDate)}
            <div class="cell-sub">${ui.esc(row.transactionType)}</div></td>
          <td>${ui.esc(row.productCode || '—')}
            <div class="cell-sub">${ui.esc(row.coverageCode || '—')}</div></td>
          <td class="right num">${ui.money(row.tsi, row.currency)}</td>
          <td class="right num">${ui.money(row.premium, row.currency)}
            <div class="cell-sub">${ui.esc(row.currency)}</div></td>
          <td class="right num">v${ui.int(row.versionNo)} ${row.isCurrent ? ui.pill('Current', 'success', { dot: false }) : ''}</td>
          <td>${ui.statusPill(row.recordStatus)}</td>
          <td class="right"><a class="btn btn-secondary btn-sm" href="#/production/${encodeURIComponent(row.productionId)}">Detail</a></td>
        </tr>`).join('');

      host.innerHTML = (rows ? `<div class="table-wrap"><table class="data">
        <thead><tr><th>Policy / Risk</th><th>Agent</th><th>Effective</th><th>Produk</th>
          <th class="right">TSI</th><th class="right">Premi</th><th class="right">Versi</th><th>Status</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table></div>`
        : ui.emptyState({
            title: 'Tidak ada data produksi',
            desc: 'Unggah file Produksi atau longgarkan filter untuk melihat data lain.',
            action: ctx.can('upload.create') ? '<a class="btn btn-primary" href="#/uploads/new">Upload produksi</a>' : '',
          })) + ui.pagination(data);
    } catch (error) {
      host.innerHTML = ui.banner(error.message, 'danger');
    }
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    state.policyNo = form.policyNo.value.trim() || undefined;
    state.branch = form.branch.value.trim() || undefined;
    state.product = form.product.value.trim() || undefined;
    state.currency = form.currency.value || undefined;
    state.transactionType = form.transactionType.value || undefined;
    state.isCurrent = form.isCurrent.value || undefined;
    state.page = 1;
    renderTable();
  });
  form.addEventListener('reset', () => {
    setTimeout(() => {
      for (const key of ['policyNo', 'branch', 'product', 'currency', 'transactionType', 'isCurrent']) state[key] = undefined;
      state.page = 1;
      renderTable();
    }, 0);
  });
  document.getElementById('positions-toggle').addEventListener('change', (event) => {
    state.positions = event.target.checked;
    state.page = 1;
    document.getElementById('positions-basis').textContent = state.positions
      ? 'Basis: posisi terkini per Policy + PolicyRiskID'
      : 'Basis: seluruh transaksi produksi';
    renderTable();
  });
  host.addEventListener('click', (event) => {
    const btn = event.target.closest('.page-btn');
    if (!btn || btn.disabled) return;
    state.page = Number(btn.dataset.page);
    renderTable();
  });

  await renderTable();
}

async function renderDetail(el, ctx, productionId) {
  el.innerHTML = ctx.shell(ui.loadingTable(6), { title: 'Produksi', subtitle: productionId });

  let detail;
  try {
    detail = await api.getProduction(productionId);
  } catch (error) {
    el.innerHTML = ctx.shell(`<div class="card"><div class="empty">
      <div class="empty-title">Produksi tidak dapat dimuat</div>
      <div class="empty-desc">${ui.esc(error.message)}</div>
      <a class="btn btn-secondary" href="#/production">Kembali</a></div></div>`, { title: 'Produksi' });
    return;
  }

  const record = detail.record;
  const versions = (detail.versions || []).map((version) => `
    <tr>
      <td class="num">v${ui.int(version.versionNo)} ${version.isCurrent ? ui.pill('Current', 'success', { dot: false }) : ''}</td>
      <td class="mono">${ui.esc(version.transactionType)}</td>
      <td class="nowrap">${ui.date(version.effectiveDate)}</td>
      <td class="right num">${ui.money(version.premium, version.currency)}</td>
      <td class="right num">${ui.money(version.tsi, version.currency)}</td>
      <td>${ui.statusPill(version.recordStatus)}</td>
      <td class="nowrap">${ui.dateTime(version.createdAt)}</td>
      <td class="right"><a class="btn btn-ghost btn-sm" href="#/production/${encodeURIComponent(version.productionId)}">Buka</a></td>
    </tr>`).join('');

  const trace = detail.trace;
  const traceHtml = trace ? `
    <dl class="dl">
      <dt>Batch upload</dt><dd>${trace.batch ? `<a class="mono" href="#/uploads/${encodeURIComponent(trace.batch.uploadBatchId)}">${ui.esc(trace.batch.originalFileName)}</a>` : '—'}</dd>
      <dt>Baris sumber</dt><dd>Baris ${ui.int(trace.uploadRow?.sourceRowNumber)} · status ${ui.esc(trace.uploadRow?.classification || trace.uploadRow?.validationStatus || '—')}</dd>
      <dt>Hash baris</dt><dd class="mono tiny truncate">${ui.esc(trace.uploadRow?.sourceRowHash || '—')}</dd>
      <dt>Diunggah oleh</dt><dd>${ui.esc(trace.uploadedBy?.fullName || '—')} · ${ui.dateTime(trace.batch?.uploadedAt)}</dd>
    </dl>` : '<div class="faint small">Data sumber tidak tersedia (record dibuat manual).</div>';

  const content = `
    <div class="page-head">
      <div>
        <h1 class="page-title mono">${ui.esc(record.policyNo)} <span class="faint">/ ${ui.esc(record.policyRiskId || '—')}</span></h1>
        <p class="page-desc">${ui.esc(record.transactionType)} · effective ${ui.date(record.effectiveDate)} · versi ${ui.int(record.versionNo)}</p>
      </div>
      <div class="page-actions">
        <a class="btn btn-ghost" href="#/production">Kembali</a>
        ${ctx.can('production.write') && record.recordStatus === 'Active'
          ? '<button class="btn btn-danger" id="cancel-record">Batalkan record</button>' : ''}
      </div>
    </div>

    <div class="summary-grid" style="margin-bottom:16px">
      <div class="summary-tile"><div class="label">Premium</div><div class="value num">${ui.money(record.premium, record.currency)}</div></div>
      <div class="summary-tile"><div class="label">TSI</div><div class="value num">${ui.money(record.tsi, record.currency)}</div></div>
      <div class="summary-tile"><div class="label">Currency</div><div class="value mono">${ui.esc(record.currency)}</div></div>
      <div class="summary-tile"><div class="label">Agent</div><div class="value small">${ui.esc(record.agentName || record.sourceAgentCode || '—')}</div></div>
      <div class="summary-tile"><div class="label">Cabang</div><div class="value mono">${ui.esc(record.branchCode || '—')}</div></div>
      <div class="summary-tile"><div class="label">UW Year</div><div class="value num">${ui.int(record.uwYear)}</div></div>
      <div class="summary-tile"><div class="label">Status</div><div class="value">${ui.statusPill(record.recordStatus)}</div></div>
    </div>

    <div style="display:grid;grid-template-columns:1.4fr 1fr;gap:16px;margin-bottom:16px" class="detail-grid">
      <section class="card">
        <div class="card-head"><div class="card-title">Rincian transaksi</div></div>
        <div class="card-body">
          <dl class="dl">
            <dt>Production ID</dt><dd class="mono">${ui.esc(record.productionId)}</dd>
            <dt>Business key</dt><dd class="mono tiny">${ui.esc(record.businessKey)}</dd>
            <dt>Policy No</dt><dd class="mono">${ui.esc(record.policyNo)}</dd>
            <dt>Policy Risk ID</dt><dd class="mono">${ui.esc(record.policyRiskId || '—')}</dd>
            <dt>Tanggal transaksi</dt><dd>${ui.date(record.transactionDate)}</dd>
            <dt>Effective / Expiry</dt><dd>${ui.date(record.effectiveDate)} – ${ui.date(record.expiryDate)}</dd>
            <dt>Produk / Coverage</dt><dd>${ui.esc(record.productCode || '—')} / ${ui.esc(record.coverageCode || '—')}</dd>
            <dt>Deskripsi risiko</dt><dd>${ui.esc(record.vehicleOrRiskDescription || '—')}</dd>
            <dt>Versi</dt><dd>v${ui.int(record.versionNo)}${record.previousRecordId ? ` · sebelumnya <a class="mono" href="#/production/${encodeURIComponent(record.previousRecordId)}">${ui.esc(record.previousRecordId)}</a>` : ''}</dd>
            ${record.recordStatus === 'Cancelled' ? `<dt>Pembatalan</dt><dd>${ui.dateTime(record.cancelledAt)} · ${ui.esc(record.cancellationReason || '—')}</dd>` : ''}
          </dl>
        </div>
      </section>
      <section class="card">
        <div class="card-head"><div class="card-title">Jejak sumber</div></div>
        <div class="card-body">${traceHtml}</div>
      </section>
    </div>

    <section class="card">
      <div class="card-head"><div>
        <div class="card-title">Riwayat versi</div>
        <div class="card-sub">Perubahan premium atau atribut lain menghasilkan versi baru; transaksi lama berhenti menjadi posisi terkini.</div>
      </div></div>
      <div class="card-body flush"><div class="table-wrap"><table class="data">
        <thead><tr><th>Versi</th><th>Jenis</th><th>Effective</th><th class="right">Premi</th><th class="right">TSI</th><th>Status</th><th>Dibuat</th><th></th></tr></thead>
        <tbody>${versions || '<tr><td colspan="8" class="faint">Belum ada versi.</td></tr>'}</tbody></table></div></div>
    </section>
    <style>@media (max-width: 1100px){.detail-grid{grid-template-columns:1fr !important}}</style>`;

  el.innerHTML = ctx.shell(content, { title: 'Produksi', subtitle: record.policyNo });
  document.getElementById('cancel-record')?.addEventListener('click', async () => {
    const reason = await ui.confirmDialog({
      title: 'Batalkan record produksi',
      message: 'Record tidak dihapus. Status berubah menjadi Cancelled dan berhenti menjadi posisi terkini.',
      confirmLabel: 'Batalkan record',
      requireReason: true,
    });
    if (!reason) return;
    try {
      await api.cancelProduction(record.productionId, reason);
      ui.toast('Record produksi dibatalkan.', 'success');
      await renderDetail(el, ctx, productionId);
    } catch (error) {
      ui.toast(error.message, 'danger');
    }
  });
}
