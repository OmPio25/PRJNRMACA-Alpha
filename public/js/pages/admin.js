import { api } from '../api.js';
import * as ui from '../ui.js';

const MASTER_KINDS = [
  { key: 'branches', label: 'Cabang', codeKey: 'branchCode', nameKey: 'branchName' },
  { key: 'products', label: 'Produk', codeKey: 'productCode', nameKey: 'productName' },
  { key: 'coverages', label: 'Coverage', codeKey: 'coverageCode', nameKey: 'coverageName' },
  { key: 'currencies', label: 'Currency', codeKey: 'currencyCode', nameKey: 'currencyName' },
  { key: 'causes-of-loss', label: 'Cause of Loss', codeKey: 'causeCode', nameKey: 'causeName' },
];

const UPLOAD_TYPES = ['AGENT', 'PRODUCTION', 'CLAIM'];
const RATE_TYPES = ['MID', 'BUY', 'SELL', 'CENTRAL_BANK', 'CONTRACTUAL'];

export async function render(el, ctx) {
  const tabs = [];
  if (ctx.can('admin.users')) tabs.push({ key: 'users', label: 'Pengguna & Role', load: renderUsers });
  if (ctx.can('admin.master')) tabs.push({ key: 'master', label: 'Master Data', load: renderMasters });
  if (ctx.can('admin.rules')) tabs.push({ key: 'rates', label: 'Kurs', load: renderRates });
  if (ctx.can('admin.rules')) tabs.push({ key: 'rules', label: 'Business Rules', load: renderRules });
  if (ctx.can('admin.hash')) tabs.push({ key: 'hash', label: 'Hash Config', load: renderHashConfigs });

  if (tabs.length === 0) {
    el.innerHTML = ctx.shell(`<div class="card"><div class="empty">
      <div class="empty-title">Akses ditolak</div>
      <div class="empty-desc">Peran Anda tidak memiliki izin administrasi.</div></div></div>`, { title: 'Pengaturan' });
    return;
  }

  const active = tabs.some((tab) => tab.key === ctx.query.tab) ? ctx.query.tab : tabs[0].key;

  const content = `
    <div class="page-head">
      <div>
        <h1 class="page-title">Pengaturan</h1>
        <p class="page-desc">Kelola pengguna, hak akses, master data, kurs resmi, aturan bisnis, dan konfigurasi
          hash. Perubahan tercatat di audit trail.</p>
      </div>
    </div>
    <div class="tabs" role="tablist" aria-label="Bagian pengaturan" style="margin-bottom:16px">
      ${tabs.map((tab) => `<button class="tab" role="tab" data-admin-tab="${tab.key}"
        aria-selected="${tab.key === active}">${ui.esc(tab.label)}</button>`).join('')}
    </div>
    <div id="admin-body">${ui.loadingTable(6)}</div>`;

  el.innerHTML = ctx.shell(content, { title: 'Pengaturan', subtitle: 'Administrasi' });

  const body = document.getElementById('admin-body');
  const load = async (key) => {
    const tab = tabs.find((item) => item.key === key) || tabs[0];
    document.querySelectorAll('[data-admin-tab]').forEach((button) => {
      button.setAttribute('aria-selected', String(button.getAttribute('data-admin-tab') === tab.key));
    });
    body.innerHTML = ui.loadingTable(6);
    try {
      await tab.load(body, ctx);
    } catch (error) {
      body.innerHTML = ui.banner(error.message, 'danger');
    }
  };

  document.querySelectorAll('[data-admin-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.getAttribute('data-admin-tab');
      const url = new URL(window.location.href);
      const base = url.hash.split('?')[0];
      window.history.replaceState(null, '', `${base}?tab=${key}`);
      load(key);
    });
  });

  await load(active);
}

