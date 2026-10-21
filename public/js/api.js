// Klien API tipis untuk NextMitracaReport.
// Semua permintaan memakai cookie sesi (HttpOnly) — tidak ada token di browser.

export class ApiError extends Error {
  constructor(code, message, details = [], status = 0) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

async function request(path, { method = 'GET', body, headers = {}, raw = false } = {}) {
  const init = {
    method,
    credentials: 'same-origin',
    headers: { Accept: 'application/json', ...headers },
  };
  if (body !== undefined) {
    if (body instanceof FormData) {
      init.body = body;
    } else {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
  }

  let response;
  try {
    response = await fetch(`/api${path}`, init);
  } catch (networkError) {
    throw new ApiError('NETWORK_ERROR', 'Tidak dapat menghubungi server. Periksa koneksi Anda.', [], 0);
  }

  if (raw) {
    if (response.status === 401) {
      redirectToLogin();
      throw new ApiError('AUTH_REQUIRED', 'Sesi berakhir. Silakan masuk kembali.', [], 401);
    }
    if (!response.ok) {
      let payload = null;
      try { payload = await response.json(); } catch { /* ignore */ }
      throw new ApiError(
        payload?.error?.code || 'INTERNAL_ERROR',
        payload?.error?.message || 'Permintaan gagal diproses.',
        payload?.error?.details || [],
        response.status,
      );
    }
    return response;
  }

  let payload = null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try { payload = await response.json(); } catch { payload = null; }
  }

  if (response.status === 401) {
    if (!path.startsWith('/auth/login')) redirectToLogin();
    throw new ApiError(
      payload?.error?.code || 'AUTH_REQUIRED',
      payload?.error?.message || 'Sesi berakhir. Silakan masuk kembali.',
      [], 401,
    );
  }

  if (!response.ok || (payload && payload.ok === false)) {
    throw new ApiError(
      payload?.error?.code || 'INTERNAL_ERROR',
      payload?.error?.message || `Permintaan gagal (HTTP ${response.status}).`,
      payload?.error?.details || [],
      response.status,
    );
  }

  return payload ? payload.data : null;
}

function redirectToLogin() {
  if (window.location.hash !== '#/login') {
    window.location.hash = '#/login';
  }
}

function query(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '' || value === false) continue;
    search.set(key, value === true ? '1' : String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export const api = {
  // auth
  me: () => request('/auth/me'),
  login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password } }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  changePassword: (currentPassword, newPassword) =>
    request('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } }),

  // dashboard
  dashboard: () => request('/dashboard'),

  // upload
  listUploads: (params) => request(`/uploads${query(params)}`),
  getUpload: (id) => request(`/uploads/${encodeURIComponent(id)}`),
  rows: (id, params) => request(`/uploads/${encodeURIComponent(id)}/rows${query(params)}`),
  createUpload: (formData) => request('/uploads', { method: 'POST', body: formData }),
  validateUpload: (id) => request(`/uploads/${encodeURIComponent(id)}/validate`, { method: 'POST', body: {} }),
  approveUpload: (id, remarks) =>
    request(`/uploads/${encodeURIComponent(id)}/approve`, { method: 'POST', body: { remarks: remarks || undefined } }),
  rejectUpload: (id, reason) =>
    request(`/uploads/${encodeURIComponent(id)}/reject`, { method: 'POST', body: { reason } }),
  postUpload: (id, remarks) =>
    request(`/uploads/${encodeURIComponent(id)}/post`, { method: 'POST', body: { remarks: remarks || undefined } }),
  cancelUpload: (id, reason) =>
    request(`/uploads/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: { reason } }),
  rowExportUrl: (id) => `/api/uploads/${encodeURIComponent(id)}/rows/export`,
  fileUrl: (id) => `/api/uploads/${encodeURIComponent(id)}/file`,
  templateUrl: (type) => `/api/uploads/templates/${encodeURIComponent(type)}`,

  // agents
  listAgents: (params) => request(`/agents${query(params)}`),
  getAgent: (id) => request(`/agents/${encodeURIComponent(id)}`),
  createAgent: (body) => request('/agents', { method: 'POST', body }),
  updateAgent: (id, body) => request(`/agents/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  pendingMapping: () => request('/agents/pending-mapping'),
  resolveMapping: (body) => request('/agents/resolve-mapping', { method: 'POST', body }),

  // produksi
  listProduction: (params) => request(`/production${query(params)}`),
  listProductionPositions: (params) => request(`/production/positions${query(params)}`),
  getProduction: (id) => request(`/production/${encodeURIComponent(id)}`),
  cancelProduction: (id, reason) =>
    request(`/production/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: { reason } }),

  // claim
  listClaims: (params) => request(`/claims${query(params)}`),
  getClaim: (id) => request(`/claims/${encodeURIComponent(id)}`),
  cancelSettlement: (claimId, settlementId, reason) =>
    request(`/claims/${encodeURIComponent(claimId)}/settlements/${encodeURIComponent(settlementId)}/cancel`,
      { method: 'POST', body: { reason } }),

  // laporan
  reportMeta: () => request('/reports/meta'),
  report: (key, params) => request(`/reports/${encodeURIComponent(key)}${query(params)}`),
  reportCsvUrl: (key, params) => `/api/reports/${encodeURIComponent(key)}${query({ ...params, format: 'csv' })}`,
  netClaimsCost: (params) => request(`/reports/net-claims-cost${query(params)}`),

  // audit
  listAudit: (params) => request(`/audit${query(params)}`),
  trace: (recordType, recordId) => request(`/audit/trace${query({ recordType, recordId })}`),

  // admin
  listUsers: () => request('/admin/users'),
  createUser: (body) => request('/admin/users', { method: 'POST', body }),
  updateUser: (id, body) => request(`/admin/users/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  resetPassword: (id, newPassword) =>
    request(`/admin/users/${encodeURIComponent(id)}/reset-password`, { method: 'POST', body: { newPassword } }),
  roles: () => request('/admin/roles'),
  updateRole: (roleKey, permissions) =>
    request(`/admin/roles/${encodeURIComponent(roleKey)}`, { method: 'PATCH', body: { permissions } }),
  masters: (kind) => request(`/admin/${kind}`),
  createMaster: (kind, body) => request(`/admin/${kind}`, { method: 'POST', body }),
  updateMaster: (kind, code, body) => request(`/admin/${kind}/${encodeURIComponent(code)}`, { method: 'PATCH', body }),
  exchangeRates: () => request('/admin/exchange-rates'),
  createExchangeRate: (body) => request('/admin/exchange-rates', { method: 'POST', body }),
  businessRules: () => request('/admin/business-rules'),
  updateBusinessRule: (key, body) => request(`/admin/business-rules/${encodeURIComponent(key)}`, { method: 'PATCH', body }),
  hashConfigs: () => request('/admin/hash-configs'),
  createHashConfig: (body) => request('/admin/hash-configs', { method: 'POST', body }),
};
