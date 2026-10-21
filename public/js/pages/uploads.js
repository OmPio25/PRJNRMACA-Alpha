import { api } from '../api.js';
import * as ui from '../ui.js';

const TYPE_LABEL = { AGENT: 'Agent', PRODUCTION: 'Produksi', CLAIM: 'Claim' };
const TYPE_TONE = { AGENT: 'accent', PRODUCTION: 'info', CLAIM: 'warning' };

export async function render(el, ctx) {
  const section = ctx.params[0];
  if (section === 'new') return renderNew(el, ctx);
  if (section) return renderDetail(el, ctx, section);
  return renderList(el, ctx);
}

// ---------------------------------------------------------------- daftar
async function renderList(el, ctx) {
  el.innerHTML = ctx.shell(ui.loadingTable(6), { title: 'Upload Data', subtitle: 'Riwayat batch, validasi, dan posting' });

  const state = { ...ctx.query, page: ctx.query.page || 1, pageSize: ctx.query.pageSize || 25 };
  const renderTable = async () => {
    const host = document.getElementById('upload-list');
    host.innerHTML = ui.loadingTable(5);
    try {
      const data = await api.listUploads(state);
      const rows = data.rows.map((batch) => `
        <tr>
          <td>
            <a class="strong" href="#/uploads/${encodeURIComponent(batch.uploadBatchId)}">${ui.esc(batch.originalFileName)}</a>
            <div class="cell-sub mono">${ui.esc(batch.uploadBatchId)}</div>
          </td>
          <td>${ui.pill(TYPE_LABEL[batch.uploadType] || batch.uploadType, TYPE_TONE[batch.uploadType] || 'neutral', { dot: false })}</td>
          <td>${ui.statusPill(batch.processingStatus)}</td>
          <td class="right num">${ui.int(batch.totalRows)}</td>
          <td class="right num">${ui.int(batch.newRows)}</td>
          <td class="right num">${ui.int(batch.duplicateRows)}</td>
          <td class="right num">${ui.int(batch.changedRows)}</td>
          <td class="right num">${ui.int(batch.rejectedRows)}</td>
          <td class="right num">${ui.int(batch.postedRows)}</td>
          <td class="nowrap">
            ${ui.esc(batch.uploadedByName || '—')}
            <div class="cell-sub">${ui.dateTime(batch.uploadedAt)}</div>
          </td>
          <td class="right"><a class="btn btn-secondary btn-sm" href="#/uploads/${encodeURIComponent(batch.uploadBatchId)}">Detail</a></td>
        </tr>`).join('');

      host.innerHTML = (rows ? `<div class="table-wrap"><table class="data">
          <thead><tr>
            <th>File</th><th>Jenis</th><th>Status</th>
            <th class="right">Total</th><th class="right">New</th><th class="right">Dup</th>
            <th class="right">Changed</th><th class="right">Reject</th><th class="right">Posted</th>
            <th>Diunggah</th><th></th>
          </tr></thead><tbody>${rows}</tbody></table></div>`
        : ui.emptyState({
            title: 'Belum ada batch upload',
            desc: 'Unggah file Agent, Produksi, atau Claim untuk memulai. Nama file boleh sama berulang kali — deduplikasi memakai isi data.',
            action: ctx.can('upload.create') ? '<a class="btn btn-primary" href="#/uploads/new">Upload sekarang</a>' : '',
          }))
        + ui.pagination(data);
    } catch (error) {
      host.innerHTML = ui.banner(error.message, 'danger');
    }
  };

  const content = `
    <div class="page-head">
      <div>
        <h1 class="page-title">Upload Data</h1>
        <p class="page-desc">Setiap file menjadi satu batch. Nama file hanya informasi audit;
          keputusan New/Duplicate/Changed diambil dari hash isi data setelah normalisasi.</p>
      </div>
      <div class="page-actions">
        ${ctx.can('upload.create') ? '<a class="btn btn-primary" href="#/uploads/new">Upload data</a>' : ''}
      </div>
    </div>
    <section class="card">
      <form class="filters" id="filter-form">
        <div class="field">
          <label class="label" for="f-type">Jenis</label>
          <select class="select" id="f-type" name="type">
            <option value="">Semua jenis</option>
            <option value="AGENT">Agent</option>
            <option value="PRODUCTION">Produksi</option>
            <option value="CLAIM">Claim</option>
          </select>
        </div>
        <div class="field">
          <label class="label" for="f-status">Status</label>
          <select class="select" id="f-status" name="status">
            <option value="">Semua status</option>
            ${['Uploaded', 'Validating', 'Ready for Review', 'Approved', 'Posted', 'Posted with Exceptions', 'Failed', 'Rejected', 'Cancelled']
              .map((s) => `<option value="${s}">${s}</option>`).join('')}
          </select>
        </div>
        <div class="field grow">
          <label class="label" for="f-q">Cari</label>
          <input class="input" id="f-q" name="q" placeholder="Nama file atau ID batch" />
        </div>
        <button class="btn btn-secondary" type="submit">Terapkan</button>
        <button class="btn btn-ghost" type="reset">Reset</button>
      </form>
      <div id="upload-list">${ui.loadingTable(5)}</div>
    </section>`;

  el.innerHTML = ctx.shell(content, { title: 'Upload Data', subtitle: 'Riwayat batch upload' });

  const form = document.getElementById('filter-form');
  for (const key of ['type', 'status', 'q']) {
    if (state[key]) form.querySelector(`[name="${key}"]`).value = state[key];
  }
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    state.type = form.type.value || undefined;
    state.status = form.status.value || undefined;
    state.q = form.q.value.trim() || undefined;
    state.page = 1;
    renderTable();
  });
  form.addEventListener('reset', () => {
    setTimeout(() => {
      state.type = undefined; state.status = undefined; state.q = undefined; state.page = 1;
      renderTable();
    }, 0);
  });
  document.getElementById('upload-list').addEventListener('click', (event) => {
    const btn = event.target.closest('.page-btn');
    if (!btn || btn.disabled) return;
    state.page = Number(btn.dataset.page);
    renderTable();
  });

  await renderTable();
}