// ---------------------------------------------------------------- users
async function renderUsers(host, ctx) {
  const [users, roles] = await Promise.all([api.listUsers(), api.roles()]);
  const roleOptions = roles.roles;

  const rows = users.rows.map((user) => `
    <tr>
      <td><div class="strong">${ui.esc(user.fullName)}</div><div class="cell-sub">${ui.esc(user.email)}</div></td>
      <td><span class="tag">${ui.esc(user.roleName || user.roleKey)}</span></td>
      <td>${ui.pill(user.status === 'active' ? 'Active' : 'Inactive', user.status === 'active' ? 'success' : 'neutral')}</td>
      <td class="small">${(user.allowedUploadTypes || []).length ? user.allowedUploadTypes.map((t) => ui.esc(t)).join(', ') : '<span class="faint">semua</span>'}</td>
      <td class="small">${(user.branchScope || []).length ? user.branchScope.map((b) => ui.esc(b)).join(', ') : '<span class="faint">semua</span>'}</td>
      <td class="nowrap small">${ui.dateTime(user.lastLoginAt)}${user.mustChangePassword ? '<div class="cell-sub">wajib ganti sandi</div>' : ''}</td>
      <td class="right nowrap">
        <button class="btn btn-ghost btn-sm" data-edit-user="${ui.esc(user.userId)}">Ubah</button>
        <button class="btn btn-ghost btn-sm" data-reset-user="${ui.esc(user.userId)}">Reset sandi</button>
      </td>
    </tr>`).join('');

  host.innerHTML = `
    <section class="card" style="margin-bottom:16px">
      <div class="card-head"><div>
        <div class="card-title">Pengguna</div>
        <div class="card-sub">Password minimal 10 karakter. Reset password memaksa pengguna mengganti sandi saat masuk.</div>
      </div>
        <button class="btn btn-primary" id="new-user">Pengguna baru</button>
      </div>
      <div class="card-body flush">
        ${rows ? `<div class="table-wrap"><table class="data">
          <thead><tr><th>Nama</th><th>Role</th><th>Status</th><th>Jenis upload</th><th>Cakupan cabang</th><th>Login terakhir</th><th></th></tr></thead>
          <tbody>${rows}</tbody></table></div>`
          : ui.emptyState({ title: 'Belum ada pengguna', desc: 'Tambahkan pengguna pertama.' })}
      </div>
    </section>
    <section class="card">
      <div class="card-head"><div class="card-title">Role &amp; permission</div>
        <div class="card-sub">Permission diperiksa di server pada setiap permintaan.</div></div>
      <div class="card-body stack">
        ${roleOptions.map((role) => `
          <div class="card" style="box-shadow:none">
            <div class="card-body">
              <div class="row">
                <div>
                  <div class="strong">${ui.esc(role.roleName)} <span class="mono faint small">${ui.esc(role.roleKey)}</span></div>
                  <div class="small muted">${ui.esc(role.description || '—')}</div>
                </div>
                <span class="spacer"></span>
                ${ctx.can('admin.users') && ctx.state.user.roleKey === 'administrator'
                  ? `<button class="btn btn-secondary btn-sm" data-edit-role="${ui.esc(role.roleKey)}">Ubah permission</button>` : ''}
              </div>
              <div class="row-wrap" style="margin-top:8px">
                ${(role.permissions || []).map((permission) => `<span class="tag mono">${ui.esc(permission)}</span>`).join('') || '<span class="faint small">Tidak ada permission.</span>'}
              </div>
            </div>
          </div>`).join('')}
      </div>
    </section>`;

  const reload = () => renderUsers(host, ctx);
  document.getElementById('new-user')?.addEventListener('click', () => userForm(ctx, null, roleOptions, reload));
  host.querySelectorAll('[data-edit-user]').forEach((button) => {
    button.addEventListener('click', () => {
      const user = users.rows.find((row) => row.userId === button.getAttribute('data-edit-user'));
      if (user) userForm(ctx, user, roleOptions, reload);
    });
  });
  host.querySelectorAll('[data-reset-user]').forEach((button) => {
    button.addEventListener('click', () => {
      const user = users.rows.find((row) => row.userId === button.getAttribute('data-reset-user'));
      if (user) resetPasswordForm(user, reload);
    });
  });
  host.querySelectorAll('[data-edit-role]').forEach((button) => {
    button.addEventListener('click', () => {
      const role = roleOptions.find((row) => row.roleKey === button.getAttribute('data-edit-role'));
      if (role) roleForm(role, reload);
    });
  });
}

