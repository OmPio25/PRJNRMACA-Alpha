import { api } from '../api.js';
import * as ui from '../ui.js';

export async function render(el, ctx) {
  if (ctx.params[0]) return renderDetail(el, ctx, ctx.params[0]);
  return renderList(el, ctx);
}

async function renderList(el, ctx) {
  el.innerHTML = ctx.shell(ui.loadingTable(7), { title: 'Claim & Settlement', subtitle: 'Claim dan riwayat settlement' });

  const state = { ...ctx.query, page: ctx.query.page || 1, pageSize: ctx.query.pageSize || 25 };

  const content = `
    <div class="page-head">
      <div>
        <h1 class="page-title">Claim &amp; Settlement</h1>
        <p class="page-desc">Satu claim dapat memiliki beberapa settlement. Total settlement ditampilkan
          per currency dan tidak pernah dijumlahkan lintas currency.</p>
      </div>
      <div class="page-actions">
        ${ctx.can('export.claim') ? '<a class="btn btn-secondary" id="export-claims" href="/api/claims/export">Ekspor CSV</a>' : ''}
      </div>
    </div>
    <section class="card">
      <form class="filters" id="filter-form">
        <div class="field"><label class="label" for="f-claim">Claim No</label>
          <input class="input" id="f-claim" name="claimNo" placeholder="CLM-2026-0001" /></div>
        <div class="field"><label class="label" for="f-policy">Policy No</label>
          <input class="input" id="f-policy" name="policyNo" placeholder="POL-2026-0001" /></div>
        <div class="field" style="max-width:100px"><label class="label" for="f-uw">UW Year</label>
          <input class="input" id="f-uw" name="uwYear" inputmode="numeric" placeholder="2026" /></div>
        <div class="field" style="max-width:90px"><label class="label" for="f-branch">Cabang</label>
          <input class="input" id="f-branch" name="branch" placeholder="JKT" /></div>
        <div class="field" style="max-width:100px"><label class="label" for="f-currency">Currency</label>
          <select class="select" id="f-currency" name="currency">
            <option value="">Semua</option><option value="IDR">IDR</option><option value="USD">USD</option>
          </select></div>
        <div class="field"><label class="label" for="f-cause">Cause of loss</label>
          <input class="input" id="f-cause" name="causeOfLoss" placeholder="COLLISION" /></div>
        <div class="field"><label class="label" for="f-settled-from">Settled dari</label>
          <input class="input" id="f-settled-from" name="settledFrom" type="date" /></div>
        <div class="field"><label class="label" for="f-settled-to">Settled sampai</label>
          <input class="input" id="f-settled-to" name="settledTo" type="date" /></div>
        <button class="btn btn-secondary" type="submit">Terapkan</button>
        <button class="btn btn-ghost" type="reset">Reset</button>
      </form>
      <div id="claim-list">${ui.loadingTable(6)}</div>
    </section>`;

  el.innerHTML = ctx.shell(content, { title: 'Claim & Settlement', subtitle: 'Daftar claim' });

  const form = document.getElementById('filter-form');
  for (const key of ['claimNo', 'policyNo', 'uwYear', 'branch', 'currency', 'causeOfLoss', 'settledFrom', 'settledTo']) {
    if (state[key]) {
      const field = form.querySelector(`[name="${key}"]`);
      if (field) field.value = state[key];
    }
  }

  const host = document.getElementById('claim-list');
  const syncExport = () => {
    const exportLink = document.getElementById('export-claims');
    if (!exportLink) return;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(state)) {
      if (['page', 'pageSize'].includes(key)) continue;
      if (value !== undefined && value !== null && value !== '') params.set(key, value);
    }
    exportLink.href = `/api/claims/export?${params.toString()}`;
  };

  const renderTable = async () => {
    host.innerHTML = ui.loadingTable(6);
    syncExport();
    try {
      const data = await api.listClaims(state);
      const rows = data.rows.map((claim) => {
        const perCurrency = claim.settlementsByCurrency?.length
          ? claim.settlementsByCurrency.map((entry) =>
              `<div>${ui.money(entry.grossClaim, entry.currency)} <span class="faint tiny">${ui.esc(entry.currency)}</span></div>`).join('')
          : '<span class="faint">—</span>';
        return `<tr>
          <td>
            <a class="strong mono" href="#/claims/${encodeURIComponent(claim.claimId)}">${ui.esc(claim.claimNo)}</a>
            <div class="cell-sub mono">${ui.esc(claim.policyNo)}</div>
          </td>
          <td>${ui.esc(claim.agentName || '—')}<div class="cell-sub mono">${ui.esc(claim.branchCode || '')}</div></td>
          <td class="num">${ui.int(claim.uwYear)}</td>
          <td>${ui.esc(claim.causeOfLoss || '—')}<div class="cell-sub">${ui.date(claim.lossDate)}</div></td>
          <td class="right num">${ui.int(claim.settlementCount)}</td>
          <td class="right num">${perCurrency}</td>
          <td>${ui.statusPill(claim.claimStatus)}</td>
          <td class="right"><a class="btn btn-secondary btn-sm" href="#/claims/${encodeURIComponent(claim.claimId)}">Detail</a></td>
        </tr>`;
      }).join('');

      host.innerHTML = (rows ? `<div class="table-wrap"><table class="data">
        <thead><tr><th>Claim / Policy</th><th>Agent</th><th class="right">UW Year</th><th>Cause / Loss</th>
          <th class="right">Settlement</th><th class="right">Gross settled</th><th>Status</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table></div>`
        : ui.emptyState({
            title: 'Tidak ada claim',
            desc: 'Unggah file Claim, atau longgarkan filter. Claim tanpa Claim No akan ditolak saat validasi.',
          })) + ui.pagination(data);
    } catch (error) {
      host.innerHTML = ui.banner(error.message, 'danger');
    }
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    for (const key of ['claimNo', 'policyNo', 'uwYear', 'branch', 'currency', 'causeOfLoss', 'settledFrom', 'settledTo']) {
      state[key] = form[key].value.trim() || undefined;
    }
    state.page = 1;
    renderTable();
  });
  form.addEventListener('reset', () => {
    setTimeout(() => {
      for (const key of ['claimNo', 'policyNo', 'uwYear', 'branch', 'currency', 'causeOfLoss', 'settledFrom', 'settledTo']) state[key] = undefined;
      state.page = 1;
      renderTable();
    }, 0);
  });
  host.addEventListener('click', (event) => {
    const btn = event.target.closest('.page-btn');
    if (!btn || btn.disabled) return;
    state.page = Number(btn.dataset.page);
    renderTable();
  });

  await renderTable();
}

