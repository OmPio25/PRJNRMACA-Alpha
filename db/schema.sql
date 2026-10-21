-- ============================================================================
-- NextMitracaReport - Skema Database Inti (SQLite, node:sqlite)
-- Referensi: Spesifikasi Fungsional dan Teknis v1.0 (Baseline Final)
--
-- Konvensi:
--  * Semua ID berupa TEXT (UUID/prefix-id) agar mudah ditelusuri.
--  * Semua tanggal disimpan ISO-8601: 'YYYY-MM-DD' (tanggal) / 'YYYY-MM-DDTHH:MM:SSZ' (timestamp).
--  * Semua nominal disimpan sebagai INTEGER dalam minor unit (sen/cent) pada kolom *_minor.
--    Contoh: Rp 1.000.000,00 -> 100000000. API mengekspos nilai desimal.
--  * Kolom audit minimum: created_at/by, updated_at/by, approved_at/by, cancelled_at/by,
--    cancellation_reason.
--  * Data posted tidak boleh dihapus fisik. Pembatalan = record_status + cancelled_* + audit.
--  * Database dibuka dengan PRAGMA foreign_keys = ON (lihat db/database.js).
-- ============================================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- 1. Keamanan: peran, izin, pengguna, sesi
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS roles (
  role_key     TEXT PRIMARY KEY,
  role_name    TEXT NOT NULL,
  description  TEXT
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_key    TEXT NOT NULL REFERENCES roles(role_key) ON DELETE CASCADE,
  permission  TEXT NOT NULL,
  PRIMARY KEY (role_key, permission)
);

CREATE TABLE IF NOT EXISTS users (
  user_id              TEXT PRIMARY KEY,
  email                TEXT NOT NULL UNIQUE,
  full_name            TEXT NOT NULL,
  password_hash        TEXT NOT NULL,           -- scrypt: 'scrypt$<salt>$<hash>'
  role_key             TEXT NOT NULL REFERENCES roles(role_key),
  status               TEXT NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active','inactive')),
  allowed_upload_types TEXT NOT NULL DEFAULT '[]', -- JSON array: AGENT|PRODUCTION|CLAIM
  branch_scope         TEXT NOT NULL DEFAULT '[]', -- JSON array kode cabang, [] = semua
  must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0,1)),
  last_login_at        TEXT,
  created_at           TEXT NOT NULL,
  created_by           TEXT,
  updated_at           TEXT,
  updated_by           TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  last_seen_at TEXT,
  user_agent  TEXT
);
CREATE INDEX IF NOT EXISTS ix_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS ix_sessions_expires ON sessions(expires_at);

-- ---------------------------------------------------------------------------
-- 2. Master referensi / mapping (divalidasi saat upload)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS master_currency (
  currency_code TEXT PRIMARY KEY,
  currency_name TEXT NOT NULL,
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_at    TEXT,
  updated_by    TEXT
);

CREATE TABLE IF NOT EXISTS master_branch (
  branch_code TEXT PRIMARY KEY,
  branch_name TEXT NOT NULL,
  region      TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at  TEXT NOT NULL,
  created_by  TEXT,
  updated_at  TEXT,
  updated_by  TEXT
);

CREATE TABLE IF NOT EXISTS master_product (
  product_code TEXT PRIMARY KEY,
  product_name TEXT NOT NULL,
  is_active    INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at   TEXT NOT NULL,
  created_by   TEXT,
  updated_at   TEXT,
  updated_by   TEXT
);

CREATE TABLE IF NOT EXISTS master_coverage (
  coverage_code TEXT PRIMARY KEY,
  coverage_name TEXT NOT NULL,
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_at    TEXT,
  updated_by    TEXT
);

CREATE TABLE IF NOT EXISTS master_cause_of_loss (
  cause_code TEXT PRIMARY KEY,
  cause_name TEXT NOT NULL,
  is_active  INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL,
  created_by TEXT,
  updated_at TEXT,
  updated_by TEXT
);