function userForm(ctx, existing, roles, onDone) {
  const isEdit = Boolean(existing?.userId);
  const body = `
    <div class="form-grid">
      <div class="field"><label class="label" for="u-name">Nama lengkap<span class="req">*</span></label>
        <input class="input" id="u-name" name="fullName" required maxlength="200" value="${ui.esc(existing?.fullName || '')}" /></div>
      <div class="field"><label class="label" for="u-email">Email<span class="req">*</span></label>
        <input class="input" id="u-email" name="email" type="email" required maxlength="200"
          value="${ui.esc(existing?.email || '')}" ${isEdit ? 'readonly' : ''} /></div>
      ${isEdit ? '' : `<div class="field"><label class="label" for="u-password">Password awal<span class="req">*</span></label>
        <input class="input" id="u-password" name="password" type="password" required minlength="10" autocomplete="new-password" />
        <div class="hint">Minimal 10 karakter.</div></div>`}
      <div class="field"><label class="label" for="u-role">Role<span class="req">*</span></label>
        <select class="select" id="u-role" name="roleKey" required>
          ${roles.map((role) => `<option value="${ui.esc(role.roleKey)}"${existing?.roleKey === role.roleKey ? ' selected' : ''}>${ui.esc(role.roleName)}</option>`).join('')}
        </select></div>
      <div class="field"><label class="label" for="u-status">Status</label>
        <select class="select" id="u-status" name="status">
          <option value="active"${existing?.status !== 'inactive' ? ' selected' : ''}>Active</option>
          <option value="inactive"${existing?.status === 'inactive' ? ' selected' : ''}>Inactive</option>
        </select></div>
      <div class="field full"><label class="label">Jenis upload yang diizinkan (uploader)</label>
        <div class="row-wrap">
          ${UPLOAD_TYPES.map((type) => `<label class="checkbox"><input type="checkbox" name="allowedUploadTypes" value="${type}"
            ${(existing?.allowedUploadTypes || []).includes(type) ? 'checked' : ''} /> ${type}</label>`).join('')}
        </div>
        <div class="hint">Kosongkan untuk mengikuti aturan role. Hanya berlaku untuk role uploader.</div></div>
      <div class="field full"><label class="label" for="u-scope">Cakupan cabang</label>
        <input class="input" id="u-scope" name="branchScope" placeholder="JKT, BDG — kosong berarti semua cabang"
          value="${(existing?.branchScope || []).join(', ')}" />
        <div class="hint">Pisahkan dengan koma. Diterapkan pada daftar dan laporan.</div></div>
    </div>`;

  ui.modal({
    title: isEdit ? `Ubah pengguna — ${existing.fullName}` : 'Pengguna baru',
    body,
    confirmLabel: isEdit ? 'Simpan perubahan' : 'Buat pengguna',
    onConfirm: async (form) => {
      const values = ui.serializeForm(form);
      const allowedUploadTypes = [...form.querySelectorAll('input[name="allowedUploadTypes"]:checked')].map((input) => input.value);
      const branchScope = values.branchScope ? values.branchScope.split(',').map((s) => s.trim()).filter(Boolean) : [];
      try {
        if (isEdit) {
          await api.updateUser(existing.userId, {
            fullName: values.fullName,
            roleKey: values.roleKey,
            status: values.status,
            allowedUploadTypes,
            branchScope,
          });
          ui.toast('Pengguna diperbarui.', 'success');
        } else {
          await api.createUser({
            email: values.email,
            fullName: values.fullName,
            password: values.password,
            roleKey: values.roleKey,
            status: values.status,
            allowedUploadTypes,
            branchScope,
          });
          ui.toast('Pengguna dibuat.', 'success');
        }
        await onDone();
        return true;
      } catch (error) {
        ui.toast(error.message, 'danger');
        return false;
      }
    },
  });
}

function resetPasswordForm(user, onDone) {
  ui.modal({
    title: `Reset sandi — ${user.fullName}`,
    body: `<div class="field"><label class="label" for="r-pass">Password baru<span class="req">*</span></label>
      <input class="input" id="r-pass" name="newPassword" type="password" minlength="10" required autocomplete="new-password" />
      <div class="hint">Pengguna wajib mengganti sandi saat login berikutnya.</div></div>`,
    confirmLabel: 'Reset sandi',
    danger: true,
    onConfirm: async (form) => {
      const password = form.newPassword.value;
      if (password.length < 10) {
        ui.toast('Password minimal 10 karakter.', 'danger');
        return false;
      }
      try {
        await api.resetPassword(user.userId, password);
        ui.toast('Password direset.', 'success');
        await onDone();
        return true;
      } catch (error) {
        ui.toast(error.message, 'danger');
        return false;
      }
    },
  });
}

