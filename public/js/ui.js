// Komponen & utilitas UI. Tanpa framework: HTML aman + event delegation.

export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const numberFmt = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 });
const intFmt = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });
const dateFmt = new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('id-ID', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

export function num(value) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  return Number.isFinite(n) ? numberFmt.format(n) : esc(value);
}

export function int(value) {
  if (value === null || value === undefined || value === '') return '0';
  const n = Number(value);
  return Number.isFinite(n) ? intFmt.format(n) : esc(value);
}

export function money(value, currency, { compactZero = false } = {}) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return esc(value);
  if (compactZero && n === 0) return '—';
  const text = numberFmt.format(n);
  const symbols = { IDR: 'Rp', USD: 'US$' };
  const symbol = symbols[currency] || (currency ? `${currency} ` : '');
  return `${symbol}${text}`;
}

export function date(value) {
  if (!value) return '—';
  const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return esc(value);
  return dateFmt.format(parsed);
}

export function dateTime(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return esc(value);
  return dateTimeFmt.format(parsed);
}

export function fmtCell(column, row) {
  const value = row[column.key];
  if (value === null || value === undefined || value === '') return '<span class="faint">—</span>';
  switch (column.type) {
    case 'number': return `<span class="num">${int(value)}</span>`;
    case 'currency': return `<span class="num">${esc(money(value, row.currency))}</span>`;
    case 'date': return esc(date(value));
    default: return esc(value);
  }
}

export function pill(text, tone = 'neutral', { dot = true } = {}) {
  const label = String(text ?? '—');
  return `<span class="pill pill-${tone}${dot ? '' : ' no-dot'}">${esc(label)}</span>`;
}

const STATUS_TONES = {
  Uploaded: 'neutral',
  Validating: 'info',
  'Ready for Review': 'warning',
  Approved: 'info',
  Posted: 'success',
  'Posted with Exceptions': 'warning',
  Failed: 'danger',
  Rejected: 'danger',
  Cancelled: 'neutral',
  New: 'info',
  Duplicate: 'neutral',
  Changed: 'warning',
  'Pending Mapping': 'info',
  Active: 'success',
  Inactive: 'neutral',
  Settled: 'success',
  Open: 'warning',
};

export function statusPill(status) {
  return pill(status, STATUS_TONES[status] || 'neutral');
}

