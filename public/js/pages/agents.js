import { api } from '../api.js';
import * as ui from '../ui.js';

export async function render(el, ctx) {
  if (ctx.params[0]) return renderDetail(el, ctx, ctx.params[0]);
  return renderList(el, ctx);
}

// ---------------------------------------------------------------- daftar
async function renderList(el, ctx) {
  el.innerHTML = ctx.shell(ui.loadingTable(6), { title: 'Master Agent', subtitle: 'Identitas agent dan histori versi' });

  const state = { ...ctx.query, page: ctx.query.page || 1, pageSize: ctx.query.pageSize || 25 };
  const content = `
    <div class="page-head">
      <div>
        <h1 class="page-title">Master Agent</h1>
        <p class="page-desc">Kode agen adalah kunci identitas. Perubahan nama, cabang, atau status disimpan
          sebagai versi baru — histori lama tidak dihapus.</p>
      </div>
      <div class="page-actions">
        ${ctx.can('agent.write') ? '<button class="btn btn-secondary" id="refresh-mapping">Muat pending mapping</button>' : ''}
        ${ctx.can('agent.write') ? '<button class="btn btn-primary" id="new-agent">Agent baru</button>' : ''}
      </div>
    </div>
    ${ctx.can('agent.write') ? '<div id="mapping-panel" style="margin-bottom:16px"></div>' : ''}
    <section class="card">
      <form class="filters" id="filter-form">
        <div class="field grow">
          <label class="label" for="f-q">Cari</label>
          <input class="input" id="f-q" name="q" placeholder="Kode agen, Agent ID, atau nama" />
        </div>
        <div class="field">
          <label class="label" for="f-branch">Cabang</label>
          <input class="input" id="f-branch" name="branch" placeholder="JKT" style="width:110px" />
        </div>
        <div class="field">
          <label class="label" for="f-status">Status</label>
          <select class="select" id="f-status" name="statusKey">
            <option value="">Semua status</option>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </select>
        </div>
        <button class="btn btn-secondary" type="submit">Terapkan</button>
        <button class="btn btn-ghost" type="reset">Reset</button>
      </form>
      <div id="agent-list">${ui.loadingTable(6)}</div>
    </section>`;

  el.innerHTML = ctx.shell(content, { title: 'Master Agent', subtitle: 'Daftar agent' });

  const host = document.getElementById('agent-list');
  const renderTable = async () => {
    host.innerHTML = ui.loadingTable(5);
    try {
      const data = await api.listAgents(state);
      const rows = data.rows.map((agent) => `
        <tr>
          <td>
            <a class="strong" href="#/agents/${encodeURIComponent(agent.agentIdInternal)}">${ui.esc(agent.namaAgent || '—')}</a>
            <div class="cell-sub mono">${ui.esc(agent.agentIdInternal)}</div>
          </td>
          <td class="mono">${ui.esc(agent.kodeagen)}</td>
          <td class="mono">${ui.esc(agent.agentIdSource || '—')}</td>
          <td>${ui.esc(agent.branchCode || '—')}<div class="cell-sub">${ui.esc(agent.branchName || '')}</div></td>
          <td>${ui.statusPill(agent.statusAgent)}</td>
          <td class="right num">v${ui.int(agent.currentVersionNo || 1)}</td>
          <td class="nowrap">${ui.dateTime(agent.updatedAt || agent.createdAt)}</td>
          <td class="right">
            <a class="btn btn-secondary btn-sm" href="#/agents/${encodeURIComponent(agent.agentIdInternal)}">Detail</a>
          </td>
        </tr>`).join('');

      host.innerHTML = (rows ? `<div class="table-wrap"><table class="data">
        <thead><tr><th>Agent</th><th>Kode Agen</th><th>Agent ID Source</th><th>Cabang</th>
          <th>Status</th><th class="right">Versi</th><th>Diperbarui</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table></div>`
        : ui.emptyState({
            title: 'Belum ada agent',
            desc: 'Agent terbentuk otomatis dari upload Agent, atau tambahkan secara manual.',
            action: ctx.can('agent.write') ? '<button class="btn btn-primary" id="empty-new">Agent baru</button>' : '',
          })) + ui.pagination(data);
    } catch (error) {
      host.innerHTML = ui.banner(error.message, 'danger');
    }
  };

  const form = document.getElementById('filter-form');
  for (const key of ['q', 'branch', 'statusKey']) {
    if (state[key]) {
      const field = form.querySelector(`[name="${key}"]`);
      if (field) field.value = state[key];
    }
  }
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    state.q = form.q.value.trim() || undefined;
    state.branch = form.branch.value.trim() || undefined;
    state.statusKey = form.statusKey.value || undefined;
    state.page = 1;
    renderTable();
  });
  form.addEventListener('reset', () => {
    setTimeout(() => {
      state.q = undefined; state.branch = undefined; state.statusKey = undefined; state.page = 1;
      renderTable();
    }, 0);
  });
  host.addEventListener('click', (event) => {
    const btn = event.target.closest('.page-btn');
    if (!btn || btn.disabled) return;
    state.page = Number(btn.dataset.page);
    renderTable();
  });

  const openNew = () => agentForm(ctx, null, async () => { await renderTable(); await loadMapping(); });
  document.getElementById('new-agent')?.addEventListener('click', openNew);
  host.addEventListener('click', (event) => {
    if (event.target.closest('#empty-new')) openNew();
  });

  const mappingHost = document.getElementById('mapping-panel');
  const loadMapping = async () => {
    if (!mappingHost) return;
    mappingHost.innerHTML = ui.loadingTable(2);
    try {
      const data = await api.pendingMapping();
      if (!data.rows.length) {
        mappingHost.innerHTML = '';
        return;
      }
      const rows = data.rows.map((row) => `
        <tr>
          <td class="mono strong">${ui.esc(row.kodeagen)}</td>
          <td class="right num">${ui.int(row.count)}</td>
          <td>${(row.batchIds || []).map((id) => `<span class="tag mono">${ui.esc(id)}</span>`).join(' ')}</td>
          <td class="right">
            <button class="btn btn-primary btn-sm" data-create-agent="${ui.esc(row.kodeagen)}">Buat agent</button>
          </td>
        </tr>`).join('');
      mappingHost.innerHTML = `<section class="card">
        <div class="card-head"><div>
          <div class="card-title">Pending Mapping — kode agen belum dikenal</div>
          <div class="card-sub">Baris produksi/claim menunggu kode agen dipetakan ke master agent.</div>
        </div><span class="pill pill-warning">${ui.int(data.rows.length)} kode</span></div>
        <div class="card-body flush"><div class="table-wrap"><table class="data">
          <thead><tr><th>Kode Agen</th><th class="right">Baris</th><th>Batch</th><th class="right">Aksi</th></tr></thead>
          <tbody>${rows}</tbody></table></div></div>
      </section>`;
      mappingHost.querySelectorAll('[data-create-agent]').forEach((button) => {
        button.addEventListener('click', () => {
          agentForm(ctx, { kodeagen: button.getAttribute('data-create-agent') }, loadMapping);
        });
      });
    } catch (error) {
      mappingHost.innerHTML = ui.banner(error.message, 'danger');
    }
  };
  document.getElementById('refresh-mapping')?.addEventListener('click', loadMapping);

  await renderTable();
  await loadMapping();
}

