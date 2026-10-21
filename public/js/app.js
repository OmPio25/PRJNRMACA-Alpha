import { api, ApiError } from './api.js';
import * as ui from './ui.js';

const appEl = document.getElementById('app');

const state = {
  user: null,
  permissions: new Set(),
  meta: null,
};

const NAV = [
  {
    label: 'Operasional',
    items: [
      { path: '/dashboard', label: 'Dashboard', icon: 'grid', permission: 'report.view' },
      { path: '/uploads', label: 'Upload Data', icon: 'upload', permission: null },
      { path: '/agents', label: 'Master Agent', icon: 'users', permission: 'agent.write' },
      { path: '/production', label: 'Produksi', icon: 'file', permission: 'report.production' },
      { path: '/claims', label: 'Claim & Settlement', icon: 'shield', permission: 'report.claim' },
    ],
  },
  {
    label: 'Analitik',
    items: [
      { path: '/reports', label: 'Laporan', icon: 'chart', permission: 'report.view' },
      { path: '/audit', label: 'Audit Trail', icon: 'history', permission: 'audit.view' },
    ],
  },
  {
    label: 'Administrasi',
    items: [
      { path: '/admin', label: 'Pengaturan', icon: 'settings', permission: 'admin.master' },
    ],
  },
];

const ICONS = {
  grid: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"/>',
  upload: '<path d="M12 16V4m0 0L7 9m5-5 5 5M4 20h16"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M15 14.2c2.8.4 5 2.8 5 5.8"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  shield: '<path d="M12 3l7 3v6c0 4.2-2.9 7.7-7 9-4.1-1.3-7-4.8-7-9V6z"/><path d="m9 12 2 2 4-4"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7M3 4v4h4"/><path d="M12 8v4l3 2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 3l3 3M14 6l3 3"/>',
};

function icon(name) {
  return `<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

function can(permission) {
  if (!permission) return true;
  return state.permissions.has(permission);
}

function initials(name) {
  return String(name || '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function parseHash() {
  const raw = window.location.hash.replace(/^#/, '') || '/dashboard';
  const [pathPart, queryPart] = raw.split('?');
  const segments = pathPart.split('/').filter(Boolean);
  const query = Object.fromEntries(new URLSearchParams(queryPart || ''));
  return { path: `/${segments.join('/')}`, segments, query };
}

function navigate(path) {
  const target = path.startsWith('#') ? path : `#${path}`;
  if (window.location.hash === target) render();
  else window.location.hash = target;
}

function shell(contentHtml, { title = 'Dashboard', subtitle = '', actions = '' } = {}) {
  const navHtml = NAV.map((group) => {
    const items = group.items.filter((item) => can(item.permission));
    if (items.length === 0) return '';
    return `<div class="nav-group">
      <div class="nav-label">${group.label}</div>
      ${items.map((item) => {
        const active = `/${parseHash().segments[0] || 'dashboard'}` === item.path
          || (item.path === '/dashboard' && parseHash().path === '/');
        return `<a class="nav-item${active ? ' active' : ''}" href="#${item.path}" data-nav="${item.path}">
          ${icon(item.icon)}<span>${item.label}</span>
        </a>`;
      }).join('')}
    </div>`;
  }).join('');

  return `
    <div class="app-shell">
      <aside class="sidebar" id="sidebar" aria-label="Navigasi utama">
        <div class="brand">
          <div class="brand-mark" aria-hidden="true">NR</div>
          <div class="brand-text">
            <span class="brand-name">NextMitracaReport</span>
            <span class="brand-sub">Reporting Platform</span>
          </div>
        </div>
        <nav class="nav">${navHtml}</nav>
        <div class="sidebar-foot">Data Agent · Produksi · Claim Settled<br/>v1.0.0</div>
      </aside>
      <div class="main">
        <header class="topbar">
          <button class="btn btn-ghost btn-icon hamburger" id="nav-toggle" aria-label="Buka navigasi" aria-expanded="false">${icon('menu')}</button>
          <div>
            <div class="topbar-title">${ui.esc(title)}</div>
            ${subtitle ? `<div class="topbar-crumb">${ui.esc(subtitle)}</div>` : ''}
          </div>
          <div class="spacer"></div>
          <div class="row gap-2">
            ${actions}
            <div class="user-chip">
              <div class="avatar" aria-hidden="true">${ui.esc(initials(state.user?.fullName))}</div>
              <div class="user-meta">
                <span class="user-name">${ui.esc(state.user?.fullName)}</span>
                <span class="user-role">${ui.esc(state.user?.roleName)}</span>
              </div>
            </div>
            <button class="btn btn-ghost btn-icon" id="password-btn" title="Ubah kata sandi" aria-label="Ubah kata sandi">${icon('key')}</button>
            <button class="btn btn-ghost btn-icon" id="logout-btn" title="Keluar" aria-label="Keluar">${icon('logout')}</button>
          </div>
        </header>
        <main class="content" id="main-content">${contentHtml}</main>
      </div>
    </div>`;
}