// ---------------------------------------------------------------- wizard
async function renderNew(el, ctx) {
  const allowed = ctx.state.user.allowedUploadTypes?.length
    ? ctx.state.user.allowedUploadTypes
    : ['AGENT', 'PRODUCTION', 'CLAIM'];

  const content = `
    <div class="page-head">
      <div>
        <h1 class="page-title">Upload data baru</h1>
        <p class="page-desc">Pilih jenis data, unggah file, lalu validasi. Ringkasan per baris muncul sebelum posting.</p>
      </div>
      <div class="page-actions"><a class="btn btn-ghost" href="#/uploads">Batal</a></div>
    </div>
    <div class="steps" id="steps" style="margin-bottom:20px">
      <div class="step active" data-step="1"><span class="step-num">1</span>Pilih data &amp; file</div>
      <div class="step" data-step="2"><span class="step-num">2</span>Validasi</div>
      <div class="step" data-step="3"><span class="step-num">3</span>Review &amp; posting</div>
    </div>
    <section class="card" id="wizard-body"></section>`;

  el.innerHTML = ctx.shell(content, { title: 'Upload Data', subtitle: 'Upload baru' });
  const body = document.getElementById('wizard-body');

  const setStep = (n) => {
    document.querySelectorAll('.step').forEach((node) => {
      const step = Number(node.dataset.step);
      node.classList.toggle('active', step === n);
      node.classList.toggle('done', step < n);
    });
  };

  body.innerHTML = `
    <div class="card-head"><div>
      <div class="card-title">Langkah 1 — Pilih jenis data dan file</div>
      <div class="card-sub">Format yang diterima: .csv dan .xlsx (maksimal 10 MB)</div>
    </div></div>
    <div class="card-body stack">
      <div class="form-grid">
        <div class="field">
          <label class="label" for="upload-type">Jenis data<span class="req">*</span></label>
          <select class="select" id="upload-type">
            ${allowed.map((t) => `<option value="${t}">${TYPE_LABEL[t] || t}</option>`).join('')}
          </select>
          <div class="hint" id="type-hint"></div>
        </div>
        <div class="field">
          <label class="label" for="date-format">Format tanggal sumber</label>
          <select class="select" id="date-format">
            <option value="">Otomatis (ISO / tidak ambigu)</option>
            <option value="DD/MM/YYYY">DD/MM/YYYY (01/02/2026 → 1 Feb 2026)</option>
            <option value="MM/DD/YYYY">MM/DD/YYYY (01/02/2026 → 2 Jan 2026)</option>
            <option value="DD-MM-YYYY">DD-MM-YYYY</option>
          </select>
          <div class="hint">Tanggal ambigu ditolak bila format tidak ditentukan.</div>
        </div>
        <div class="field full">
          <label class="label" for="remarks">Catatan (opsional)</label>
          <input class="input" id="remarks" placeholder="Misal: upload produksi periode Oktober" />
        </div>
      </div>

      <div class="dropzone" id="dropzone" tabindex="0" role="button" aria-describedby="drop-hint">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#475467" stroke-width="1.6" aria-hidden="true">
          <path d="M12 16V4m0 0L7 9m5-5 5 5M4 20h16"/>
        </svg>
        <div class="dropzone-title">Tarik file ke sini atau klik untuk memilih</div>
        <div class="dropzone-hint" id="drop-hint">CSV atau XLSX, satu sheet, baris pertama adalah header</div>
        <input type="file" id="file-input" accept=".csv,.xlsx,.xls" class="sr-only" />
      </div>
      <div id="file-preview"></div>
      <div id="wizard-error"></div>
      <div class="row">
        <a class="btn btn-ghost btn-sm" id="template-link" href="${api.templateUrl('PRODUCTION')}">Unduh template CSV</a>
        <span class="spacer"></span>
        <button class="btn btn-primary" id="start-btn" disabled>Unggah &amp; validasi</button>
      </div>
    </div>`;

  const typeSelect = document.getElementById('upload-type');
  const dateFormat = document.getElementById('date-format');
  const fileInput = document.getElementById('file-input');
  const dropzone = document.getElementById('dropzone');
  const preview = document.getElementById('file-preview');
  const errorBox = document.getElementById('wizard-error');
  const startBtn = document.getElementById('start-btn');
  const templateLink = document.getElementById('template-link');
  let selectedFile = null;

  const typeHints = {
    AGENT: 'Kolom wajib: KODEAGEN. Business key agent memakai kode agen sumber.',
    PRODUCTION: 'Kolom wajib: PolicyNo, PolicyRiskID, EffectiveDate, TransactionType, Currency.',
    CLAIM: 'Kolom wajib: ClaimNo, PolicyNo, SettlementDate, Currency. Claim tanpa Claim No ditolak.',
  };
  const syncType = () => {
    document.getElementById('type-hint').textContent = typeHints[typeSelect.value] || '';
    templateLink.href = api.templateUrl(typeSelect.value);
  };
  typeSelect.addEventListener('change', syncType);
  syncType();

  const acceptFile = (file) => {
    errorBox.innerHTML = '';
    if (!file) return;
    if (!/\.(csv|xlsx|xls)$/i.test(file.name)) {
      errorBox.innerHTML = ui.banner('Format file harus .csv, .xlsx, atau .xls.', 'danger');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      errorBox.innerHTML = ui.banner('Ukuran file melebihi 10 MB.', 'danger');
      return;
    }
    selectedFile = file;
    preview.innerHTML = `<div class="file-chip">
      <span class="tag">${ui.esc(file.name.split('.').pop().toUpperCase())}</span>
      <div>
        <div class="strong">${ui.esc(file.name)}</div>
        <div class="small muted">${ui.int(Math.round(file.size / 1024))} KB</div>
      </div>
      <span class="spacer"></span>
      <button class="btn btn-ghost btn-sm" id="clear-file" type="button">Ganti file</button>
    </div>`;
    startBtn.disabled = false;
    document.getElementById('clear-file').addEventListener('click', () => {
      selectedFile = null;
      fileInput.value = '';
      preview.innerHTML = '';
      startBtn.disabled = true;
    });
  };

  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); fileInput.click(); }
  });
  fileInput.addEventListener('change', () => acceptFile(fileInput.files[0]));
  ['dragenter', 'dragover'].forEach((name) => dropzone.addEventListener(name, (event) => {
    event.preventDefault(); dropzone.classList.add('dragover');
  }));
  ['dragleave', 'drop'].forEach((name) => dropzone.addEventListener(name, (event) => {
    event.preventDefault(); dropzone.classList.remove('dragover');
  }));
  dropzone.addEventListener('drop', (event) => acceptFile(event.dataTransfer.files[0]));

  startBtn.addEventListener('click', async () => {
    if (!selectedFile) return;
    startBtn.disabled = true;
    startBtn.textContent = 'Mengunggah…';
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('uploadType', typeSelect.value);
      if (dateFormat.value) formData.append('dateFormat', dateFormat.value);
      const remarks = document.getElementById('remarks').value.trim();
      if (remarks) formData.append('remarks', remarks);

      const created = await api.createUpload(formData);
      const batchId = created.batch.uploadBatchId;
      setStep(2);
      body.innerHTML = `<div class="card-body stack">
        <div class="banner banner-info"><div>
          <div class="banner-title">File diterima</div>
          Hash isi file: <span class="mono">${ui.esc(created.batch.fileContentHash)}</span>
        </div></div>
        <div class="row"><div class="skeleton skeleton-line" style="width:180px"></div></div>
        <div class="small muted">Sistem sedang menormalisasi dan mengklasifikasikan baris…</div>
      </div>`;
      const result = await api.validateUpload(batchId);
      if (result.batch.processingStatus === 'Failed') {
        body.innerHTML = ui.banner(result.batch.remarks || 'Validasi gagal.', 'danger', { title: 'Batch gagal diproses' });
        return;
      }
      setStep(3);
      await renderReview(body, ctx, batchId, { fromWizard: true });
    } catch (error) {
      setStep(1);
      body.innerHTML = `<div class="card-body">${ui.banner(error.message, 'danger')}</div>`;
      startBtn.disabled = false;
      startBtn.textContent = 'Unggah & validasi';
    }
  });
}