async function renderDetail(el, ctx, claimId) {
  el.innerHTML = ctx.shell(ui.loadingTable(6), { title: 'Claim', subtitle: claimId });

  let detail;
  try {
    detail = await api.getClaim(claimId);
  } catch (error) {
    el.innerHTML = ctx.shell(`<div class="card"><div class="empty">
      <div class="empty-title">Claim tidak dapat dimuat</div>
      <div class="empty-desc">${ui.esc(error.message)}</div>
      <a class="btn btn-secondary" href="#/claims">Kembali</a></div></div>`, { title: 'Claim' });
    return;
  }

  const claim = detail.claim;
  const settlements = detail.settlements || [];
  const settlementRows = settlements.map((settlement) => `
    <tr>
      <td class="mono">${ui.esc(settlement.settlementNo || '—')}
        ${settlement.isCurrent ? '' : ui.pill('Superseded', 'neutral', { dot: false })}</td>
      <td class="nowrap">${ui.date(settlement.dateOfSettlement)}</td>
      <td class="right num">${ui.money(settlement.grossClaim, settlement.currency)}</td>
      <td class="right num">${ui.money(settlement.indemnity, settlement.currency)}</td>
      <td class="right num">${ui.money(settlement.deductible, settlement.currency)}</td>
      <td class="right num">${ui.money(settlement.salvage, settlement.currency)}</td>
      <td class="right num">${ui.money(settlement.subrogation, settlement.currency)}</td>
      <td>${ui.statusPill(settlement.recordStatus)}</td>
      <td class="right">${ctx.can('claim.write') && settlement.recordStatus === 'Active'
        ? `<button class="btn btn-ghost btn-sm" data-cancel-settlement="${ui.esc(settlement.claimSettlementId)}">Batalkan</button>` : ''}</td>
    </tr>`).join('');

  const totals = (claim.settlementsByCurrency || []).map((entry) => `
    <div class="totals-item">
      <span class="label">Gross ${ui.esc(entry.currency)}</span>
      <span class="value">${ui.money(entry.grossClaim, entry.currency)}</span>
      <span class="faint tiny">${ui.int(entry.settlementCount)} settlement</span>
    </div>`).join('');

  const trace = detail.trace;
  const traceHtml = trace ? `
    <dl class="dl">
      <dt>Batch upload</dt><dd>${trace.batch ? `<a class="mono" href="#/uploads/${encodeURIComponent(trace.batch.uploadBatchId)}">${ui.esc(trace.batch.originalFileName)}</a>` : '—'}</dd>
      <dt>Baris sumber</dt><dd>Baris ${ui.int(trace.uploadRow?.sourceRowNumber)} · ${ui.esc(trace.uploadRow?.classification || trace.uploadRow?.validationStatus || '—')}</dd>
      <dt>Diunggah oleh</dt><dd>${ui.esc(trace.uploadedBy?.fullName || '—')} · ${ui.dateTime(trace.batch?.uploadedAt)}</dd>
    </dl>` : '<div class="faint small">Tidak ada jejak upload (record manual).</div>';

  const content = `
    <div class="page-head">
      <div>
        <h1 class="page-title mono">${ui.esc(claim.claimNo)}</h1>
        <p class="page-desc">${ui.esc(claim.policyNo)} · UW ${ui.int(claim.uwYear)} · loss ${ui.date(claim.lossDate)}</p>
      </div>
      <div class="page-actions">
        <a class="btn btn-ghost" href="#/claims">Kembali</a>
        ${ctx.can('export.claim') ? `<a class="btn btn-secondary" href="/api/claims/${encodeURIComponent(claim.claimId)}/export">Ekspor settlement</a>` : ''}
      </div>
    </div>

    <div class="summary-grid" style="margin-bottom:16px">
      <div class="summary-tile"><div class="label">Status claim</div><div class="value">${ui.statusPill(claim.claimStatus)}</div></div>
      <div class="summary-tile"><div class="label">Settlement aktif</div><div class="value num">${ui.int(claim.settlementCount)}</div></div>
      <div class="summary-tile"><div class="label">Currency</div><div class="value mono">${ui.esc(claim.currency || '—')}</div></div>
      <div class="summary-tile"><div class="label">Cause of loss</div><div class="value small">${ui.esc(claim.causeOfLoss || '—')}</div></div>
      <div class="summary-tile"><div class="label">Agent</div><div class="value small">${ui.esc(claim.agentName || '—')}</div></div>
      <div class="summary-tile"><div class="label">Cabang</div><div class="value mono">${ui.esc(claim.branchCode || '—')}</div></div>
      <div class="summary-tile"><div class="label">TSI at loss</div><div class="value num">${ui.money(claim.tsiAtLoss, claim.currency)}</div></div>
    </div>

    <section class="card" style="margin-bottom:16px">
      <div class="card-head"><div>
        <div class="card-title">Settlement</div>
        <div class="card-sub">Tanggal settlement adalah Date Of Settlement — basis laporan Claim Settled.</div>
      </div><span class="pill pill-info">${ui.int(settlements.length)} baris</span></div>
      <div class="card-body flush">
        ${settlementRows ? `<div class="table-wrap"><table class="data">
          <thead><tr><th>Settlement</th><th>Date Of Settlement</th><th class="right">Gross</th><th class="right">Indemnity</th>
            <th class="right">Deductible</th><th class="right">Salvage</th><th class="right">Subrogation</th><th>Status</th><th></th></tr></thead>
          <tbody>${settlementRows}</tbody></table></div>`
          : ui.emptyState({ title: 'Belum ada settlement', desc: 'Claim ini belum memiliki settlement aktif.' })}
      </div>
      ${totals ? `<div class="totals-strip">${totals}</div>` : ''}
    </section>

    <section class="card">
      <div class="card-head"><div class="card-title">Jejak sumber</div></div>
      <div class="card-body">${traceHtml}</div>
    </section>
    <style>@media (max-width: 1100px){.summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}</style>`;

  el.innerHTML = ctx.shell(content, { title: 'Claim', subtitle: claim.claimNo });

  document.querySelectorAll('[data-cancel-settlement]').forEach((button) => {
    button.addEventListener('click', async () => {
      const settlementId = button.getAttribute('data-cancel-settlement');
      const reason = await ui.confirmDialog({
        title: 'Batalkan settlement',
        message: 'Settlement tidak dihapus fisik. Status berubah menjadi Cancelled dan tidak dihitung pada laporan.',
        confirmLabel: 'Batalkan settlement',
        requireReason: true,
      });
      if (!reason) return;
      try {
        await api.cancelSettlement(claim.claimId, settlementId, reason);
        ui.toast('Settlement dibatalkan.', 'success');
        await renderDetail(el, ctx, claimId);
      } catch (error) {
        ui.toast(error.message, 'danger');
      }
    });
  });
}