function roleForm(role, onDone) {
  const permissions = [
    'upload.create', 'upload.view.all', 'upload.approve', 'upload.post', 'upload.cancel',
    'agent.write', 'production.write', 'claim.write',
    'report.view', 'report.financial', 'report.claim', 'report.production',
    'export.claim', 'audit.view',
    'admin.users', 'admin.master', 'admin.rules', 'admin.hash',
  ];
  ui.modal({
    title: `Permission — ${role.roleName}`,
    body: `<div class="stack">
      <p class="muted small">Centang izin yang diberikan. Perubahan berlaku pada permintaan berikutnya dan dicatat di audit.</p>
      <div class="form-grid">${permissions.map((permission) => `
        <label class="checkbox"><input type="checkbox" name="permissions" value="${permission}"
          ${(role.permissions || []).includes(permission) ? 'checked' : ''} /> <span class="mono">${permission}</span></label>`).join('')}
      </div>
    </div>`,
    confirmLabel: 'Simpan permission',
    onConfirm: async (form) => {
      const selected = [...form.querySelectorAll('input[name="permissions"]:checked')].map((input) => input.value);
      try {
        await api.updateRole(role.roleKey, selected);
        ui.toast('Permission role diperbarui.', 'success');
        await onDone();
        return true;
      } catch (error) {
        ui.toast(error.message, 'danger');
        return false;
      }
    },
  });
}

// ---------------------------------------------------------------- master
async function renderMasters(host, ctx) {
  const kind = MASTER_KINDS.find((item) => item.key === ctx.query.kind) || MASTER_KINDS[0];
  const data = await api.masters(kind.key);
  const rows = data.rows.map((row) => `
    <tr>
      <td class="mono strong">${ui.esc(row[kind.codeKey])}</td>
      <td>${ui.esc(row[kind.nameKey])}</td>
      ${kind.key === 'branches' ? `<td>${ui.esc(row.region || '—')}</td>` : ''}
      <td>${ui.pill(row.isActive ? 'Active' : 'Inactive', row.isActive ? 'success' : 'neutral')}</td>
      <td class="right"><button class="btn btn-ghost btn-sm" data-edit-master="${ui.esc(row[kind.codeKey])}">Ubah</button></td>
    </tr>`).join('');

  host.innerHTML = `
    <section class="card">
      <div class="card-head">
        <div class="row-wrap">
          ${MASTER_KINDS.map((item) => `<a class="btn ${item.key === kind.key ? 'btn-primary' : 'btn-secondary'} btn-sm"
            href="#/admin?tab=master&kind=${item.key}">${ui.esc(item.label)}</a>`).join('')}
        </div>
        <button class="btn btn-primary btn-sm" id="new-master">Tambah ${ui.esc(kind.label.toLowerCase())}</button>
      </div>
      <div class="card-body flush">
        ${rows ? `<div class="table-wrap"><table class="data">
          <thead><tr><th>Kode</th><th>Nama</th>${kind.key === 'branches' ? '<th>Region</th>' : ''}<th>Status</th><th></th></tr></thead>
          <tbody>${rows}</tbody></table></div>`
          : ui.emptyState({ title: 'Belum ada master data', desc: 'Tambahkan kode baru untuk mulai.' })}
      </div>
    </section>`;

  const reload = () => renderMasters(host, ctx);
  const open = (row) => masterForm(kind, row, reload);
  document.getElementById('new-master')?.addEventListener('click', () => open(null));
  host.querySelectorAll('[data-edit-master]').forEach((button) => {
    button.addEventListener('click', () => {
      const row = data.rows.find((item) => item[kind.codeKey] === button.getAttribute('data-edit-master'));
      if (row) open(row);
    });
  });
}