async function renderReview(body, ctx, batchId, { fromWizard = false } = {}) {
  const data = await api.getUpload(batchId);
  const batch = data.batch;
  const summary = data.summary;
  const canApprove = batch.canApprove && ctx.can('upload.approve');
  const canPost = batch.canPost && ctx.can('upload.post');

  body.innerHTML = `
    <div class="card-head">
      <div>
        <div class="card-title">Ringkasan hasil upload</div>
        <div class="card-sub">${ui.esc(batch.originalFileName)} · ${ui.esc(TYPE_LABEL[batch.uploadType])} · ${ui.statusPill(batch.processingStatus)}</div>
      </div>
      <div class="spacer"></div>
      <a class="btn btn-secondary btn-sm" href="${api.rowExportUrl(batchId)}">Unduh hasil validasi (CSV)</a>
    </div>
    <div class="card-body stack">
      ${(data.duplicateFiles || []).length ? ui.banner(
        `File dengan isi identik sudah pernah diunggah (${data.duplicateFiles.map((f) => `${f.originalFileName} · ${ui.dateTime(f.uploadedAt)}`).join('; ')}). Keputusan tetap diambil per baris.`,
        'warning', { title: 'File identik terdeteksi' }) : ''}

      <div class="summary-grid">
        ${[
          ['Total', summary.totalRows, ''],
          ['New', summary.newRows, 'is-new'],
          ['Duplicate', summary.duplicateRows, 'is-dup'],
          ['Changed', summary.changedRows, 'is-changed'],
          ['Rejected', summary.rejectedRows, 'is-rejected'],
          ['Pending Mapping', summary.pendingMappingRows, 'is-pending'],
          ['Posted', summary.postedRows, 'is-posted'],
        ].map(([label, value, cls]) => `<div class="summary-tile ${cls}">
          <div class="label">${label}</div><div class="value">${ui.int(value)}</div></div>`).join('')}
      </div>

      <div class="row-wrap">
        ${canApprove ? '<button class="btn btn-primary" id="approve-btn">Setujui batch</button>' : ''}
        ${canPost ? `<button class="btn ${canApprove ? 'btn-secondary' : 'btn-primary'}" id="post-btn">Posting ke database inti</button>` : ''}
        ${batch.canReject && ctx.can('upload.approve') ? '<button class="btn btn-ghost" id="reject-btn">Tolak batch</button>' : ''}
        ${batch.canCancel && ctx.can('upload.cancel') ? '<button class="btn btn-ghost" id="cancel-btn">Batalkan batch</button>' : ''}
        <span class="spacer"></span>
        <a class="btn btn-ghost btn-sm" href="#/uploads/${encodeURIComponent(batchId)}">Buka detail batch</a>
      </div>
      <div id="action-msg"></div>
    </div>
    <div class="card-head" style="border-top:1px solid var(--border)">
      <div class="card-title">Hasil per baris</div>
      <div class="spacer"></div>
      <div class="segmented" id="row-filter">
        <button data-status="" aria-pressed="true">Semua</button>
        <button data-status="New" aria-pressed="false">New</button>
        <button data-status="Duplicate" aria-pressed="false">Duplicate</button>
        <button data-status="Changed" aria-pressed="false">Changed</button>
        <button data-status="Rejected" aria-pressed="false">Rejected</button>
        <button data-status="Pending Mapping" aria-pressed="false">Pending</button>
      </div>
    </div>
    <div id="row-list">${ui.loadingTable(4)}</div>`;

  const rowHost = document.getElementById('row-list');
  const state = { page: 1, pageSize: 15, status: undefined };

  const loadRows = async () => {
    rowHost.innerHTML = ui.loadingTable(4);
    try {
      const rows = await api.rows(batchId, state);
      const html = rows.rows.map((row) => `
        <tr>
          <td class="mono">${ui.int(row.sourceRowNumber)}</td>
          <td>${ui.statusPill(row.validationStatus)}${row.classification && row.classification !== row.validationStatus
            ? `<div class="cell-sub">Klasifikasi: ${ui.esc(row.classification)}</div>` : ''}</td>
          <td class="mono truncate" title="${ui.esc(row.businessKey || '')}">${ui.esc(row.businessKey || '—')}</td>
          <td class="small">${ui.esc(row.validationMessage || '—')}</td>
          <td class="mono small">${ui.esc(row.duplicateOfRecordId || row.postedRecordId || '—')}</td>
          <td class="right"><button class="btn btn-ghost btn-sm" data-row="${ui.esc(row.uploadRowId)}">Lihat</button></td>
        </tr>`).join('');
      rowHost.innerHTML = (html ? `<div class="table-wrap"><table class="data">
          <thead><tr><th>Baris</th><th>Status</th><th>Business key</th><th>Pesan validasi</th><th>Referensi record</th><th></th></tr></thead>
          <tbody>${html}</tbody></table></div>`
        : ui.emptyState({ title: 'Tidak ada baris', desc: 'Tidak ada baris dengan status ini.' }))
        + ui.pagination(rows);
      rowHost.querySelectorAll('[data-row]').forEach((button) => {
        button.addEventListener('click', () => showRow(batchId, button.dataset.row));
      });
      rowHost.querySelectorAll('.page-btn').forEach((button) => {
        if (button.disabled) return;
        button.addEventListener('click', () => { state.page = Number(button.dataset.page); loadRows(); });
      });
    } catch (error) {
      rowHost.innerHTML = ui.banner(error.message, 'danger');
    }
  };

  document.getElementById('row-filter').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-status]');
    if (!button) return;
    state.status = button.dataset.status || undefined;
    state.page = 1;
    document.querySelectorAll('#row-filter button').forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
    loadRows();
  });

  const message = document.getElementById('action-msg');
  const refresh = async () => {
    ui.toast('Status batch diperbarui.', 'success');
    await renderReview(body, ctx, batchId, { fromWizard });
  };

  document.getElementById('approve-btn')?.addEventListener('click', async () => {
    const reason = await ui.confirmDialog({
      title: 'Setujui batch',
      message: 'Batch akan berstatus Approved dan siap diposting ke database inti.',
      confirmLabel: 'Setujui', danger: false,
    });
    if (reason === null) return;
    try { await api.approveUpload(batchId, ''); await refresh(); } catch (error) { message.innerHTML = ui.banner(error.message, 'danger'); }
  });

  document.getElementById('post-btn')?.addEventListener('click', async () => {
    const ok = await ui.confirmDialog({
      title: 'Posting ke database inti',
      message: 'Baris New dan Changed akan masuk ke tabel inti. Data posted tidak dapat dihapus; koreksi dilakukan melalui transaksi koreksi atau pembatalan yang diaudit.',
      confirmLabel: 'Posting sekarang', danger: false,
    });
    if (ok === null) return;
    try {
      const result = await api.postUpload(batchId, '');
      ui.toast(`Posting selesai: ${result.summary.postedRows} baris posted.`, 'success');
      await renderReview(body, ctx, batchId, { fromWizard });
    } catch (error) {
      message.innerHTML = ui.banner(error.message, 'danger');
    }
  });

  document.getElementById('reject-btn')?.addEventListener('click', async () => {
    const reason = await ui.confirmDialog({
      title: 'Tolak batch', message: 'Batch ditolak dan tidak akan diposting. Data staging tetap tersimpan untuk audit.',
      confirmLabel: 'Tolak batch', requireReason: true, reasonLabel: 'Alasan penolakan',
    });
    if (reason === null) return;
    try { await api.rejectUpload(batchId, reason); await refresh(); } catch (error) { message.innerHTML = ui.banner(error.message, 'danger'); }
  });

  document.getElementById('cancel-btn')?.addEventListener('click', async () => {
    const reason = await ui.confirmDialog({
      title: 'Batalkan batch wizard', message: 'Batch dibatalkan. Tindakan ini tercatat pada audit trail.',
      confirmLabel: 'Batalkan batch', requireReason: true, reasonLabel: 'Alasan pembatalan',
    });
    if (reason === null) return;
    try { await api.cancelUpload(batchId, reason); await refresh(); } catch (error) { message.innerHTML = ui.banner(error.message, 'danger'); }
  });

  await loadRows();
  if (fromWizard) ui.toast('Validasi selesai. Periksa ringkasan sebelum posting.', 'success');
}

