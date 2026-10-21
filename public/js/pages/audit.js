import { api } from '../api.js';
import * as ui from '../ui.js';

const ENTITY_TYPES = ['UPLOAD_BATCH', 'AGENT', 'PRODUCTION', 'CLAIM', 'SETTLEMENT', 'USER', 'ROLE', 'BUSINESS_RULE', 'EXCHANGE_RATE', 'HASH_CONFIG', 'MASTER_BRANCH', 'MASTER_PRODUCT'];

export async function render(el, ctx) {
  el.innerHTML = ctx.shell(ui.loadingTable(7), { title: 'Audit Trail', subtitle: 'Jejak perubahan dan traceability' });

  const state = { ...ctx.query, page: ctx.query.page || 1, pageSize: ctx.query.pageSize || 25 };

  const content = `
    <div class="page-head">
      <div>
        <h1 class="page-title">Audit Trail</h1>
        <p class="page-desc">Setiap aksi penting tercatat: siapa, kapan, pada record apa, nilai sebelum dan sesudah.
          Gunakan traceability untuk menelusuri angka laporan sampai baris file upload.</p>
      </div>
    </div>

    <section class="card" style="margin-bottom:16px">
      <div class="card-head"><div>
        <div class="card-title">Traceability record</div>
        <div class="card-sub">Telusuri satu record ke batch upload, baris sumber, dan pengunggahnya.</div>
      </div></div>
      <form class="filters" id="trace-form">
        <div class="field">
          <label class="label" for="t-type">Jenis record</label>
          <select class="select" id="t-type" name="recordType">
            <option value="PRODUCTION">Produksi</option>
            <option value="CLAIM">Claim</option>
            <option value="SETTLEMENT">Settlement</option>
            <option value="AGENT">Agent</option>
          </select>
        </div>
        <div class="field grow">
          <label class="label" for="t-id">Record ID</label>
          <input class="input mono" id="t-id" name="recordId" placeholder="PRD-0001 / CLM-2026-0001 / STL-0001 / AGT-001" />
        </div>
        <button class="btn btn-secondary" type="submit">Telusuri</button>
      </form>
      <div id="trace-output" style="padding:0 16px 16px"></div>
    </section>

    <section class="card">
      <form class="filters" id="filter-form">
        <div class="field">
          <label class="label" for="f-entity">Entity type</label>
          <select class="select" id="f-entity" name="entityType">
            <option value="">Semua</option>
            ${ENTITY_TYPES.map((type) => `<option value="${type}">${type}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label class="label" for="f-entity-id">Entity ID</label>
          <input class="input mono" id="f-entity-id" name="entityId" placeholder="PRD-0001" /></div>
        <div class="field"><label class="label" for="f-action">Aksi</label>
          <input class="input" id="f-action" name="action" placeholder="POST / CANCEL / CREATE" /></div>
        <div class="field"><label class="label" for="f-from">Dari</label>
          <input class="input" type="date" id="f-from" name="from" /></div>
        <div class="field"><label class="label" for="f-to">Sampai</label>
          <input class="input" type="date" id="f-to" name="to" /></div>
        <button class="btn btn-secondary" type="submit">Terapkan</button>
        <button class="btn btn-ghost" type="reset">Reset</button>
      </form>
      <div id="audit-list">${ui.loadingTable(7)}</div>
    </section>`;

  el.innerHTML = ctx.shell(content, { title: 'Audit Trail', subtitle: 'Riwayat aksi' });

  const form = document.getElementById('filter-form');
  for (const key of ['entityType', 'entityId', 'action', 'from', 'to']) {
    if (state[key]) {
      const field = form.querySelector(`[name="${key}"]`);
      if (field) field.value = state[key];
    }
  }

  const host = document.getElementById('audit-list');
  const renderTable = async () => {
    host.innerHTML = ui.loadingTable(6);
    try {
      const data = await api.listAudit(state);
      const rows = data.rows.map((entry) => `
        <tr>
          <td class="nowrap">${ui.dateTime(entry.occurredAt)}</td>
          <td><span class="tag mono">${ui.esc(entry.entityType)}</span></td>
          <td class="mono tiny">${ui.esc(entry.entityId)}</td>
          <td><span class="pill pill-info no-dot">${ui.esc(entry.action)}</span></td>
          <td>${ui.esc(entry.actorName || '—')}<div class="cell-sub mono">${ui.esc(entry.actorRole || '')}</div></td>
          <td class="mono tiny">${entry.uploadBatchId
            ? `<a href="#/uploads/${encodeURIComponent(entry.uploadBatchId)}">${ui.esc(entry.uploadBatchId)}</a>` : '—'}</td>
          <td class="truncate" style="max-width:260px">${ui.esc(entry.reason || '—')}</td>
          <td class="right"><button class="btn btn-ghost btn-sm" data-audit="${ui.esc(entry.auditId)}">Lihat</button></td>
        </tr>`).join('');

      host.innerHTML = (rows ? `<div class="table-wrap"><table class="data">
        <thead><tr><th>Waktu</th><th>Entity</th><th>ID</th><th>Aksi</th><th>Aktor</th><th>Batch</th><th>Alasan</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table></div>`
        : ui.emptyState({ title: 'Belum ada entri audit', desc: 'Aktivitas upload, perubahan data, dan pembatalan akan muncul di sini.' }))
        + ui.pagination(data);

      host.querySelectorAll('[data-audit]').forEach((button) => {
        button.addEventListener('click', () => {
          const entry = data.rows.find((row) => row.auditId === button.getAttribute('data-audit'));
          if (entry) showEntry(entry);
        });
      });
    } catch (error) {
      host.innerHTML = ui.banner(error.message, 'danger');
    }
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    for (const key of ['entityType', 'entityId', 'action', 'from', 'to']) {
      state[key] = form[key].value.trim() || undefined;
    }
    state.page = 1;
    renderTable();
  });
  form.addEventListener('reset', () => {
    setTimeout(() => {
      for (const key of ['entityType', 'entityId', 'action', 'from', 'to']) state[key] = undefined;
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

  const traceForm = document.getElementById('trace-form');
  const traceOutput = document.getElementById('trace-output');
  traceForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const recordType = traceForm.recordType.value;
    const recordId = traceForm.recordId.value.trim();
    if (!recordId) {
      ui.toast('Record ID wajib diisi.', 'danger');
      return;
    }
    traceOutput.innerHTML = ui.loadingTable(2);
    try {
      const trace = await api.trace(recordType, recordId);
      traceOutput.innerHTML = renderTrace(trace);
    } catch (error) {
      traceOutput.innerHTML = ui.banner(error.message, 'danger');
    }
  });

  await renderTable();
}

function pretty(value) {
  if (value === null || value === undefined) return '<span class="faint">—</span>';
  return `<pre class="mono tiny" style="white-space:pre-wrap;margin:0;max-height:240px;overflow:auto">${ui.esc(JSON.stringify(value, null, 2))}</pre>`;
}

function showEntry(entry) {
  ui.modal({
    title: `${entry.entityType} · ${entry.action}`,
    confirmLabel: 'Tutup',
    cancelLabel: '',
    body: `
      <dl class="dl">
        <dt>Audit ID</dt><dd class="mono">${ui.esc(entry.auditId)}</dd>
        <dt>Entity</dt><dd class="mono">${ui.esc(entry.entityType)} / ${ui.esc(entry.entityId)}</dd>
        <dt>Waktu</dt><dd>${ui.dateTime(entry.occurredAt)}</dd>
        <dt>Aktor</dt><dd>${ui.esc(entry.actorName || '—')} (${ui.esc(entry.actorRole || '—')})</dd>
        <dt>Batch upload</dt><dd class="mono">${ui.esc(entry.uploadBatchId || '—')}</dd>
        <dt>Alasan</dt><dd>${ui.esc(entry.reason || '—')}</dd>
      </dl>
      <div class="divider"></div>
      <div class="stack">
        <div><div class="label">Sebelum</div>${pretty(entry.before)}</div>
        <div><div class="label">Sesudah</div>${pretty(entry.after)}</div>
      </div>`,
    onConfirm: () => true,
  });
}

function renderTrace(trace) {
  const record = trace.record || {};
  const keys = Object.keys(record).slice(0, 14);
  const row = trace.uploadRow;
  const batch = trace.batch;
  return `
    <div class="summary-grid" style="margin-bottom:12px">
      <div class="summary-tile"><div class="label">Record</div><div class="value mono small">${ui.esc(record.productionId || record.claimId || record.claimSettlementId || record.agentIdInternal || trace.recordType)}</div></div>
      <div class="summary-tile"><div class="label">Jenis</div><div class="value">${ui.esc(trace.recordType)}</div></div>
      <div class="summary-tile"><div class="label">Batch upload</div><div class="value mono small">${batch ? ui.esc(batch.uploadBatchId) : '—'}</div></div>
      <div class="summary-tile"><div class="label">Baris sumber</div><div class="value num">${row ? ui.int(row.sourceRowNumber) : '—'}</div></div>
      <div class="summary-tile"><div class="label">Diunggah oleh</div><div class="value small">${ui.esc(trace.actor?.fullName || '—')}</div></div>
      <div class="summary-tile"><div class="label">Waktu upload</div><div class="value small">${batch ? ui.dateTime(batch.uploadedAt) : '—'}</div></div>
      <div class="summary-tile"><div class="label">Hash baris</div><div class="value mono tiny truncate">${ui.esc(row?.sourceRowHash || '—')}</div></div>
    </div>
    ${batch ? `<div class="row-wrap" style="margin-bottom:12px">
      <span class="tag">File: ${ui.esc(batch.originalFileName)}</span>
      <span class="tag">Jenis: ${ui.esc(batch.uploadType)}</span>
      <span class="tag">Status: ${ui.esc(batch.processingStatus)}</span>
      <a class="btn btn-secondary btn-sm" href="#/uploads/${encodeURIComponent(batch.uploadBatchId)}">Buka batch</a>
    </div>` : ''}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px" class="trace-grid">
      <div><div class="label">Record</div>${pretty(keys.length ? Object.fromEntries(keys.map((key) => [key, record[key]])) : record)}</div>
      <div><div class="label">Baris upload</div>${pretty(row ? {
        sourceRowNumber: row.sourceRowNumber,
        validationStatus: row.validationStatus,
        businessKey: row.businessKey,
        sourceRowHash: row.sourceRowHash,
        normalizedPayload: row.normalizedPayload,
      } : null)}</div>
    </div>
    <style>@media (max-width: 900px){.trace-grid{grid-template-columns:1fr !important}}</style>`;
}