// ---------------------------------------------------------------- detail
async function renderDetail(el, ctx, agentId) {
  el.innerHTML = ctx.shell(ui.loadingTable(6), { title: 'Master Agent', subtitle: agentId });

  let detail;
  try {
    detail = await api.getAgent(agentId);
  } catch (error) {
    el.innerHTML = ctx.shell(`<div class="card"><div class="empty">
      <div class="empty-title">Agent tidak dapat dimuat</div>
      <div class="empty-desc">${ui.esc(error.message)}</div>
      <a class="btn btn-secondary" href="#/agents">Kembali</a></div></div>`, { title: 'Master Agent' });
    return;
  }

  const agent = detail.agent;
  const production = detail.productionSummary || [];
  const claims = detail.claimSummary || [];

  const versions = (detail.versions || []).map((version) => `
    <tr>
      <td class="num">v${ui.int(version.versionNo)} ${version.isCurrent ? ui.pill('Current', 'success', { dot: false }) : ''}</td>
      <td>${ui.esc(version.namaAgent || '—')}</td>
      <td class="mono">${ui.esc(version.branchCode || '—')}</td>
      <td>${ui.statusPill(version.statusAgent)}</td>
      <td>${ui.esc(version.changeReason || '—')}</td>
      <td class="nowrap">${ui.dateTime(version.createdAt)}</td>
      <td class="mono tiny truncate">${ui.esc(version.sourceRowHash || '—')}</td>
    </tr>`).join('');

  const productionRows = production.length
    ? production.map((row) => `<tr>
        <td class="mono">${ui.esc(row.currency)}</td>
        <td class="right num">${ui.int(row.transactionCount)}</td>
        <td class="right num">${ui.money(row.premium, row.currency)}</td>
        <td class="right num">${ui.money(row.tsi, row.currency)}</td>
      </tr>`).join('')
    : '<tr><td colspan="4" class="faint">Belum ada produksi aktif.</td></tr>';

  const claimRows = claims.length
    ? claims.map((row) => `<tr>
        <td class="mono">${ui.esc(row.currency)}</td>
        <td class="right num">${ui.int(row.claimCount)}</td>
        <td class="right num">${ui.int(row.settlementCount)}</td>
        <td class="right num">${ui.money(row.grossClaim, row.currency)}</td>
        <td class="right num">${ui.money(row.indemnity, row.currency)}</td>
      </tr>`).join('')
    : '<tr><td colspan="5" class="faint">Belum ada claim.</td></tr>';

  const content = `
    <div class="page-head">
      <div>
        <h1 class="page-title">${ui.esc(agent.namaAgent || agent.kodeagen)}</h1>
        <p class="page-desc mono">${ui.esc(agent.agentIdInternal)} · versi ${ui.int(agent.currentVersionNo || 1)}</p>
      </div>
      <div class="page-actions">
        <a class="btn btn-ghost" href="#/agents">Kembali</a>
        ${ctx.can('agent.write') ? '<button class="btn btn-primary" id="edit-agent">Ubah agent</button>' : ''}
      </div>
    </div>

    <div class="summary-grid" style="margin-bottom:16px">
      <div class="summary-tile"><div class="label">Kode Agen</div><div class="value mono">${ui.esc(agent.kodeagen)}</div></div>
      <div class="summary-tile"><div class="label">Agent ID Source</div><div class="value mono">${ui.esc(agent.agentIdSource || '—')}</div></div>
      <div class="summary-tile"><div class="label">Cabang</div><div class="value">${ui.esc(agent.branchCode || '—')} <span class="faint small">${ui.esc(agent.branchName || '')}</span></div></div>
      <div class="summary-tile"><div class="label">Status</div><div class="value">${ui.statusPill(agent.statusAgent)}</div></div>
    </div>

    <div style="display:grid;grid-template-columns:1.4fr 1fr;gap:16px;margin-bottom:16px" class="detail-grid">
      <section class="card">
        <div class="card-head"><div class="card-title">Produksi aktif per currency</div></div>
        <div class="card-body flush"><div class="table-wrap"><table class="data">
          <thead><tr><th>Currency</th><th class="right">Transaksi</th><th class="right">Premi</th><th class="right">TSI</th></tr></thead>
          <tbody>${productionRows}</tbody></table></div></div>
      </section>
      <section class="card">
        <div class="card-head"><div class="card-title">Claim per currency</div></div>
        <div class="card-body flush"><div class="table-wrap"><table class="data">
          <thead><tr><th>Currency</th><th class="right">Claim</th><th class="right">Settlement</th><th class="right">Gross</th><th class="right">Indemnity</th></tr></thead>
          <tbody>${claimRows}</tbody></table></div></div>
      </section>
    </div>

    <section class="card" style="margin-bottom:16px">
      <div class="card-head"><div>
        <div class="card-title">Histori versi</div>
        <div class="card-sub">Setiap perubahan menghasilkan versi baru; versi lama tetap tersimpan untuk audit.</div>
      </div></div>
      <div class="card-body flush"><div class="table-wrap"><table class="data">
        <thead><tr><th>Versi</th><th>Nama</th><th>Cabang</th><th>Status</th><th>Alasan</th><th>Dibuat</th><th>Hash baris</th></tr></thead>
        <tbody>${versions || '<tr><td colspan="7" class="faint">Belum ada versi.</td></tr>'}</tbody></table></div></div>
    </section>

    <section class="card">
      <div class="card-head"><div class="card-title">Jejak sumber</div></div>
      <div class="card-body">
        <dl class="dl">
          <dt>Batch upload</dt><dd>${agent.uploadBatchId ? `<a class="mono" href="#/uploads/${encodeURIComponent(agent.uploadBatchId)}">${ui.esc(agent.uploadBatchId)}</a>` : '—'}</dd>
          <dt>Hash baris sumber</dt><dd class="mono tiny truncate">${ui.esc(agent.sourceRowHash || '—')}</dd>
          <dt>Dibuat</dt><dd>${ui.dateTime(agent.createdAt)} oleh ${ui.esc(agent.createdBy || '—')}</dd>
          <dt>Diperbarui</dt><dd>${ui.dateTime(agent.updatedAt)} oleh ${ui.esc(agent.updatedBy || '—')}</dd>
        </dl>
      </div>
    </section>
    <style>@media (max-width: 1100px){.detail-grid{grid-template-columns:1fr !important}}</style>`;

  el.innerHTML = ctx.shell(content, { title: 'Master Agent', subtitle: agent.kodeagen });
  document.getElementById('edit-agent')?.addEventListener('click', () => {
    agentForm(ctx, agent, async () => { await renderDetail(el, ctx, agentId); });
  });
}