async function showRow(batchId, rowId) {
  const rows = await api.rows(batchId, { page: 1, pageSize: 200 });
  const row = rows.rows.find((item) => item.uploadRowId === rowId);
  if (!row) return;
  ui.modal({
    title: `Baris sumber #${row.sourceRowNumber}`,
    confirmLabel: 'Tutup', cancelLabel: '',
    body: `
      <div class="row-wrap">${ui.statusPill(row.validationStatus)}
        ${row.classification ? `<span class="tag">klasifikasi: ${ui.esc(row.classification)}</span>` : ''}
        ${row.duplicateOfRecordId ? `<span class="tag">duplikat dari: ${ui.esc(row.duplicateOfRecordId)}</span>` : ''}
        ${row.postedRecordId ? `<span class="tag">posted: ${ui.esc(row.postedRecordId)}</span>` : ''}
      </div>
      ${row.validationMessage ? ui.banner(row.validationMessage, row.validationStatus === 'Rejected' ? 'danger' : 'info') : ''}
      <div>
        <div class="label" style="margin-bottom:6px">Data mentah (staging)</div>
        <pre class="mono" style="background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:12px;overflow:auto;max-height:220px">${ui.esc(JSON.stringify(row.rawPayload, null, 2))}</pre>
      </div>
      <div>
        <div class="label" style="margin-bottom:6px">Hasil normalisasi</div>
        <pre class="mono" style="background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:12px;overflow:auto;max-height:220px">${ui.esc(JSON.stringify(row.normalizedPayload, null, 2))}</pre>
      </div>
      <div class="small muted">Business key: <span class="mono">${ui.esc(row.businessKey || '—')}</span><br/>
        Source row hash: <span class="mono">${ui.esc(row.sourceRowHash || '—')}</span></div>`,
  });
}