-- Mapping kode sumber -> kode internal (produk/cabang/coverage/cause of loss)
CREATE TABLE IF NOT EXISTS master_mapping (
  mapping_id    TEXT PRIMARY KEY,
  mapping_type  TEXT NOT NULL
                CHECK (mapping_type IN ('PRODUCT','BRANCH','COVERAGE','CAUSE_OF_LOSS','CURRENCY')),
  source_code   TEXT NOT NULL,
  internal_code TEXT NOT NULL,
  notes         TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_at    TEXT,
  updated_by    TEXT,
  UNIQUE (mapping_type, source_code)
);

-- ---------------------------------------------------------------------------
-- 3. Konfigurasi: kurs, business rules, versi konfigurasi hash
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS exchange_rate (
  exchange_rate_id TEXT PRIMARY KEY,
  rate_date        TEXT NOT NULL,
  from_currency    TEXT NOT NULL REFERENCES master_currency(currency_code),
  to_currency      TEXT NOT NULL REFERENCES master_currency(currency_code),
  rate_type        TEXT NOT NULL DEFAULT 'MID'
                   CHECK (rate_type IN ('MID','BUY','SELL','CENTRAL_BANK','CONTRACTUAL')),
  exchange_rate    REAL NOT NULL CHECK (exchange_rate > 0),
  approved_by      TEXT REFERENCES users(user_id),
  approved_at      TEXT,
  created_at       TEXT NOT NULL,
  created_by       TEXT,
  updated_at       TEXT,
  updated_by       TEXT,
  UNIQUE (rate_date, from_currency, to_currency, rate_type),
  CHECK (from_currency <> to_currency)
);
CREATE INDEX IF NOT EXISTS ix_rate_lookup
  ON exchange_rate(from_currency, to_currency, rate_type, rate_date);

CREATE TABLE IF NOT EXISTS business_rules (
  rule_key     TEXT PRIMARY KEY,
  rule_value   TEXT NOT NULL,                  -- JSON-encoded value
  data_type    TEXT NOT NULL DEFAULT 'string'
               CHECK (data_type IN ('string','number','boolean','json','formula')),
  description  TEXT,
  status       TEXT NOT NULL DEFAULT 'active'
               CHECK (status IN ('active','pending_approval','inactive')),
  version_no   INTEGER NOT NULL DEFAULT 1,
  approved_by  TEXT REFERENCES users(user_id),
  approved_at  TEXT,
  created_at   TEXT NOT NULL,
  created_by   TEXT,
  updated_at   TEXT,
  updated_by   TEXT
);

CREATE TABLE IF NOT EXISTS hash_config (
  hash_config_version TEXT PRIMARY KEY,
  upload_type         TEXT NOT NULL CHECK (upload_type IN ('AGENT','PRODUCTION','CLAIM')),
  columns_json        TEXT NOT NULL,            -- JSON array, urutan menentukan hash
  business_key_json   TEXT NOT NULL,            -- JSON array kolom pembentuk business key
  effective_from      TEXT NOT NULL,
  is_active           INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  notes               TEXT,
  created_at          TEXT NOT NULL,
  created_by          TEXT,
  UNIQUE (upload_type, hash_config_version)
);