function masterForm(kind, row, onDone) {
  const isEdit = Boolean(row);
  ui.modal({
    title: `${isEdit ? 'Ubah' : 'Tambah'} ${kind.label.toLowerCase()}`,
    body: `<div class="stack">
      <div class="field"><label class="label" for="m-code">Kode<span class="req">*</span></label>
        <input class="input mono" id="m-code" name="code" required maxlength="50"
          value="${ui.esc(row?.[kind.codeKey] || '')}" ${isEdit ? 'readonly' : ''} /></div>
      <div class="field"><label class="label" for="m-name">Nama<span class="req">*</span></label>
        <input class="input" id="m-name" name="name" required maxlength="200" value="${ui.esc(row?.[kind.nameKey] || '')}" /></div>
      ${kind.key === 'branches' ? `<div class="field"><label class="label" for="m-region">Region</label>
        <input class="input" id="m-region" name="region" maxlength="100" value="${ui.esc(row?.region || '')}" /></div>` : ''}
      <label class="checkbox"><input type="checkbox" name="isActive" ${row?.isActive === false ? '' : 'checked'} /> Aktif</label>
    </div>`,
    confirmLabel: isEdit ? 'Simpan' : 'Tambah',
    onConfirm: async (form) => {
      const values = ui.serializeForm(form);
      const payload = {
        [kind.codeKey]: values.code,
        [kind.nameKey]: values.name,
        isActive: form.isActive.checked,
      };
      if (kind.key === 'branches') payload.region = values.region || undefined;
      try {
        if (isEdit) {
          const update = { [kind.nameKey]: values.name, isActive: form.isActive.checked };
          if (kind.key === 'branches') update.region = values.region || undefined;
          await api.updateMaster(kind.key, row[kind.codeKey], update);
          ui.toast('Master data diperbarui.', 'success');
        } else {
          await api.createMaster(kind.key, payload);
          ui.toast('Master data ditambahkan.', 'success');
        }
        await onDone();
        return true;
      } catch (error) {
        ui.toast(error.message, 'danger');
        return false;
      }
    },
  });
}

// ---------------------------------------------------------------- kurs
async function renderRates(host, ctx) {
  const data = await api.exchangeRates();
  const rows = data.rows.map((rate) => `
    <tr>
      <td class="nowrap">${ui.date(rate.rateDate)}</td>
      <td class="mono">${ui.esc(rate.fromCurrency)} → ${ui.esc(rate.toCurrency)}</td>
      <td>${ui.pill(rate.rateType, 'info', { dot: false })}</td>
      <td class="right num">${ui.num(rate.exchangeRate)}</td>
      <td class="small">${ui.esc(rate.approvedBy || '—')}<div class="cell-sub">${ui.dateTime(rate.approvedAt)}</div></td>
      <td class="mono tiny">${ui.esc(rate.exchangeRateId)}</td>
    </tr>`).join('');

  host.innerHTML = `
    <section class="card">
      <div class="card-head"><div>
        <div class="card-title">Tabel kurs resmi</div>
        <div class="card-sub">Konversi laporan memakai kurs terakhir pada atau sebelum akhir periode. IDR dan USD
          tidak pernah dijumlahkan tanpa konversi eksplisit.</div>
      </div>
        <button class="btn btn-primary btn-sm" id="new-rate">Tambah kurs</button>
      </div>
      <div class="card-body flush">
        ${rows ? `<div class="table-wrap"><table class="data">
          <thead><tr><th>Tanggal</th><th>Pasangan</th><th>Jenis</th><th class="right">Kurs</th><th>Disetujui</th><th>ID</th></tr></thead>
          <tbody>${rows}</tbody></table></div>`
          : ui.emptyState({ title: 'Belum ada kurs', desc: 'Tambahkan kurs resmi sebelum memakai konversi laporan.' })}
      </div>
    </section>`;

  document.getElementById('new-rate')?.addEventListener('click', () => {
    ui.modal({
      title: 'Tambah kurs resmi',
      body: `<div class="form-grid">
        <div class="field"><label class="label" for="x-date">Tanggal<span class="req">*</span></label>
          <input class="input" type="date" id="x-date" name="rateDate" required /></div>
        <div class="field"><label class="label" for="x-from">Dari<span class="req">*</span></label>
          <input class="input mono" id="x-from" name="fromCurrency" required maxlength="10" placeholder="USD" /></div>
        <div class="field"><label class="label" for="x-to">Ke<span class="req">*</span></label>
          <input class="input mono" id="x-to" name="toCurrency" required maxlength="10" placeholder="IDR" /></div>
        <div class="field"><label class="label" for="x-type">Jenis</label>
          <select class="select" id="x-type" name="rateType">${RATE_TYPES.map((type) => `<option>${type}</option>`).join('')}</select></div>
        <div class="field"><label class="label" for="x-value">Kurs<span class="req">*</span></label>
          <input class="input" type="number" step="0.000001" min="0.000001" id="x-value" name="exchangeRate" required /></div>
      </div>`,
      confirmLabel: 'Simpan kurs',
      onConfirm: async (form) => {
        const values = ui.serializeForm(form);
        try {
          await api.createExchangeRate({ ...values, exchangeRate: Number(values.exchangeRate) });
          ui.toast('Kurs disimpan dan disetujui.', 'success');
          await renderRates(host, ctx);
          return true;
        } catch (error) {
          ui.toast(error.message, 'danger');
          return false;
        }
      },
    });
  });
}