function renderLogin() {
  appEl.innerHTML = `
    <div class="login-wrap">
      <section class="login-art">
        <div>
          <div class="row gap-3" style="margin-bottom:32px">
            <div class="brand-mark" aria-hidden="true">NR</div>
            <div class="brand-text">
              <span class="brand-name">NextMitracaReport</span>
              <span class="brand-sub">Reporting Platform</span>
            </div>
          </div>
          <h1>Kendalikan data agent, produksi, dan claim settled dalam satu alur.</h1>
          <p>Upload berulang dengan nama file yang sama tetap aman: deduplikasi memakai isi data
             setelah normalisasi, bukan nama file.</p>
          <div class="login-points">
            <div class="login-point"><span class="dot">1</span><span>Validasi template, normalisasi, dan klasifikasi baris sebelum posting.</span></div>
            <div class="login-point"><span class="dot">2</span><span>Histori dan versi terjaga; tidak ada penghapusan fisik data posted.</span></div>
            <div class="login-point"><span class="dot">3</span><span>Laporan per currency, dengan basis perhitungan tercetak di header.</span></div>
            <div class="login-point"><span class="dot">4</span><span>Audit trail menelusuri setiap angka sampai batch upload dan baris sumber.</span></div>
          </div>
        </div>
        <div class="tiny" style="color:#67758f">Spesifikasi Fungsional &amp; Teknis v1.0 — Baseline Final</div>
      </section>
      <section class="login-panel">
        <div class="login-card">
          <h2>Masuk ke aplikasi</h2>
          <p class="muted small" style="margin:6px 0 20px">Gunakan akun yang diberikan Administrator.</p>
          <form id="login-form" class="stack" novalidate>
            <div class="field">
              <label class="label" for="email">Email<span class="req">*</span></label>
              <input class="input" id="email" name="email" type="email" autocomplete="username" required
                     placeholder="nama@perusahaan.co.id" />
            </div>
            <div class="field">
              <label class="label" for="password">Kata sandi<span class="req">*</span></label>
              <input class="input" id="password" name="password" type="password" autocomplete="current-password" required
                     placeholder="••••••••" />
            </div>
            <div id="login-error" role="alert"></div>
            <button class="btn btn-primary" type="submit" style="height:38px">Masuk</button>
          </form>
          <div class="demo-users" style="margin-top:20px">
            <strong>Akun demo</strong> — kata sandi <span class="mono">Demo#2026</span><br/>
            admin@demo.local · ops@demo.local · uploader@demo.local · uw@demo.local · claims@demo.local · finance@demo.local · auditor@demo.local
          </div>
        </div>
      </section>
    </div>`;

  const form = document.getElementById('login-form');
  const errorBox = document.getElementById('login-error');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorBox.innerHTML = '';
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = 'Memproses…';
    try {
      const result = await api.login(form.email.value.trim(), form.password.value);
      state.user = result.user;
      await loadIdentity();
      navigate('/dashboard');
    } catch (error) {
      errorBox.innerHTML = `<div class="banner banner-danger">${ui.esc(error.message || 'Gagal masuk.')}</div>`;
      button.disabled = false;
      button.textContent = 'Masuk';
    }
  });
}

async function loadIdentity() {
  const me = await api.me();
  state.user = me.user;
  state.permissions = new Set(me.permissions || []);
  return me;
}

function renderForbidden(permission) {
  appEl.innerHTML = shell(`
    <div class="card"><div class="empty">
      <div class="empty-icon">${icon('shield')}</div>
      <div class="empty-title">Akses ditolak</div>
      <div class="empty-desc">Peran <b>${ui.esc(state.user?.roleName || '')}</b> tidak memiliki izin
        <span class="tag">${ui.esc(permission)}</span> untuk membuka halaman ini.</div>
      <a class="btn btn-secondary" href="#/dashboard">Kembali ke dashboard</a>
    </div></div>`, { title: 'Akses ditolak' });
}

function renderNotFound() {
  appEl.innerHTML = shell(`
    <div class="card"><div class="empty">
      <div class="empty-icon">${icon('file')}</div>
      <div class="empty-title">Halaman tidak ditemukan</div>
      <div class="empty-desc">Tautan yang Anda buka tidak tersedia.</div>
      <a class="btn btn-secondary" href="#/dashboard">Ke dashboard</a>
    </div></div>`, { title: 'Tidak ditemukan' });
}