-- ---------------------------------------------------------------------------
-- 4. Kontrol upload: batch + baris staging
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS upload_batches (
  upload_batch_id    TEXT PRIMARY KEY,
  upload_type        TEXT NOT NULL CHECK (upload_type IN ('AGENT','PRODUCTION','CLAIM')),
  original_file_name TEXT NOT NULL,
  stored_file_path   TEXT,
  file_size_bytes    INTEGER,
  file_content_hash  TEXT NOT NULL,
  uploaded_by        TEXT NOT NULL REFERENCES users(user_id),
  uploaded_at        TEXT NOT NULL,
  total_rows         INTEGER NOT NULL DEFAULT 0,
  new_rows           INTEGER NOT NULL DEFAULT 0,
  duplicate_rows     INTEGER NOT NULL DEFAULT 0,
  changed_rows       INTEGER NOT NULL DEFAULT 0,
  rejected_rows      INTEGER NOT NULL DEFAULT 0,
  pending_mapping_rows INTEGER NOT NULL DEFAULT 0,
  posted_rows        INTEGER NOT NULL DEFAULT 0,
  processing_status  TEXT NOT NULL DEFAULT 'Uploaded'
                     CHECK (processing_status IN ('Uploaded','Validating','Ready for Review',
                       'Approved','Posted','Posted with Exceptions','Failed','Rejected','Cancelled')),
  processed_at       TEXT,
  approved_by        TEXT REFERENCES users(user_id),
  approved_at        TEXT,
  rejected_by        TEXT REFERENCES users(user_id),
  rejected_at        TEXT,
  rejection_reason   TEXT,
  cancelled_by       TEXT REFERENCES users(user_id),
  cancelled_at       TEXT,
  cancellation_reason TEXT,
  hash_config_version TEXT,
  date_format        TEXT,
  remarks            TEXT,
  created_at         TEXT NOT NULL,
  created_by         TEXT,
  updated_at         TEXT,
  updated_by         TEXT
);
CREATE INDEX IF NOT EXISTS ix_batch_status ON upload_batches(processing_status, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS ix_batch_hash ON upload_batches(file_content_hash);
CREATE INDEX IF NOT EXISTS ix_batch_uploader ON upload_batches(uploaded_by, uploaded_at DESC);

CREATE TABLE IF NOT EXISTS upload_rows (
  upload_row_id     TEXT PRIMARY KEY,
  upload_batch_id   TEXT NOT NULL REFERENCES upload_batches(upload_batch_id) ON DELETE CASCADE,
  source_row_number INTEGER NOT NULL,
  business_key      TEXT,
  source_row_hash   TEXT,
  classification    TEXT CHECK (classification IN ('New','Duplicate','Changed','Rejected',
                    'Pending Mapping','Posted')),
  validation_status TEXT NOT NULL
                    CHECK (validation_status IN ('New','Duplicate','Changed','Rejected',
                      'Pending Mapping','Posted')),
  validation_message TEXT,
  duplicate_of_record_id TEXT,
  posted_record_id  TEXT,
  raw_payload       TEXT NOT NULL,              -- JSON baris mentah (harus tetap disimpan)
  normalized_payload TEXT,                      -- JSON hasil normalisasi
  created_at        TEXT NOT NULL,
  updated_at        TEXT,
  UNIQUE (upload_batch_id, source_row_number)
);
CREATE INDEX IF NOT EXISTS ix_row_batch_status ON upload_rows(upload_batch_id, validation_status);
CREATE INDEX IF NOT EXISTS ix_row_hash ON upload_rows(source_row_hash);
CREATE INDEX IF NOT EXISTS ix_row_business_key ON upload_rows(business_key);

-- ---------------------------------------------------------------------------
-- 5. Master Agent (identitas + histori versi)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS master_agent (
  agent_id_internal   TEXT PRIMARY KEY,
  agent_key           TEXT NOT NULL UNIQUE,       -- KODEAGEN/AgentIDSource ternormalisasi
  kodeagen            TEXT NOT NULL,
  agent_id_source     TEXT,
  nama_agent          TEXT,
  branch_code         TEXT REFERENCES master_branch(branch_code),
  status_agent        TEXT,
  is_current          INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0,1)),
  current_version_no  INTEGER NOT NULL DEFAULT 1,
  source_row_hash     TEXT NOT NULL,
  upload_batch_id     TEXT REFERENCES upload_batches(upload_batch_id),
  created_at          TEXT NOT NULL,
  created_by          TEXT,
  updated_at          TEXT,
  updated_by          TEXT
);
CREATE INDEX IF NOT EXISTS ix_agent_branch ON master_agent(branch_code);
CREATE INDEX IF NOT EXISTS ix_agent_name ON master_agent(nama_agent);

CREATE TABLE IF NOT EXISTS master_agent_version (
  agent_version_id    TEXT PRIMARY KEY,
  agent_id_internal   TEXT NOT NULL REFERENCES master_agent(agent_id_internal) ON DELETE RESTRICT,
  version_no          INTEGER NOT NULL,
  previous_version_id TEXT REFERENCES master_agent_version(agent_version_id),
  kodeagen            TEXT NOT NULL,
  agent_id_source     TEXT,
  nama_agent          TEXT,
  branch_code         TEXT REFERENCES master_branch(branch_code),
  status_agent        TEXT,
  source_row_hash     TEXT NOT NULL,
  upload_batch_id     TEXT REFERENCES upload_batches(upload_batch_id),
  is_current          INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0,1)),
  change_reason       TEXT,
  created_at          TEXT NOT NULL,
  created_by          TEXT,
  UNIQUE (agent_id_internal, version_no)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_agent_version_current
  ON master_agent_version(agent_id_internal) WHERE is_current = 1;