// ---------------------------------------------------------------- rules
async function renderRules(host, ctx) {
  const data = await api.businessRules();
  const rows = data.rules.map((rule) => `
    <tr>
      <td class="mono strong">${ui.esc(rule.ruleKey)}</td>
      <td class="small">${ui.esc(rule.description || '—')}</td>
      <td class="mono tiny truncate" style="max-width:280px">${ui.esc(JSON.stringify(rule.ruleValue))}</td>
      <td>${ui.pill(rule.dataType, 'neutral', { dot: false })}</td>
      <td>${ui.pill(rule.status || 'active', rule.status === 'pending_approval' ? 'warning' : 'success')}</td>
      <td class="right num">v${ui.int(rule.versionNo)}</td>
      <td class="right"><button class="btn btn-ghost btn-sm" data-edit-rule="${ui.esc(rule.ruleKey)}">Ubah</button></td>
    </tr>`).join('');

  host.innerHTML = `
    ${data.rules.some((rule) => rule.ruleKey === 'net_claim_formula' && rule.status !== 'active')
      ? ui.banner('Net Claims Cost belum dihitung karena formula resmi belum disetujui dan diaktifkan. Nilai formula tidak boleh diisi tanpa keputusan bisnis.', 'info', { title: 'Formula menunggu persetujuan' })
      : ''}
    <section class="card" style="margin-top:${data.rules.some((rule) => rule.ruleKey === 'net_claim_formula' && rule.status !== 'active') ? '16px' : '0'}">
      <div class="card-head"><div>
        <div class="card-title">Business rules</div>
        <div class="card-sub">Setiap perubahan menaikkan version_no dan dicatat pada audit trail.</div>
      </div></div>
      <div class="card-body flush">
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Key</th><th>Deskripsi</th><th>Nilai</th><th>Tipe</th><th>Status</th><th class="right">Versi</th><th></th></tr></thead>
          <tbody>${rows}</tbody></table></div>
      </div>
    </section>`;

  host.querySelectorAll('[data-edit-rule]').forEach((button) => {
    button.addEventListener('click', () => {
      const rule = data.rules.find((row) => row.ruleKey === button.getAttribute('data-edit-rule'));
      if (rule) ruleForm(rule, () => renderRules(host, ctx));
    });
  });
}

function ruleForm(rule, onDone) {
  const value = rule.ruleValue;
  let input = '';
  if (rule.dataType === 'boolean') {
    input = `<select class="select" name="ruleValue" id="r-value">
      <option value="true"${value === true ? ' selected' : ''}>true</option>
      <option value="false"${value === false ? ' selected' : ''}>false</option></select>`;
  } else if (rule.dataType === 'json') {
    input = `<textarea class="textarea" rows="6" id="r-value" name="ruleValue">${ui.esc(JSON.stringify(value, null, 2))}</textarea>`;
  } else if (rule.dataType === 'number') {
    input = `<input class="input" type="number" step="any" id="r-value" name="ruleValue" value="${ui.esc(value)}" />`;
  } else {
    input = `<textarea class="textarea" rows="4" id="r-value" name="ruleValue">${ui.esc(value === null || value === undefined ? '' : String(value))}</textarea>`;
  }

  ui.modal({
    title: `Ubah aturan — ${rule.ruleKey}`,
    body: `<div class="stack">
      <p class="muted small">${ui.esc(rule.description || '')}</p>
      <div class="field"><label class="label" for="r-value">Nilai (${ui.esc(rule.dataType)})</label>${input}</div>
      ${rule.ruleKey === 'net_claim_formula'
        ? '<div class="hint">Mengubah nilai ini tidak otomatis mengaktifkan formula; status persetujuan dikelola terpisah.</div>' : ''}
    </div>`,
    confirmLabel: 'Simpan nilai',
    onConfirm: async (form) => {
      let ruleValue;
      if (rule.dataType === 'boolean') ruleValue = form.ruleValue.value === 'true';
      else if (rule.dataType === 'number') ruleValue = Number(form.ruleValue.value);
      else if (rule.dataType === 'json') {
        try { ruleValue = JSON.parse(form.ruleValue.value); } catch {
          ui.toast('Nilai JSON tidak valid.', 'danger');
          return false;
        }
      } else ruleValue = form.ruleValue.value;
      try {
        await api.updateBusinessRule(rule.ruleKey, { ruleValue });
        ui.toast('Aturan diperbarui.', 'success');
        await onDone();
        return true;
      } catch (error) {
        ui.toast(error.message, 'danger');
        return false;
      }
    },
  });
}

