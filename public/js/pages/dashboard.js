import { api } from '../api.js';
import * as ui from '../ui.js';

export async function render(el, ctx) {
  el.innerHTML = ctx.shell(ui.loadingTable(4), { title: 'Dashboard', subtitle: 'Ringkasan operasional data agent, produksi, dan claim' });

  let data;
  try {
    data = await api.dashboard();
  } catch (error) {
    el.innerHTML = ctx.shell(`<div class="card"><div class="empty">
      <div class="empty-title">Dashboard gagal dimuat</div>
      <div class="empty-desc">${ui.esc(error.message)}</div></div></div>`, { title: 'Dashboard' });
    return;
  }

  const k = data.kpis;
  const premiumBars = (data.premiumByCurrency || []).map((row) => ({
    label: row.currency, value: row.premium, currency: row.currency, count: row.transactionCount,
  }));
  const settledBars = (data.settledByCurrency || []).map((row) => ({
    label: row.currency, value: row.grossClaim, currency: row.currency, count: row.settlementCount,
  }));

  const kpis = [
    ui.kpi({ label: 'Batch bulan ini', value: ui.int(k.batchesThisMonth), foot: 'Total upload diterima', color: '#2457e6' }),
    ui.kpi({ label: 'Menunggu review', value: ui.int(k.pendingReview), foot: 'Batch siap diperiksa', color: '#b54708' }),
    ui.kpi({ label: 'Pending mapping', value: ui.int(k.pendingMapping), foot: 'Baris menunggu master agent', color: '#175cd3' }),
    ui.kpi({ label: 'Baris posted bulan ini', value: ui.int(k.postedRowsThisMonth), foot: 'Masuk ke tabel inti', color: '#067647' }),
  ].join('');

  const kpis2 = [
    ui.kpi({ label: 'Agent aktif', value: ui.int(k.activeAgents), foot: 'Master agent berstatus Active', color: '#0f766e' }),
    ui.kpi({ label: 'Posisi polis terkini', value: ui.int(k.currentPolicies), foot: 'IsCurrent = true', color: '#2457e6' }),
    ui.kpi({ label: 'Claim tercatat', value: ui.int(k.openClaims), foot: 'Identitas claim unik', color: '#6941c6' }),
    ui.kpi({ label: 'Settlement bulan ini', value: ui.int(k.claimSettlementsThisMonth), foot: 'Berdasarkan Date Of Settlement', color: '#b54708' }),
  ].join('');

  const recentRows = (data.recentBatches || []).map((batch) => `
    <tr>
      <td>
        <a class="strong" href="#/uploads/${encodeURIComponent(batch.uploadBatchId)}">${ui.esc(batch.originalFileName)}</a>
        <div class="cell-sub mono">${ui.esc(batch.uploadBatchId)}</div>
      </td>
      <td>${ui.pill(batch.uploadType, batch.uploadType === 'AGENT' ? 'accent' : batch.uploadType === 'PRODUCTION' ? 'info' : 'warning', { dot: false })}</td>
      <td>${ui.statusPill(batch.processingStatus)}</td>
      <td class="right num">${ui.int(batch.totalRows)}</td>
      <td class="right num">${ui.int(batch.newRows)}</td>
      <td class="right num">${ui.int(batch.duplicateRows)}</td>
      <td class="right num">${ui.int(batch.rejectedRows)}</td>
      <td class="nowrap">${ui.esc(batch.uploadedByName || '—')}<div class="cell-sub">${ui.dateTime(batch.uploadedAt)}</div></td>
    </tr>`).join('');

  const statusList = (data.statusBreakdown || []).map((row) =>
    `<div class="row"><span>${ui.statusPill(row.processingStatus)}</span><span class="spacer"></span><b class="num">${ui.int(row.count)}</b></div>`).join('');

  const content = `
    <div class="page-head">
      <div>
        <h1 class="page-title">Ringkasan operasional</h1>
        <p class="page-desc">Angka disajikan per currency. Nominal IDR dan USD tidak pernah dijumlahkan langsung.</p>
      </div>
      <div class="page-actions">
        <a class="btn btn-secondary" href="#/reports">Buka laporan</a>
        ${ctx.can('upload.create') ? '<a class="btn btn-primary" href="#/uploads/new">Upload data</a>' : ''}
      </div>
    </div>

    <div class="kpi-grid" style="margin-bottom:16px">${kpis}</div>
    <div class="kpi-grid" style="margin-bottom:24px">${kpis2}</div>

    <div style="display:grid;grid-template-columns:1.15fr .85fr;gap:16px;margin-bottom:16px" class="dash-grid">
      <section class="card">
        <div class="card-head">
          <div>
            <div class="card-title">Premi per currency</div>
            <div class="card-sub">Transaksi produksi valid (posisi terkini, bukan seluruh versi)</div>
          </div>
        </div>
        <div class="card-body">
          ${ui.chartBars(premiumBars, { money: true })}
          <div class="divider"></div>
          <div class="row-wrap small muted">
            ${(data.premiumByCurrency || []).map((row) => `<span class="tag">${ui.esc(row.currency)} · ${ui.int(row.transactionCount)} transaksi</span>`).join('')}
          </div>
        </div>
      </section>
      <section class="card">
        <div class="card-head"><div>
          <div class="card-title">Gross claim settled</div>
          <div class="card-sub">Per currency, berdasarkan tanggal settlement</div>
        </div></div>
        <div class="card-body">
          ${ui.chartBars(settledBars, { money: true })}
          <div class="divider"></div>
          <div class="row-wrap small muted">
            ${(data.settledByCurrency || []).map((row) => `<span class="tag">${ui.esc(row.currency)} · ${ui.int(row.settlementCount)} settlement</span>`).join('') || '<span class="faint">Belum ada settlement.</span>'}
          </div>
        </div>
      </section>
    </div>

    <div style="display:grid;grid-template-columns:1.6fr .9fr;gap:16px" class="dash-grid">
      <section class="card">
        <div class="card-head">
          <div class="card-title">Batch upload terakhir</div>
          <div class="spacer"></div>
          <a class="btn btn-ghost btn-sm" href="#/uploads">Lihat semua</a>
        </div>
        <div class="card-body flush">
          ${recentRows ? `<div class="table-wrap"><table class="data">
            <thead><tr><th>File</th><th>Jenis</th><th>Status</th><th class="right">Total</th><th class="right">New</th><th class="right">Dup</th><th class="right">Reject</th><th>Diunggah</th></tr></thead>
            <tbody>${recentRows}</tbody></table></div>`
            : ui.emptyState({ title: 'Belum ada batch', desc: 'Mulai dengan mengunggah file Agent, Produksi, atau Claim.' })}
        </div>
      </section>
      <section class="card">
        <div class="card-head"><div class="card-title">Status batch</div></div>
        <div class="card-body stack">
          ${statusList || '<span class="faint small">Belum ada data.</span>'}
        </div>
      </section>
    </div>

    <style>@media (max-width: 1180px){.dash-grid{grid-template-columns:1fr !important}}</style>`;

  el.innerHTML = ctx.shell(content, { title: 'Dashboard', subtitle: 'Ringkasan operasional' });
}