const PAGES = {
  dashboard: () => import('./pages/dashboard.js'),
  uploads: () => import('./pages/uploads.js'),
  agents: () => import('./pages/agents.js'),
  production: () => import('./pages/production.js'),
  claims: () => import('./pages/claim.js'),
  reports: () => import('./pages/reports.js'),
  audit: () => import('./pages/audit.js'),
  admin: () => import('./pages/admin.js'),
};

async function renderPage() {
  const route = parseHash();

  if (route.path === '/login') {
    if (state.user) { navigate('/dashboard'); return; }
    renderLogin();
    return;
  }

  if (!state.user) {
    try {
      await loadIdentity();
    } catch {
      renderLogin();
      return;
    }
  }

  const section = route.segments[0] || 'dashboard';
  const loader = PAGES[section];
  if (!loader) { renderNotFound(); return; }

  const ctx = {
    route,
    state,
    can,
    navigate,
    api,
    ui,
    shell,
    params: route.segments.slice(1),
    query: route.query,
    reload: render,
    setTitle: (title, subtitle = '') => {
      const node = document.querySelector('.topbar-title');
      if (node) node.textContent = title;
      const crumb = document.querySelector('.topbar-crumb');
      if (crumb) crumb.textContent = subtitle;
    },
  };

  try {
    const page = await loader();
    await page.render(appEl, ctx);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'AUTH_REQUIRED') {
      state.user = null;
      renderLogin();
      return;
    }
    appEl.innerHTML = shell(`
      <div class="card"><div class="empty">
        <div class="empty-icon">${icon('shield')}</div>
        <div class="empty-title">Halaman gagal dimuat</div>
        <div class="empty-desc">${ui.esc(error.message || 'Terjadi kesalahan.')}</div>
        <button class="btn btn-secondary" id="retry-btn">Coba lagi</button>
      </div></div>`, { title: 'Galat' });
    document.getElementById('retry-btn')?.addEventListener('click', render);
  }
}

function openPasswordModal() {
  ui.modal({
    title: 'Ubah kata sandi',
    body: `<div class="stack">
      <div class="field"><label class="label" for="p-current">Kata sandi saat ini<span class="req">*</span></label>
        <input class="input" id="p-current" name="currentPassword" type="password" required autocomplete="current-password" /></div>
      <div class="field"><label class="label" for="p-new">Kata sandi baru<span class="req">*</span></label>
        <input class="input" id="p-new" name="newPassword" type="password" required minlength="10" autocomplete="new-password" />
        <div class="hint">Minimal 10 karakter.</div></div>
      <div class="field"><label class="label" for="p-repeat">Ulangi kata sandi baru<span class="req">*</span></label>
        <input class="input" id="p-repeat" name="repeatPassword" type="password" required minlength="10" autocomplete="new-password" /></div>
    </div>`,
    confirmLabel: 'Simpan kata sandi',
    onConfirm: async (form) => {
      const currentPassword = form.currentPassword.value;
      const newPassword = form.newPassword.value;
      const repeatPassword = form.repeatPassword.value;
      if (newPassword.length < 10) {
        ui.toast('Kata sandi baru minimal 10 karakter.', 'danger');
        return false;
      }
      if (newPassword !== repeatPassword) {
        ui.toast('Ulangi kata sandi tidak sama.', 'danger');
        return false;
      }
      try {
        await api.changePassword(currentPassword, newPassword);
        ui.toast('Kata sandi diperbarui.', 'success');
        return true;
      } catch (error) {
        ui.toast(error.message, 'danger');
        return false;
      }
    },
  });
}

function wireShell() {
  document.getElementById('password-btn')?.addEventListener('click', openPasswordModal);

  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    try { await api.logout(); } catch { /* tetap keluar */ }
    state.user = null;
    state.permissions = new Set();
    navigate('/login');
  });

  const toggle = document.getElementById('nav-toggle');
  const sidebar = document.getElementById('sidebar');
  toggle?.addEventListener('click', () => {
    const open = sidebar.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
  });
  document.querySelectorAll('[data-nav]').forEach((link) => {
    link.addEventListener('click', () => {
      sidebar?.classList.remove('open');
      toggle?.setAttribute('aria-expanded', 'false');
    });
  });
}

// Event delegation untuk pagination dihapus: setiap halaman mengelola state pagination
// sendiri (tanpa memicu render ulang seluruh halaman).

window.addEventListener('hashchange', render);
window.addEventListener('DOMContentLoaded', () => { render(); });

// Render halaman lalu pasang ulang handler shell (navigasi, logout, drawer).
async function render() {
  await renderPage();
  wireShell();
}