// ---------------------------------------------------------------- hash
async function renderHashConfigs(host, ctx) {
  const data = await api.hashConfigs();
  const rows = data.configs.map((config) => `
    <tr>
      <td class="mono strong">${ui.esc(config.hashConfigVersion)}</td>
      <td>${ui.pill(config.uploadType, 'info', { dot: false })}</td>
      <td class="small mono">${(config.columns || []).map((c) => ui.esc(c)).join(', ')}</td>
      <td class="small mono">${(config.businessKeyColumns || []).map((c) => ui.esc(c)).join(', ')}</td>
      <td class="nowrap">${ui.date(config.effectiveFrom)}</td>
      <td>${ui.pill(config.isActive ? 'Active' : 'Inactive', config.isActive ? 'success' : 'neutral')}</td>
      <td class="small">${ui.esc(config.notes || '—')}</td>
    </tr>`).join('');

  host.innerHTML = `
    <section class="card">
      <div class="card-head"><div>
        <div class="card-title">Konfigurasi hash &amp; business key</div>
        <div class="card-sub">Dedup memakai kolom isi data setelah normalisasi, bukan nama file. Versi baru tidak
          mengubah hash record lama.</div>
      </div>
        <button class="btn btn-primary btn-sm" id="new-hash">Versi baru</button>
      </div>
      <div class="card-body flush">
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Versi</th><th>Jenis</th><th>Kolom hash</th><th>Kolom business key</th><th>Efektif</th><th>Status</th><th>Catatan</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="7" class="faint">Belum ada konfigurasi.</td></tr>'}</tbody></table></div>
      </div>
    </section>`;

  document.getElementById('new-hash')?.addEventListener('click', () => {
    ui.modal({
      title: 'Versi konfigurasi hash baru',
      body: `<div class="form-grid">
        <div class="field"><label class="label" for="h-type">Jenis upload<span class="req">*</span></label>
          <select class="select" id="h-type" name="uploadType">${UPLOAD_TYPES.map((type) => `<option>${type}</option>`).join('')}</select></div>
        <div class="field"><label class="label" for="h-version">Versi</label>
          <input class="input mono" id="h-version" name="hashConfigVersion" placeholder="otomatis" /></div>
        <div class="field full"><label class="label" for="h-columns">Kolom hash<span class="req">*</span></label>
          <input class="input mono" id="h-columns" name="columns" required placeholder="PolicyNo, PolicyRiskID, EffectiveDate" />
          <div class="hint">Dipisah koma. Urutan kolom memengaruhi hash.</div></div>
        <div class="field full"><label class="label" for="h-key">Kolom business key<span class="req">*</span></label>
          <input class="input mono" id="h-key" name="businessKeyColumns" required placeholder="PolicyNo, PolicyRiskID" /></div>
        <div class="field"><label class="label" for="h-effective">Efektif dari</label>
          <input class="input" type="date" id="h-effective" name="effectiveFrom" /></div>
        <div class="field full"><label class="label" for="h-notes">Catatan</label>
          <input class="input" id="h-notes" name="notes" maxlength="500" /></div>
      </div>`,
      confirmLabel: 'Simpan versi',
      onConfirm: async (form) => {
        const values = ui.serializeForm(form);
        try {
          await api.createHashConfig({
            uploadType: values.uploadType,
            hashConfigVersion: values.hashConfigVersion || undefined,
            columns: values.columns.split(',').map((s) => s.trim()).filter(Boolean),
            businessKeyColumns: values.businessKeyColumns.split(',').map((s) => s.trim()).filter(Boolean),
            effectiveFrom: values.effectiveFrom || undefined,
            notes: values.notes || undefined,
          });
          ui.toast('Konfigurasi hash baru disimpan.', 'success');
          await renderHashConfigs(host, ctx);
          return true;
        } catch (error) {
          ui.toast(error.message, 'danger');
          return false;
        }
      },
    });
  });
}