-- ---------------------------------------------------------------------------
-- 6. Produksi (transaksi/versi + posisi polis terkini)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS master_produksi (
  production_id       TEXT PRIMARY KEY,
  agent_id_internal   TEXT REFERENCES master_agent(agent_id_internal),
  source_agent_code   TEXT,                       -- kode agen dari file sumber (audit)
  policy_no           TEXT NOT NULL,
  policy_risk_id      TEXT,
  transaction_date    TEXT,
  effective_date      TEXT NOT NULL,
  expiry_date         TEXT,
  transaction_type    TEXT NOT NULL,
  product_code        TEXT REFERENCES master_product(product_code),
  coverage_code       TEXT REFERENCES master_coverage(coverage_code),
  vehicle_or_risk_description TEXT,
  tsi_minor           INTEGER CHECK (tsi_minor IS NULL OR tsi_minor >= 0),
  premium_minor       INTEGER CHECK (premium_minor IS NULL OR premium_minor >= 0),
  currency            TEXT NOT NULL REFERENCES master_currency(currency_code),
  branch_code         TEXT REFERENCES master_branch(branch_code),
  uw_year             INTEGER,
  business_key        TEXT NOT NULL,
  source_row_hash     TEXT NOT NULL,
  upload_batch_id     TEXT REFERENCES upload_batches(upload_batch_id),
  version_no          INTEGER NOT NULL DEFAULT 1,
  previous_record_id  TEXT REFERENCES master_produksi(production_id),
  is_current          INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0,1)),
  record_status       TEXT NOT NULL DEFAULT 'Active'
                      CHECK (record_status IN ('Active','Cancelled','Corrected')),
  validation_status   TEXT NOT NULL DEFAULT 'Posted',
  created_at          TEXT NOT NULL,
  created_by          TEXT,
  updated_at          TEXT,
  updated_by          TEXT,
  approved_at         TEXT,
  approved_by         TEXT,
  cancelled_at        TEXT,
  cancelled_by        TEXT,
  cancellation_reason TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_produksi_hash ON master_produksi(source_row_hash);
CREATE UNIQUE INDEX IF NOT EXISTS ux_produksi_current
  ON master_produksi(business_key) WHERE is_current = 1;
CREATE INDEX IF NOT EXISTS ix_produksi_policy ON master_produksi(policy_no);
CREATE INDEX IF NOT EXISTS ix_produksi_agent ON master_produksi(agent_id_internal);
CREATE INDEX IF NOT EXISTS ix_produksi_period ON master_produksi(effective_date, transaction_date);
CREATE INDEX IF NOT EXISTS ix_produksi_branch ON master_produksi(branch_code);
CREATE INDEX IF NOT EXISTS ix_produksi_current ON master_produksi(is_current, effective_date);