export function tableColumns(columns, rows, { actions = null, empty = null } = {}) {
  if (!rows || rows.length === 0) {
    return empty || emptyState({ title: 'Belum ada data', desc: 'Tidak ada baris yang cocok dengan filter saat ini.' });
  }
  const head = columns.map((c) =>
    `<th scope="col" class="${c.align === 'right' ? 'right' : ''}">${esc(c.label)}</th>`).join('');
  const body = rows.map((row) => {
    const cells = columns.map((c) => {
      const content = c.render ? c.render(row) : fmtCell(c, row);
      return `<td class="${c.align === 'right' ? 'right' : ''}">${content}</td>`;
    }).join('');
    const actionCell = actions ? `<td class="right"><div class="table-actions">${actions(row)}</div></td>` : '';
    return `<tr>${cells}${actionCell}</tr>`;
  }).join('');
  return `
    <div class="table-wrap">
      <table class="data">
        <thead><tr>${head}${actions ? '<th scope="col" class="right">Aksi</th>' : ''}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

export function emptyState({ title, desc, action = '' } = {}) {
  return `
    <div class="empty">
      <div class="empty-icon" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
          <rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16"/>
        </svg>
      </div>
      <div class="empty-title">${esc(title || 'Belum ada data')}</div>
      <div class="empty-desc">${esc(desc || '')}</div>
      ${action}
    </div>`;
}

export function loadingTable(rows = 6) {
  return `<div style="padding:16px 20px">${
    Array.from({ length: rows }).map(() => '<div class="skeleton skeleton-row"></div>').join('')
  }</div>`;
}

export function pagination({ page = 1, pageSize = 25, total = 0, totalPages = 1 } = {}) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const pages = [];
  const maxButtons = 5;
  let start = Math.max(1, page - Math.floor(maxButtons / 2));
  const end = Math.min(totalPages || 1, start + maxButtons - 1);
  start = Math.max(1, end - maxButtons + 1);
  for (let p = start; p <= end; p += 1) {
    pages.push(`<button class="page-btn" data-page="${p}" ${p === page ? 'aria-current="true"' : ''}>${p}</button>`);
  }
  return `
    <div class="pagination">
      <span>Menampilkan ${int(from)}–${int(to)} dari ${int(total)} baris</span>
      <div class="pages">
        <button class="page-btn" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''} aria-label="Halaman sebelumnya">‹</button>
        ${pages.join('')}
        <button class="page-btn" data-page="${page + 1}" ${page >= (totalPages || 1) ? 'disabled' : ''} aria-label="Halaman berikutnya">›</button>
      </div>
    </div>`;
}

export function toast(message, tone = 'default', timeout = 4200) {
  const stack = document.getElementById('toast-stack');
  if (!stack) return;
  const node = document.createElement('div');
  node.className = `toast toast-${tone}`;
  node.textContent = message;
  stack.appendChild(node);
  setTimeout(() => node.remove(), timeout);
}

export function banner(text, tone = 'info', { title = '' } = {}) {
  return `<div class="banner banner-${tone}">
    <div>${title ? `<div class="banner-title">${esc(title)}</div>` : ''}<div>${esc(text)}</div></div>
  </div>`;
}

export function modal({ title, body, confirmLabel = 'Simpan', cancelLabel = 'Batal', danger = false, onConfirm }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'modal';
  dialog.setAttribute('aria-labelledby', 'modal-title');
  dialog.innerHTML = `
    <form method="dialog" novalidate>
      <div class="modal-head"><h2 class="card-title" id="modal-title">${esc(title)}</h2></div>
      <div class="modal-body">${body}</div>
      <div class="modal-foot">
        <button class="btn btn-secondary" value="cancel" type="submit">${esc(cancelLabel)}</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" value="confirm" type="submit">${esc(confirmLabel)}</button>
      </div>
    </form>`;
  document.body.appendChild(dialog);
  dialog.showModal();
  dialog.addEventListener('close', async () => {
    const shouldConfirm = dialog.returnValue === 'confirm';
    const form = dialog.querySelector('form');
    if (shouldConfirm && onConfirm) {
      const result = await onConfirm(form, dialog);
      if (result === false) {
        // Form method="dialog" sudah menutup dialog; buka kembali agar pesan
        // validasi tetap terlihat dan elemen tidak tertinggal di DOM.
        dialog.returnValue = '';
        dialog.showModal();
        return;
      }
    }
    dialog.remove();
  });
  return dialog;
}

export function confirmDialog({ title, message, confirmLabel = 'Lanjutkan', danger = true, requireReason = false, reasonLabel = 'Alasan' }) {
  return new Promise((resolve) => {
    let answered = false;
    const body = `
      <p class="muted">${esc(message)}</p>
      ${requireReason ? `<div class="field"><label class="label" for="reason-input">${esc(reasonLabel)}<span class="req">*</span></label>
        <textarea class="textarea" id="reason-input" rows="3" required></textarea>
        <div class="hint">Alasan disimpan pada audit trail.</div></div>` : ''}`;
    const dialog = modal({
      title, body, confirmLabel, danger,
      onConfirm: (form) => {
        const reason = requireReason ? form.querySelector('#reason-input').value.trim() : '';
        if (requireReason && reason.length < 3) {
          form.querySelector('#reason-input').setAttribute('aria-invalid', 'true');
          toast('Alasan wajib diisi minimal 3 karakter.', 'danger');
          return false;
        }
        answered = true;
        resolve(reason);
        return true;
      },
    });
    dialog.addEventListener('close', () => {
      if (!answered) resolve(null);
    });
  });
}

export function debounce(fn, wait = 320) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export function readFilters(form) {
  const data = {};
  const formData = new FormData(form);
  for (const [key, value] of formData.entries()) {
    if (typeof value === 'string' && value.trim() !== '') data[key] = value.trim();
  }
  return data;
}

export function chartBars(items, { valueKey = 'value', labelKey = 'label', money: useMoney = false, currency = 'IDR' } = {}) {
  if (!items || items.length === 0) {
    return `<div class="faint small">Tidak ada nominal untuk ditampilkan.</div>`;
  }
  const max = Math.max(...items.map((item) => Number(item[valueKey]) || 0), 1);
  return `<div class="chart-bars">${items.map((item) => {
    const value = Number(item[valueKey]) || 0;
    const width = Math.max(2, Math.round((value / max) * 100));
    return `<div class="chart-row">
      <span class="small">${esc(item[labelKey])}</span>
      <div class="chart-track"><div class="chart-fill" style="width:${width}%"></div></div>
      <span class="chart-value">${esc(useMoney ? money(value, item.currency || currency) : int(value))}</span>
    </div>`;
  }).join('')}</div>`;
}

export function kpi({ label, value, foot = '', color = 'var(--primary)' }) {
  return `<div class="kpi" style="--kpi-color:${color}">
    <div class="kpi-label">${esc(label)}</div>
    <div class="kpi-value">${value}</div>
    ${foot ? `<div class="kpi-foot">${foot}</div>` : ''}
  </div>`;
}

export function serializeForm(form) {
  const data = {};
  for (const [key, value] of new FormData(form).entries()) {
    if (typeof value === 'string') data[key] = value.trim();
  }
  return data;
}

export function download(url) {
  const link = document.createElement('a');
  link.href = url;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}