// ---------------------------------------------------------------- detail
async function renderDetail(el, ctx, batchId) {
  el.innerHTML = ctx.shell(ui.loadingTable(5), { title: 'Detail batch', subtitle: batchId });
  let data;
  try {
    data = await api.getUpload(batchId);
  } catch (error) {
    el.innerHTML = ctx.shell(`<div class="card"><div class="empty">
      <div class="empty-title">Batch tidak ditemukan</div>
      <div class="empty-desc">${ui.esc(error.message)}</div>
      <a class="btn btn-secondary" href="#/uploads">Kembali</a></div></div>`, { title: 'Detail batch' });
    return;
  }
  const batch = data.batch;

  const content = `
    <div class="page-head">
      <div>
        <div class="row gap-2">
          <h1 class="page-title">${ui.esc(batch.originalFileName)}</h1>
          ${ui.statusPill(batch.processingStatus)}
        </div>
        <p class="page-desc mono">${ui.esc(batch.uploadBatchId)} · ${ui.esc(TYPE_LABEL[batch.uploadType])} ·
          diunggah ${ui.dateTime(batch.uploadedAt)} oleh ${ui.esc(batch.uploadedByName || '—')}</p>
      </div>
      <div class="page-actions">
        <a class="btn btn-secondary" href="${api.fileUrl(batchId)}">Unduh file asli</a>
        <a class="btn btn-secondary" href="${api.rowExportUrl(batchId)}">Unduh hasil validasi</a>
        <a class="btn btn-ghost" href="#/uploads">Kembali</a>
      </div>
    </div>

    ${(data.duplicateFiles || []).length ? ui.banner(
      `Isi file identik dengan batch lain (${data.duplicateFiles.map((f) => f.uploadBatchId).join(', ')}). Nama file tidak dipakai sebagai dasar deduplikasi.`,
      'warning', { title: 'File identik' }) : ''}

    <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px;margin:16px 0" class="detail-grid">
      <section class="card">
        <div class="card-head"><div class="card-title">Ringkasan</div></div>
        <div class="card-body">
          <div class="summary-grid">
            ${[
              ['Total', data.summary.totalRows, ''],
              ['New', data.summary.newRows, 'is-new'],
              ['Duplicate', data.summary.duplicateRows, 'is-dup'],
              ['Changed', data.summary.changedRows, 'is-changed'],
              ['Rejected', data.summary.rejectedRows, 'is-rejected'],
              ['Pending Mapping', data.summary.pendingMappingRows, 'is-pending'],
              ['Posted', data.summary.postedRows, 'is-posted'],
            ].map(([label, value, cls]) => `<div class="summary-tile ${cls}">
              <div class="label">${label}</div><div class="value">${ui.int(value)}</div></div>`).join('')}
          </div>
          <div class="divider"></div>
          <dl class="dl">
            <dt>Hash isi file</dt><dd class="mono">${ui.esc(batch.fileContentHash)}</dd>
            <dt>Ukuran file</dt><dd>${ui.int(Math.round((batch.fileSizeBytes || 0) / 1024))} KB</dd>
            <dt>Format tanggal</dt><dd>${ui.esc(batch.dateFormat || 'Otomatis')}</dd>
            <dt>Versi konfigurasi hash</dt><dd class="mono">${ui.esc(batch.hashConfigVersion || '—')}</dd>
            <dt>Diproses</dt><dd>${ui.dateTime(batch.processedAt)}</dd>
            <dt>Disetujui</dt><dd>${batch.approvedAt ? `${ui.dateTime(batch.approvedAt)} · ${ui.esc(batch.approvedByName || batch.approvedBy || '')}` : '—'}</dd>
            <dt>Catatan</dt><dd>${ui.esc(batch.remarks || batch.rejectionReason || batch.cancellationReason || '—')}</dd>
          </dl>
        </div>
        <div class="card-foot">
          ${batch.canValidate && ctx.can('upload.create') ? '<button class="btn btn-secondary" id="d-validate">Validasi ulang</button>' : ''}
          ${batch.canApprove && ctx.can('upload.approve') ? '<button class="btn btn-primary" id="d-approve">Setujui</button>' : ''}
          ${batch.canPost && ctx.can('upload.post') ? '<button class="btn btn-primary" id="d-post">Posting</button>' : ''}
          ${batch.canReject && ctx.can('upload.approve') ? '<button class="btn btn-ghost" id="d-reject">Tolak</button>' : ''}
          ${batch.canCancel && ctx.can('upload.cancel') ? '<button class="btn btn-ghost" id="d-cancel">Batalkan</button>' : ''}
        </div>
      </section>
      <section class="card">
        <div class="card-head"><div class="card-title">Jejak audit</div></div>
        <div class="card-body stack small">
          <div><span class="muted">Dibuat</span><br/>${ui.dateTime(batch.uploadedAt)} · ${ui.esc(batch.uploadedByName || '—')}</div>
          <div><span class="muted">Diproses</span><br/>${ui.dateTime(batch.processedAt)}</div>
          <div><span class="muted">Approval</span><br/>${batch.approvedAt ? ui.dateTime(batch.approvedAt) : 'Belum disetujui'}</div>
          <div><span class="muted">Status akhir</span><br/>${ui.statusPill(batch.processingStatus)}</div>
          <a class="btn btn-ghost btn-sm" href="#/audit?entityType=UPLOAD_BATCH&entityId=${encodeURIComponent(batchId)}">Lihat audit trail batch</a>
        </div>
      </section>
    </div>

    <section class="card">
      <div class="card-head">
        <div class="card-title">Hasil per baris</div>
        <div class="spacer"></div>
        <div class="segmented" id="d-row-filter">
          <button data-status="" aria-pressed="true">Semua</button>
          <button data-status="New" aria-pressed="false">New</button>
          <button data-status="Duplicate" aria-pressed="false">Duplicate</button>
          <button data-status="Changed" aria-pressed="false">Changed</button>
          <button data-status="Rejected" aria-pressed="false">Rejected</button>
          <button data-status="Pending Mapping" aria-pressed="false">Pending</button>
          <button data-status="Posted" aria-pressed="false">Posted</button>
        </div>
      </div>
      <div id="d-row-list">${ui.loadingTable(5)}</div>
    </section>
    <style>@media(max-width:1100px){.detail-grid{grid-template-columns:1fr !important}}</style>`;

  el.innerHTML = ctx.shell(content, { title: 'Detail batch', subtitle: batch.uploadBatchId });

  const rowState = { page: 1, pageSize: 20, status: undefined };
  const rowHost = document.getElementById('d-row-list');
  const loadRows = async () => {
    rowHost.innerHTML = ui.loadingTable(5);
    const rows = await api.rows(batchId, rowState);
    const html = rows.rows.map((row) => `
      <tr>
        <td class="mono">${ui.int(row.sourceRowNumber)}</td>
        <td>${ui.statusPill(row.validationStatus)}</td>
        <td class="mono truncate" title="${ui.esc(row.businessKey || '')}">${ui.esc(row.businessKey || '—')}</td>
        <td class="small">${ui.esc(row.validationMessage || '—')}</td>
        <td class="small mono">${ui.esc(row.duplicateOfRecordId || row.postedRecordId || '—')}</td>
        <td class="right"><button class="btn btn-ghost btn-sm" data-row="${ui.esc(row.uploadRowId)}">Lihat</button></td>
      </tr>`).join('');
    rowHost.innerHTML = (html ? `<div class="table-wrap"><table class="data">
      <thead><tr><th>Baris</th><th>Status</th><th>Business key</th><th>Pesan</th><th>Referensi</th><th></th></tr></thead>
      <tbody>${html}</tbody></table></div>` : ui.emptyState({ title: 'Tidak ada baris', desc: 'Tidak ada baris dengan status ini.' }))
      + ui.pagination(rows);
    rowHost.querySelectorAll('[data-row]').forEach((button) => {
      button.addEventListener('click', () => showRow(batchId, button.dataset.row));
    });
    rowHost.querySelectorAll('.page-btn').forEach((button) => {
      if (button.disabled) return;
      button.addEventListener('click', () => { rowState.page = Number(button.dataset.page); loadRows(); });
    });
  };

  document.getElementById('d-row-filter').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-status]');
    if (!button) return;
    rowState.status = button.dataset.status || undefined;
    rowState.page = 1;
    document.querySelectorAll('#d-row-filter button').forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
    loadRows();
  });

  const act = (id, handler) => document.getElementById(id)?.addEventListener('click', handler);
  const reload = async () => { await renderDetail(el, ctx, batchId); };

  act('d-validate', async () => { try { await api.validateUpload(batchId); ui.toast('Validasi dijalankan ulang.', 'success'); await reload(); } catch (e) { ui.toast(e.message, 'danger'); } });
  act('d-approve', async () => {
    if (await ui.confirmDialog({ title: 'Setujui batch', message: 'Batch akan disetujui untuk posting.', confirmLabel: 'Setujui', danger: false }) === null) return;
    try { await api.approveUpload(batchId, ''); await reload(); } catch (e) { ui.toast(e.message, 'danger'); }
  });
  act('d-post', async () => {
    if (await ui.confirmDialog({ title: 'Posting batch', message: 'Baris valid akan masuk ke tabel inti. Tindakan tercatat pada audit trail.', confirmLabel: 'Posting', danger: false }) === null) return;
    try { const r = await api.postUpload(batchId, ''); ui.toast(`${r.summary.postedRows} baris posted.`, 'success'); await reload(); } catch (e) { ui.toast(e.message, 'danger'); }
  });
  act('d-reject', async () => {
    const reason = await ui.confirmDialog({ title: 'Tolak batch', message: 'Batch tidak akan diposting.', confirmLabel: 'Tolak', requireReason: true, reasonLabel: 'Alasan penolakan' });
    if (reason === null) return;
    try { await api.rejectUpload(batchId, reason); await reload(); } catch (e) { ui.toast(e.message, 'danger'); }
  });
  act('d-cancel', async () => {
    const reason = await ui.confirmDialog({ title: 'Batalkan batch', message: 'Batch dibatalkan dan tidak dapat diposting.', confirmLabel: 'Batalkan', requireReason: true, reasonLabel: 'Alasan pembatalan' });
    if (reason === null) return;
    try { await api.cancelUpload(batchId, reason); await reload(); } catch (e) { ui.toast(e.message, 'danger'); }
  });

  await loadRows();
}