// ---------------------------------------------------------------- form
function agentForm(ctx, existing, onDone) {
  const isEdit = Boolean(existing?.agentIdInternal);
  const body = `
    <div class="stack">
      ${existing?.kodeagen && !isEdit
        ? `<div class="field"><label class="label">Kode Agen</label>
             <input class="input mono" id="f-kodeagen" value="${ui.esc(existing.kodeagen)}" readonly /></div>`
        : `<div class="field"><label class="label" for="f-kodeagen">Kode Agen<span class="req">*</span></label>
             <input class="input mono" id="f-kodeagen" name="kodeagen" required maxlength="100"
               value="${ui.esc(existing?.kodeagen || '')}" placeholder="AGT001" /></div>`}
      <div class="field"><label class="label" for="f-agent-source">Agent ID Source</label>
        <input class="input mono" id="f-agent-source" name="agentIdSource" maxlength="100"
          value="${ui.esc(existing?.agentIdSource || '')}" placeholder="ID dari sistem sumber" /></div>
      <div class="field"><label class="label" for="f-nama">Nama Agent<span class="req">*</span></label>
        <input class="input" id="f-nama" name="namaAgent" required maxlength="200" value="${ui.esc(existing?.namaAgent || '')}" /></div>
      <div class="field"><label class="label" for="f-branch">Kode Cabang<span class="req">*</span></label>
        <input class="input mono" id="f-branch" name="branchCode" required maxlength="20"
          value="${ui.esc(existing?.branchCode || '')}" placeholder="JKT" /></div>
      <div class="field"><label class="label" for="f-status">Status</label>
        <select class="select" id="f-status" name="statusAgent">
          <option value="Active"${existing?.statusAgent !== 'Inactive' ? ' selected' : ''}>Active</option>
          <option value="Inactive"${existing?.statusAgent === 'Inactive' ? ' selected' : ''}>Inactive</option>
        </select></div>
      <div class="hint">Perubahan pada agent yang sudah ada disimpan sebagai versi baru dan dicatat di audit trail.</div>
    </div>`;

  ui.modal({
    title: isEdit ? 'Ubah agent' : 'Agent baru',
    body,
    confirmLabel: isEdit ? 'Simpan versi baru' : 'Buat agent',
    onConfirm: async (form) => {
      const values = ui.serializeForm(form);
      try {
        if (isEdit) {
          await api.updateAgent(existing.agentIdInternal, {
            namaAgent: values.namaAgent,
            branchCode: values.branchCode,
            statusAgent: values.statusAgent,
          });
          ui.toast('Agent diperbarui sebagai versi baru.', 'success');
        } else {
          await api.createAgent({
            kodeagen: values.kodeagen,
            agentIdSource: values.agentIdSource || undefined,
            namaAgent: values.namaAgent,
            branchCode: values.branchCode,
            statusAgent: values.statusAgent,
          });
          ui.toast('Agent dibuat.', 'success');
        }
        if (onDone) await onDone();
        return true;
      } catch (error) {
        ui.toast(error.message, 'danger');
        return false;
      }
    },
  });
}