-- ---------------------------------------------------------------------------
-- 7. Claim (identitas claim + settlement)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS claim_master (
  claim_id          TEXT PRIMARY KEY,
  claim_key         TEXT NOT NULL UNIQUE,         -- ClaimNo (+PolicyNo+AgentID bila tidak unik global)
  agent_id_internal TEXT REFERENCES master_agent(agent_id_internal),
  source_agent_code TEXT,
  claim_no          TEXT NOT NULL,
  policy_no         TEXT NOT NULL,
  policy_risk_id    TEXT,
  uw_year           INTEGER,
  branch_code       TEXT REFERENCES master_branch(branch_code),
  product_name      TEXT,
  product_at_loss   TEXT,
  coverage_at_loss  TEXT,
  tsi_at_loss_minor INTEGER CHECK (tsi_at_loss_minor IS NULL OR tsi_at_loss_minor >= 0),
  currency          TEXT REFERENCES master_currency(currency_code),
  cause_of_loss     TEXT REFERENCES master_cause_of_loss(cause_code),
  loss_date         TEXT,
  claim_status      TEXT,
  upload_batch_id   TEXT REFERENCES upload_batches(upload_batch_id),
  created_at        TEXT NOT NULL,
  created_by        TEXT,
  updated_at        TEXT,
  updated_by        TEXT
);
CREATE INDEX IF NOT EXISTS ix_claim_no ON claim_master(claim_no);
CREATE INDEX IF NOT EXISTS ix_claim_policy ON claim_master(policy_no);
CREATE INDEX IF NOT EXISTS ix_claim_agent ON claim_master(agent_id_internal);
CREATE INDEX IF NOT EXISTS ix_claim_uwyear ON claim_master(uw_year);
CREATE INDEX IF NOT EXISTS ix_claim_branch ON claim_master(branch_code);

CREATE TABLE IF NOT EXISTS claim_settlement (
  claim_settlement_id TEXT PRIMARY KEY,
  claim_id            TEXT NOT NULL REFERENCES claim_master(claim_id) ON DELETE RESTRICT,
  settlement_no       TEXT,
  date_of_settlement  TEXT NOT NULL,
  gross_claim_minor   INTEGER CHECK (gross_claim_minor IS NULL OR gross_claim_minor >= 0),
  indemnity_minor     INTEGER,
  deductible_minor    INTEGER,
  salvage_minor       INTEGER,
  subrogation_minor   INTEGER,
  currency            TEXT NOT NULL REFERENCES master_currency(currency_code),
  source_row_hash     TEXT NOT NULL,
  upload_batch_id     TEXT REFERENCES upload_batches(upload_batch_id),
  version_no          INTEGER NOT NULL DEFAULT 1,
  previous_settlement_id TEXT REFERENCES claim_settlement(claim_settlement_id),
  is_current          INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0,1)),
  record_status       TEXT NOT NULL DEFAULT 'Active'
                      CHECK (record_status IN ('Active','Cancelled','Corrected')),
  validation_status   TEXT NOT NULL DEFAULT 'Posted',
  created_at          TEXT NOT NULL,
  created_by          TEXT,
  updated_at          TEXT,
  updated_by          TEXT,
  approved_at         TEXT,
  approved_by         TEXT,
  cancelled_at        TEXT,
  cancelled_by        TEXT,
  cancellation_reason TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_settlement_hash ON claim_settlement(source_row_hash);
CREATE INDEX IF NOT EXISTS ix_settlement_claim ON claim_settlement(claim_id);
CREATE INDEX IF NOT EXISTS ix_settlement_date ON claim_settlement(date_of_settlement);
CREATE INDEX IF NOT EXISTS ix_settlement_currency ON claim_settlement(currency, date_of_settlement);

-- ---------------------------------------------------------------------------
-- 8. Audit trail
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS audit_log (
  audit_id      TEXT PRIMARY KEY,
  entity_type   TEXT NOT NULL,     -- USER|UPLOAD_BATCH|MASTER_AGENT|PRODUCTION|CLAIM|SETTLEMENT|...
  entity_id     TEXT NOT NULL,
  action        TEXT NOT NULL,     -- CREATE|UPDATE|STATUS_CHANGE|APPROVE|REJECT|CANCEL|POST|OVERRIDE|LOGIN|EXPORT
  actor_id      TEXT,
  actor_role    TEXT,
  actor_name    TEXT,
  occurred_at   TEXT NOT NULL,
  before_json   TEXT,
  after_json    TEXT,
  reason        TEXT,
  upload_batch_id TEXT,
  ip_address    TEXT
);
CREATE INDEX IF NOT EXISTS ix_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS ix_audit_time ON audit_log(occurred_at DESC);
CREATE INDEX IF NOT EXISTS ix_audit_actor ON audit_log(actor_id, occurred_at DESC);

-- ---------------------------------------------------------------------------
-- 9. Metadata aplikasi (versi skema)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS app_meta (
  meta_key   TEXT PRIMARY KEY,
  meta_value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
