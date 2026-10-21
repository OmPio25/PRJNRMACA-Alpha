'use strict';
/**
 * Seed idempoten: peran, pengguna demo, master referensi, konfigurasi,
 * kurs, dan data demo end-to-end (batch upload -> staging -> data inti ->
 * audit) sehingga traceability dapat langsung diuji.
 */
const { getDb, withTransaction, nowIso } = require('./database');
const { migrate } = require('./migrate');
const { hashPassword } = require('./password');
const { canonicalHash, businessKey } = require('./canonical');

const DEMO_PASSWORD = 'Demo#2026';
const SEED_TS = '2026-10-20T08:00:00Z';
const SEED_ACTOR = 'USR-ADMIN';

const PERMISSIONS = {
  administrator: [
    'upload.create', 'upload.view.all', 'upload.approve', 'upload.post', 'upload.cancel',
    'agent.write', 'production.write', 'claim.write',
    'report.view', 'report.financial', 'report.claim', 'report.production',
    'export.claim', 'audit.view',
    'admin.users', 'admin.master', 'admin.rules', 'admin.hash',
  ],
  data_operations: [
    'upload.create', 'upload.view.all', 'upload.approve', 'upload.post', 'upload.cancel',
    'agent.write', 'production.write', 'claim.write',
    'report.view', 'report.financial', 'report.claim', 'report.production',
    'audit.view', 'admin.master',
  ],
  uploader: ['upload.create', 'report.view'],
  underwriting: ['upload.view.all', 'production.write', 'report.view', 'report.production'],
  claims: ['upload.view.all', 'claim.write', 'report.view', 'report.claim', 'export.claim'],
  finance: ['upload.view.all', 'report.view', 'report.financial', 'report.claim',
    'report.production', 'export.claim', 'admin.rules'],
  auditor: ['upload.view.all', 'report.view', 'report.financial', 'report.claim',
    'report.production', 'audit.view'],
};

const ROLES = [
  ['administrator', 'Administrator', 'Mengelola user, role, master data, konfigurasi, dan aturan sistem'],
  ['data_operations', 'Data Operations', 'Meninjau error, mapping, duplicate, dan batch yang memerlukan tindak lanjut'],
  ['uploader', 'Uploader', 'Upload file dan melihat hasil validasi batch miliknya'],
  ['underwriting', 'Underwriting', 'Meninjau aturan produksi, endorsement, polis, produk, dan coverage'],
  ['claims', 'Claims', 'Meninjau klasifikasi claim, settlement, koreksi, dan recovery'],
  ['finance', 'Finance', 'Menetapkan rumus net claim dan kurs konversi resmi'],
  ['auditor', 'Auditor/Reader', 'Membaca laporan dan audit trail tanpa mengubah data'],
];

const USERS = [
  ['USR-ADMIN', 'admin@demo.local', 'Andi Administrator', 'administrator', ['AGENT', 'PRODUCTION', 'CLAIM'], []],
  ['USR-OPS', 'ops@demo.local', 'Oktavia Data Operations', 'data_operations', ['AGENT', 'PRODUCTION', 'CLAIM'], []],
  ['USR-UPLOADER', 'uploader@demo.local', 'Umar Uploader', 'uploader', ['AGENT', 'PRODUCTION', 'CLAIM'], []],
  ['USR-UW', 'uw@demo.local', 'Umi Underwriting', 'underwriting', [], ['JKT', 'BDG']],
  ['USR-CLAIMS', 'claims@demo.local', 'Candra Claims', 'claims', [], []],
  ['USR-FINANCE', 'finance@demo.local', 'Fitri Finance', 'finance', [], []],
  ['USR-AUDITOR', 'auditor@demo.local', 'Ayu Auditor', 'auditor', [], []],
];

const CURRENCIES = [
  ['IDR', 'Indonesian Rupiah'],
  ['USD', 'US Dollar'],
];

const BRANCHES = [
  ['JKT', 'Jakarta', 'Jawa'],
  ['BDG', 'Bandung', 'Jawa'],
  ['SBY', 'Surabaya', 'Jawa'],
  ['MDN', 'Medan', 'Sumatera'],
  ['MKS', 'Makassar', 'Sulawesi'],
];

const PRODUCTS = [
  ['MOTOR', 'Asuransi Kendaraan Bermotor'],
  ['FIRE', 'Asuransi Kebakaran'],
  ['MARINE', 'Asuransi Marine Cargo'],
  ['HEALTH', 'Asuransi Kesehatan'],
  ['PROPERTY', 'Asuransi Property All Risks'],
];

const COVERAGES = [
  ['COMP', 'Comprehensive'],
  ['TLO', 'Total Loss Only'],
  ['FIRE_ALL', 'Fire All Risks'],
  ['CARGO', 'Cargo All Risks'],
];

const CAUSES = [
  ['COLLISION', 'Tabrakan'],
  ['THEFT', 'Pencurian'],
  ['FIRE', 'Kebakaran'],
  ['FLOOD', 'Banjir'],
  ['EARTHQUAKE', 'Gempa Bumi'],
  ['OTHER', 'Lainnya'],
];

const RULES = [
  ['batch_approval_required', true, 'boolean', 'Batch harus disetujui sebelum posting', 'active'],
  ['unmapped_agent_action', 'PENDING_MAPPING', 'string', 'Perlakuan baris dengan agen belum termapping', 'active'],
  ['claim_no_globally_unique', true, 'boolean', 'Claim No unik global; jika false business key memakai ClaimNo+PolicyNo+Agent', 'active'],
  ['default_date_format', 'DD/MM/YYYY', 'string', 'Format tanggal default file sumber', 'active'],
  ['reject_unknown_product', true, 'boolean', 'Tolak produk/cabang/coverage yang tidak ada di master', 'active'],
  ['net_claim_formula', '', 'formula', 'Rumus Net Claims Cost belum disetujui Finance & Claims; jangan diasumsikan', 'pending_approval'],
  ['report_rate_method', 'RATE_AS_OF_PERIOD_END', 'string', 'Metode kurs laporan lintas currency', 'active'],
  ['production_business_key_columns',
    ['PolicyNo', 'PolicyRiskID', 'EffectiveDate', 'TransactionType'], 'json',
    'Kolom business key produksi (butuh persetujuan bila PolicyRiskID tidak tersedia)', 'active'],
  ['production_hash_columns',
    ['PolicyNo', 'PolicyRiskID', 'EffectiveDate', 'TransactionType', 'Product', 'Coverage',
      'TSI', 'Premium', 'Currency'], 'json', 'Kolom hash produksi', 'active'],
  ['claim_hash_columns',
    ['ClaimNo', 'PolicyNo', 'SettlementDate', 'Currency', 'GrossClaim', 'Indemnity',
      'Deductible', 'Salvage', 'Subrogation'], 'json', 'Kolom hash settlement klaim', 'active'],
  ['agent_hash_columns',
    ['KODEAGEN', 'AgentIDSource', 'NamaAgent', 'Cabang', 'StatusAgent'], 'json',
    'Kolom hash master agent', 'active'],
];

const AGENTS = [
  { id: 'AGT-0001', key: 'AGT001', kode: 'AGT001', source: 'AGT001', nama: 'Budi Santoso', branch: 'JKT', status: 'Active' },
  { id: 'AGT-0002', key: 'AGT002', kode: 'AGT002', source: 'AGT002', nama: 'Siti Aminah', branch: 'BDG', status: 'Active' },
  { id: 'AGT-0003', key: 'AGT003', kode: 'AGT003', source: 'AGT003', nama: 'Rudi Hartono', branch: 'SBY', status: 'Active' },
  { id: 'AGT-0004', key: 'AGT004', kode: 'AGT004', source: 'AGT004', nama: 'Dewi Lestari', branch: 'MDN', status: 'Active' },
  { id: 'AGT-0005', key: 'AGT005', kode: 'AGT005', source: 'AGT005', nama: 'Agus Prakoso', branch: 'MKS', status: 'Active' },
  { id: 'AGT-0006', key: 'AGT006', kode: 'AGT006', source: 'AGT006', nama: 'Rina Wulandari', branch: 'JKT', status: 'Inactive' },
];

/**
 * Definisi produksi. `v2Of` menandai record yang merupakan versi baru dari record lain.
 */
const PRODUCTIONS = [
  {
    id: 'PRD-0001', batch: 'UPL-0002', agent: 'AGT-0001', sourceAgent: 'AGT001',
    policyNo: 'POL-2026-0001', riskId: 'RISK-001', txnDate: '2026-01-20', effDate: '2026-02-01',
    expDate: '2027-02-01', txnType: 'New Business', product: 'MOTOR', coverage: 'COMP',
    riskDesc: 'Toyota Avanza B 1234 XYZ - kendaraan operasional', tsi: 15000000000, premium: 350000000,
    currency: 'IDR', branch: 'JKT',
  },
  {
    id: 'PRD-0002', batch: 'UPL-0002', agent: 'AGT-0002', sourceAgent: 'AGT002',
    policyNo: 'POL-2026-0002', riskId: 'RISK-001', txnDate: '2026-02-15', effDate: '2026-03-01',
    expDate: '2027-03-01', txnType: 'New Business', product: 'FIRE', coverage: 'FIRE_ALL',
    riskDesc: 'Gudang distribusi Bandung - Jl. Soekarno Hatta 88', tsi: 200000000000, premium: 450000000,
    currency: 'IDR', branch: 'BDG',
  },
  {
    id: 'PRD-0003', batch: 'UPL-0002', agent: 'AGT-0003', sourceAgent: 'AGT003',
    policyNo: 'POL-2026-0003', riskId: 'RISK-001', txnDate: '2026-01-05', effDate: '2026-01-15',
    expDate: '2027-01-15', txnType: 'New Business', product: 'MARINE', coverage: 'CARGO',
    riskDesc: 'Marine cargo ekspor Surabaya - Singapore, 40 kontainer', tsi: 25000000, premium: 120000,
    currency: 'USD', branch: 'SBY',
  },
  {
    id: 'PRD-0004', batch: 'UPL-0002', agent: 'AGT-0004', sourceAgent: 'AGT004',
    policyNo: 'POL-2026-0004', riskId: 'RISK-001', txnDate: '2026-03-10', effDate: '2026-04-01',
    expDate: '2027-04-01', txnType: 'New Business', product: 'HEALTH', coverage: 'COMP',
    riskDesc: 'Asuransi kesehatan kumpulan - 120 karyawan', tsi: 50000000000, premium: 1200000000,
    currency: 'IDR', branch: 'MDN',
  },
  {
    id: 'PRD-0005', batch: 'UPL-0002', agent: 'AGT-0001', sourceAgent: 'AGT001',
    policyNo: 'POL-2026-0005', riskId: 'RISK-001', txnDate: '2026-04-12', effDate: '2026-05-01',
    expDate: '2027-05-01', txnType: 'New Business', product: 'PROPERTY', coverage: 'FIRE_ALL',
    riskDesc: 'Property all risks - gedung kantor Jakarta Selatan', tsi: 150000000000, premium: 280000000,
    currency: 'IDR', branch: 'JKT',
  },
  {
    id: 'PRD-0006', batch: 'UPL-0002', agent: 'AGT-0005', sourceAgent: 'AGT005',
    policyNo: 'POL-2026-0006', riskId: 'RISK-001', txnDate: '2026-05-05', effDate: '2026-06-01',
    expDate: '2027-06-01', txnType: 'New Business', product: 'MOTOR', coverage: 'TLO',
    riskDesc: 'Mitsubishi L300 DD 8899 KL - armada logistik', tsi: 9000000000, premium: 110000000,
    currency: 'IDR', branch: 'MKS',
  },
  // Versi 2: perubahan premi pada POL-2026-0001 (histori, bukan penghapusan)
  {
    id: 'PRD-0101', batch: 'UPL-0003', agent: 'AGT-0001', sourceAgent: 'AGT001',
    policyNo: 'POL-2026-0001', riskId: 'RISK-001', txnDate: '2026-08-01', effDate: '2026-02-01',
    expDate: '2027-02-01', txnType: 'New Business', product: 'MOTOR', coverage: 'COMP',
    riskDesc: 'Toyota Avanza B 1234 XYZ - kendaraan operasional', tsi: 15000000000, premium: 375000000,
    currency: 'IDR', branch: 'JKT', versionNo: 2, previousId: 'PRD-0001', current: 1,
  },
  // Endorsement increase: business key baru (effective date & transaction type berbeda)
  {
    id: 'PRD-0007', batch: 'UPL-0003', agent: 'AGT-0002', sourceAgent: 'AGT002',
    policyNo: 'POL-2026-0002', riskId: 'RISK-001', txnDate: '2026-08-20', effDate: '2026-09-01',
    expDate: '2027-03-01', txnType: 'Endorsement Increase', product: 'FIRE', coverage: 'FIRE_ALL',
    riskDesc: 'Gudang distribusi Bandung - penambahan nilai pertanggungan', tsi: 250000000000,
    premium: 500000000, currency: 'IDR', branch: 'BDG',
  },
];

const CLAIMS = [
  {
    id: 'CLM-0001', batch: 'UPL-0004', agent: 'AGT-0001', sourceAgent: 'AGT001',
    claimNo: 'CLM-2026-0001', policyNo: 'POL-2026-0001', riskId: 'RISK-001', uwYear: 2026,
    branch: 'JKT', productAtLoss: 'MOTOR', coverageAtLoss: 'COMP', tsiAtLoss: 15000000000,
    currency: 'IDR', cause: 'COLLISION', lossDate: '2026-03-11', status: 'Settled',
  },
  {
    id: 'CLM-0002', batch: 'UPL-0004', agent: 'AGT-0001', sourceAgent: 'AGT001',
    claimNo: 'CLM-2026-0002', policyNo: 'POL-2026-0001', riskId: 'RISK-001', uwYear: 2026,
    branch: 'JKT', productAtLoss: 'MOTOR', coverageAtLoss: 'COMP', tsiAtLoss: 15000000000,
    currency: 'IDR', cause: 'THEFT', lossDate: '2026-04-22', status: 'Settled',
  },
  {
    id: 'CLM-0003', batch: 'UPL-0004', agent: 'AGT-0001', sourceAgent: 'AGT001',
    claimNo: 'CLM-2026-0003', policyNo: 'POL-2026-0001', riskId: 'RISK-001', uwYear: 2026,
    branch: 'JKT', productAtLoss: 'MOTOR', coverageAtLoss: 'COMP', tsiAtLoss: 15000000000,
    currency: 'IDR', cause: 'FLOOD', lossDate: '2026-06-30', status: 'Settled',
  },
  {
    id: 'CLM-0004', batch: 'UPL-0004', agent: 'AGT-0003', sourceAgent: 'AGT003',
    claimNo: 'CLM-2026-0004', policyNo: 'POL-2026-0003', riskId: 'RISK-001', uwYear: 2026,
    branch: 'SBY', productAtLoss: 'MARINE', coverageAtLoss: 'CARGO', tsiAtLoss: 25000000,
    currency: 'USD', cause: 'OTHER', lossDate: '2026-05-18', status: 'Settled',
  },
  {
    id: 'CLM-0005', batch: 'UPL-0004', agent: 'AGT-0004', sourceAgent: 'AGT004',
    claimNo: 'CLM-2025-0007', policyNo: 'POL-2025-0099', riskId: 'RISK-001', uwYear: 2025,
    branch: 'MDN', productAtLoss: 'HEALTH', coverageAtLoss: 'COMP', tsiAtLoss: 40000000000,
    currency: 'IDR', cause: 'OTHER', lossDate: '2025-11-02', status: 'Settled',
  },
];

const SETTLEMENTS = [
  {
    id: 'STL-0001', claim: 'CLM-0001', batch: 'UPL-0004', settlementNo: 'SET-0001',
    date: '2026-04-02', gross: 1200000000, indemnity: 1000000000, deductible: 200000000,
    salvage: 50000000, subrogation: 10000000, currency: 'IDR',
  },
  {
    id: 'STL-0002', claim: 'CLM-0001', batch: 'UPL-0004', settlementNo: 'SET-0002',
    date: '2026-06-15', gross: 300000000, indemnity: 250000000, deductible: 50000000,
    salvage: 0, subrogation: 0, currency: 'IDR',
  },
  {
    id: 'STL-0003', claim: 'CLM-0002', batch: 'UPL-0004', settlementNo: 'SET-0003',
    date: '2026-05-20', gross: 750000000, indemnity: 650000000, deductible: 100000000,
    salvage: 25000000, subrogation: 0, currency: 'IDR',
  },
  {
    id: 'STL-0004', claim: 'CLM-0003', batch: 'UPL-0004', settlementNo: 'SET-0004',
    date: '2026-07-11', gross: 400000000, indemnity: 350000000, deductible: 50000000,
    salvage: 0, subrogation: 0, currency: 'IDR',
  },
  {
    id: 'STL-0005', claim: 'CLM-0004', batch: 'UPL-0004', settlementNo: 'SET-0005',
    date: '2026-08-05', gross: 2500000, indemnity: 2000000, deductible: 500000,
    salvage: 100000, subrogation: 50000, currency: 'USD',
  },
  {
    id: 'STL-0006', claim: 'CLM-0005', batch: 'UPL-0004', settlementNo: 'SET-0006',
    date: '2026-02-10', gross: 900000000, indemnity: 800000000, deductible: 100000000,
    salvage: 0, subrogation: 0, currency: 'IDR',
  },
];

function productionRow(p) {
  const bk = businessKey([p.policyNo, p.riskId, p.effDate, p.txnType]);
  const hash = canonicalHash([
    p.policyNo, p.riskId, p.effDate, p.txnType, p.product, p.coverage,
    p.tsi, p.premium, p.currency,
  ]);
  return { businessKey: bk, hash };
}

function settlementRow(s, c) {
  const hash = canonicalHash([
    c.claimNo, c.policyNo, s.date, s.currency,
    s.gross, s.indemnity, s.deductible, s.salvage, s.subrogation,
  ]);
  return { businessKey: businessKey([c.claimNo]), hash };
}

function agentRow(a) {
  return {
    businessKey: businessKey([a.kode]),
    hash: canonicalHash([a.kode, a.source, a.nama, a.branch, a.status]),
  };
}

function computeCounters(rows) {
  const counters = {
    new_rows: 0, duplicate_rows: 0, changed_rows: 0,
    rejected_rows: 0, pending_mapping_rows: 0, posted_rows: 0,
  };
  for (const row of rows) {
    switch (row.classification) {
      case 'New': counters.new_rows += 1; break;
      case 'Duplicate': counters.duplicate_rows += 1; break;
      case 'Changed': counters.changed_rows += 1; break;
      case 'Rejected': counters.rejected_rows += 1; break;
      case 'Pending Mapping': counters.pending_mapping_rows += 1; break;
      default: break;
    }
    if (row.validationStatus === 'Posted') counters.posted_rows += 1;
  }
  return counters;
}

function seed() {
  migrate();
  const db = getDb();
  const ts = nowIso();

  withTransaction(() => {
    const ins = (table, columns, values) => {
      const placeholders = columns.map(() => '?').join(',');
      db.prepare(`INSERT OR IGNORE INTO ${table} (${columns.join(',')}) VALUES (${placeholders})`).run(...values);
    };

    // --- peran & izin ---
    for (const [key, name, desc] of ROLES) {
      ins('roles', ['role_key', 'role_name', 'description'], [key, name, desc]);
    }
    for (const [role, perms] of Object.entries(PERMISSIONS)) {
      for (const perm of perms) {
        ins('role_permissions', ['role_key', 'permission'], [role, perm]);
      }
    }

    // --- pengguna demo ---
    for (const [id, email, name, role, uploads, branches] of USERS) {
      ins('users',
        ['user_id', 'email', 'full_name', 'password_hash', 'role_key', 'status',
          'allowed_upload_types', 'branch_scope', 'must_change_password',
          'created_at', 'created_by', 'updated_at', 'updated_by'],
        [id, email, name, hashPassword(DEMO_PASSWORD), role, 'active',
          JSON.stringify(uploads), JSON.stringify(branches), 0, ts, SEED_ACTOR, ts, SEED_ACTOR]);
    }

    // --- master referensi ---
    for (const [code, name] of CURRENCIES) {
      ins('master_currency', ['currency_code', 'currency_name', 'is_active', 'created_at', 'created_by'],
        [code, name, 1, ts, SEED_ACTOR]);
    }
    for (const [code, name, region] of BRANCHES) {
      ins('master_branch', ['branch_code', 'branch_name', 'region', 'is_active', 'created_at', 'created_by'],
        [code, name, region, 1, ts, SEED_ACTOR]);
    }
    for (const [code, name] of PRODUCTS) {
      ins('master_product', ['product_code', 'product_name', 'is_active', 'created_at', 'created_by'],
        [code, name, 1, ts, SEED_ACTOR]);
    }
    for (const [code, name] of COVERAGES) {
      ins('master_coverage', ['coverage_code', 'coverage_name', 'is_active', 'created_at', 'created_by'],
        [code, name, 1, ts, SEED_ACTOR]);
    }
    for (const [code, name] of CAUSES) {
      ins('master_cause_of_loss', ['cause_code', 'cause_name', 'is_active', 'created_at', 'created_by'],
        [code, name, 1, ts, SEED_ACTOR]);
    }

    // --- business rules & hash config ---
    for (const [key, value, type, desc, status] of RULES) {
      ins('business_rules',
        ['rule_key', 'rule_value', 'data_type', 'description', 'status', 'version_no',
          'approved_by', 'approved_at', 'created_at', 'created_by', 'updated_at', 'updated_by'],
        [key, JSON.stringify(value), type, desc, status, 1,
          status === 'active' ? 'USR-ADMIN' : null, status === 'active' ? ts : null,
          ts, SEED_ACTOR, ts, SEED_ACTOR]);
    }
    const hashConfigs = [
      ['AGENT-v1', 'AGENT', ['KODEAGEN', 'AgentIDSource', 'NamaAgent', 'Cabang', 'StatusAgent'], ['KODEAGEN']],
      ['PRODUCTION-v1', 'PRODUCTION',
        ['PolicyNo', 'PolicyRiskID', 'EffectiveDate', 'TransactionType', 'Product', 'Coverage', 'TSI', 'Premium', 'Currency'],
        ['PolicyNo', 'PolicyRiskID', 'EffectiveDate', 'TransactionType']],
      ['CLAIM-v1', 'CLAIM',
        ['ClaimNo', 'PolicyNo', 'SettlementDate', 'Currency', 'GrossClaim', 'Indemnity', 'Deductible', 'Salvage', 'Subrogation'],
        ['ClaimNo']],
    ];
    for (const [version, type, cols, keyCols] of hashConfigs) {
      ins('hash_config',
        ['hash_config_version', 'upload_type', 'columns_json', 'business_key_json',
          'effective_from', 'is_active', 'notes', 'created_at', 'created_by'],
        [version, type, JSON.stringify(cols), JSON.stringify(keyCols),
          '2026-01-01', 1, `Konfigurasi awal hash ${type}`, ts, SEED_ACTOR]);
    }

    // --- kurs resmi ---
    ins('exchange_rate',
      ['exchange_rate_id', 'rate_date', 'from_currency', 'to_currency', 'rate_type',
        'exchange_rate', 'approved_by', 'approved_at', 'created_at', 'created_by'],
      ['RATE-0001', '2026-10-20', 'USD', 'IDR', 'MID', 16250, 'USR-FINANCE', ts, ts, 'USR-FINANCE']);
    ins('exchange_rate',
      ['exchange_rate_id', 'rate_date', 'from_currency', 'to_currency', 'rate_type',
        'exchange_rate', 'approved_by', 'approved_at', 'created_at', 'created_by'],
      ['RATE-0002', '2026-09-30', 'USD', 'IDR', 'MID', 16000, 'USR-FINANCE', ts, ts, 'USR-FINANCE']);

    // --- batch upload + baris staging + data inti ---
    const batch = (id, type, fileName, hash, uploadedAt, status, rows, extra = {}) => {
      const counters = computeCounters(rows);
      ins('upload_batches',
        ['upload_batch_id', 'upload_type', 'original_file_name', 'stored_file_path',
          'file_size_bytes', 'file_content_hash', 'uploaded_by', 'uploaded_at',
          'total_rows', 'new_rows', 'duplicate_rows', 'changed_rows', 'rejected_rows',
          'pending_mapping_rows', 'posted_rows', 'processing_status', 'processed_at',
          'approved_by', 'approved_at', 'hash_config_version', 'date_format', 'remarks',
          'created_at', 'created_by', 'updated_at', 'updated_by'],
        [id, type, fileName, null, 1024 + rows.length * 128, hash, 'USR-UPLOADER', uploadedAt,
          rows.length, counters.new_rows, counters.duplicate_rows, counters.changed_rows,
          counters.rejected_rows, counters.pending_mapping_rows, counters.posted_rows,
          status, extra.processedAt || uploadedAt,
          status === 'Approved' || status.startsWith('Posted') ? 'USR-OPS' : null,
          status === 'Approved' || status.startsWith('Posted') ? uploadedAt : null,
          `${type}-v1`, 'DD/MM/YYYY', extra.remarks || null,
          uploadedAt, 'USR-UPLOADER', uploadedAt, 'USR-UPLOADER']);
      rows.forEach((row, index) => {
        ins('upload_rows',
          ['upload_row_id', 'upload_batch_id', 'source_row_number', 'business_key',
            'source_row_hash', 'classification', 'validation_status', 'validation_message',
            'duplicate_of_record_id', 'posted_record_id', 'raw_payload',
            'normalized_payload', 'created_at', 'updated_at'],
          [`ROW-${id}-${String(index + 2).padStart(3, '0')}`, id, index + 2, row.businessKey,
            row.hash, row.classification, row.validationStatus, row.message || null,
            row.duplicateOf || null, row.postedRecordId || null, JSON.stringify(row.raw || {}),
            JSON.stringify(row.normalized || {}), uploadedAt, uploadedAt]);
      });
      ins('audit_log',
        ['audit_id', 'entity_type', 'entity_id', 'action', 'actor_id', 'actor_role',
          'actor_name', 'occurred_at', 'before_json', 'after_json', 'reason', 'upload_batch_id'],
        [`AUD-${id}-CREATE`, 'UPLOAD_BATCH', id, 'CREATE', 'USR-UPLOADER', 'uploader',
          'Umar Uploader', uploadedAt, null,
          JSON.stringify({ processingStatus: 'Uploaded', totalRows: rows.length }), null, id]);
      if (status.startsWith('Posted')) {
        ins('audit_log',
          ['audit_id', 'entity_type', 'entity_id', 'action', 'actor_id', 'actor_role',
            'actor_name', 'occurred_at', 'before_json', 'after_json', 'reason', 'upload_batch_id'],
          [`AUD-${id}-POST`, 'UPLOAD_BATCH', id, 'POST', 'USR-OPS', 'data_operations',
            'Oktavia Data Operations', extra.processedAt || uploadedAt,
            JSON.stringify({ processingStatus: 'Ready for Review' }),
            JSON.stringify({ processingStatus: status }), null, id]);
      }
    };

    // Batch agent
    const agentRows = AGENTS.map((a) => {
      const { hash, businessKey: bk } = agentRow(a);
      return {
        businessKey: bk, hash, classification: 'New', validationStatus: 'Posted',
        postedRecordId: a.id,
        raw: { KODEAGEN: a.kode, AgentIDSource: a.source, NamaAgent: a.nama, Cabang: a.branch, StatusAgent: a.status },
        normalized: { KODEAGEN: a.kode, AgentIDSource: a.source, NamaAgent: a.nama, Cabang: a.branch, StatusAgent: a.status },
      };
    });
    batch('UPL-0001', 'AGENT', 'AGENT_2026.xlsx', canonicalHash(agentRows.map((r) => r.hash)),
      '2026-10-17T02:10:00Z', 'Posted', agentRows);

    for (const a of AGENTS) {
      const { hash } = agentRow(a);
      ins('master_agent',
        ['agent_id_internal', 'agent_key', 'kodeagen', 'agent_id_source', 'nama_agent',
          'branch_code', 'status_agent', 'is_current', 'current_version_no',
          'source_row_hash', 'upload_batch_id', 'created_at', 'created_by',
          'updated_at', 'updated_by'],
        [a.id, a.key, a.kode, a.source, a.nama, a.branch, a.status, 1, 1,
          hash, 'UPL-0001', '2026-10-17T02:10:00Z', 'USR-UPLOADER',
          '2026-10-17T02:10:00Z', 'USR-UPLOADER']);
      ins('master_agent_version',
        ['agent_version_id', 'agent_id_internal', 'version_no', 'previous_version_id',
          'kodeagen', 'agent_id_source', 'nama_agent', 'branch_code', 'status_agent',
          'source_row_hash', 'upload_batch_id', 'is_current', 'change_reason',
          'created_at', 'created_by'],
        [`AGV-${a.id}-1`, a.id, 1, null, a.kode, a.source, a.nama, a.branch, a.status,
          hash, 'UPL-0001', 1, 'Data awal dari upload AGENT_2026.xlsx',
          '2026-10-17T02:10:00Z', 'USR-UPLOADER']);
    }

    // Batch produksi awal
    const prodRows = PRODUCTIONS.filter((p) => p.batch === 'UPL-0002').map((p) => {
      const { hash, businessKey: bk } = productionRow(p);
      return {
        businessKey: bk, hash, classification: 'New', validationStatus: 'Posted',
        postedRecordId: p.id,
        raw: { POLICY_NO: p.policyNo, POLICY_RISK_ID: p.riskId, EFFECTIVE_DATE: p.effDate,
          TRANSACTION_TYPE: p.txnType, PRODUCT: p.product, COVERAGE: p.coverage,
          TSI: p.tsi / 100, PREMIUM: p.premium / 100, CURRENCY: p.currency, KODEAGEN: p.sourceAgent },
        normalized: { policyNo: p.policyNo, policyRiskId: p.riskId, effectiveDate: p.effDate,
          transactionType: p.txnType, product: p.product, coverage: p.coverage,
          tsi: p.tsi, premium: p.premium, currency: p.currency, agentKey: p.sourceAgent },
      };
    });
    batch('UPL-0002', 'PRODUCTION', 'PRODUKSI.xlsx',
      canonicalHash(prodRows.map((r) => r.hash)),
      '2026-10-17T03:20:00Z', 'Posted', prodRows);

    for (const p of PRODUCTIONS.filter((x) => x.batch === 'UPL-0002')) {
      const { hash, businessKey: bk } = productionRow(p);
      ins('master_produksi',
        ['production_id', 'agent_id_internal', 'source_agent_code', 'policy_no', 'policy_risk_id',
          'transaction_date', 'effective_date', 'expiry_date', 'transaction_type',
          'product_code', 'coverage_code', 'vehicle_or_risk_description', 'tsi_minor',
          'premium_minor', 'currency', 'branch_code', 'uw_year', 'business_key',
          'source_row_hash', 'upload_batch_id', 'version_no', 'previous_record_id',
          'is_current', 'record_status', 'validation_status', 'created_at', 'created_by',
          'updated_at', 'updated_by', 'approved_at', 'approved_by'],
        [p.id, p.agent, p.sourceAgent, p.policyNo, p.riskId, p.txnDate, p.effDate, p.expDate,
          p.txnType, p.product, p.coverage, p.riskDesc, p.tsi, p.premium, p.currency,
          p.branch, Number(p.effDate.slice(0, 4)), bk, hash, p.batch, 1, null,
          p.id === 'PRD-0001' ? 0 : 1, 'Active',          'Posted', '2026-10-17T03:20:00Z', 'USR-UPLOADER', '2026-10-17T03:20:00Z',
          'USR-UPLOADER', '2026-10-17T03:21:00Z', 'USR-OPS']);
    }

    // Batch produksi 2: satu perubahan premi (versi), satu endorsement baru,
    // satu duplicate, satu rejected.
    const p1v2 = PRODUCTIONS.find((p) => p.id === 'PRD-0101');
    const p7 = PRODUCTIONS.find((p) => p.id === 'PRD-0007');
    const p1v1 = PRODUCTIONS.find((p) => p.id === 'PRD-0001');
    const h1v2 = productionRow(p1v2);
    const h7 = productionRow(p7);
    const h1v1 = productionRow(p1v1);
    const prodRows2 = [
      {
        businessKey: h1v2.businessKey, hash: h1v2.hash, classification: 'Changed',
        validationStatus: 'Posted', postedRecordId: 'PRD-0101',
        message: 'Business key sama, premi berubah dari 3.500.000 menjadi 3.750.000; dibuat versi 2',
        raw: { POLICY_NO: 'POL-2026-0001', PREMIUM: 3750000, CURRENCY: 'IDR' },
        normalized: { policyNo: 'POL-2026-0001', premium: 375000000, versionNo: 2 },
      },
      {
        businessKey: h7.businessKey, hash: h7.hash, classification: 'New',
        validationStatus: 'Posted', postedRecordId: 'PRD-0007',
        raw: { POLICY_NO: 'POL-2026-0002', TRANSACTION_TYPE: 'Endorsement Increase' },
        normalized: { policyNo: 'POL-2026-0002', transactionType: 'Endorsement Increase' },
      },
      {
        businessKey: h1v1.businessKey, hash: h1v1.hash, classification: 'Duplicate',
        validationStatus: 'Duplicate', duplicateOf: 'PRD-0001',
        message: 'SourceRowHash sudah pernah diposting pada PRD-0001',
        raw: { POLICY_NO: 'POL-2026-0001', PREMIUM: 3500000 },
        normalized: { policyNo: 'POL-2026-0001', premium: 350000000 },
      },
      {
        businessKey: '', hash: null, classification: 'Rejected', validationStatus: 'Rejected',
        message: 'Currency kosong; nilai wajib tidak boleh kosong',
        raw: { POLICY_NO: 'POL-2026-0009', CURRENCY: '' },
        normalized: null,
      },
    ];
    batch('UPL-0003', 'PRODUCTION', 'PRODUKSI.xlsx',
      canonicalHash(prodRows2.map((r) => r.hash)),
      '2026-10-19T06:45:00Z', 'Posted with Exceptions', prodRows2,
      { remarks: 'Upload ulang dengan nama file sama, isi berbeda' });

    ins('master_produksi',
      ['production_id', 'agent_id_internal', 'source_agent_code', 'policy_no', 'policy_risk_id',
        'transaction_date', 'effective_date', 'expiry_date', 'transaction_type',
        'product_code', 'coverage_code', 'vehicle_or_risk_description', 'tsi_minor',
        'premium_minor', 'currency', 'branch_code', 'uw_year', 'business_key',
        'source_row_hash', 'upload_batch_id', 'version_no', 'previous_record_id',
        'is_current', 'record_status', 'validation_status', 'created_at', 'created_by',
        'updated_at', 'updated_by', 'approved_at', 'approved_by'],
      ['PRD-0101', 'AGT-0001', 'AGT001', 'POL-2026-0001', 'RISK-001', '2026-08-01',
        '2026-02-01', '2027-02-01', 'New Business', 'MOTOR', 'COMP',
        'Toyota Avanza B 1234 XYZ - kendaraan operasional', 15000000000, 375000000,
        'IDR', 'JKT', 2026, h1v2.businessKey, h1v2.hash, 'UPL-0003', 2, 'PRD-0001',
        1, 'Active', 'Posted', '2026-10-19T06:45:00Z', 'USR-UPLOADER',
        '2026-10-19T06:45:00Z', 'USR-UPLOADER', '2026-10-19T06:46:00Z', 'USR-OPS']);

    ins('master_produksi',
      ['production_id', 'agent_id_internal', 'source_agent_code', 'policy_no', 'policy_risk_id',
        'transaction_date', 'effective_date', 'expiry_date', 'transaction_type',
        'product_code', 'coverage_code', 'vehicle_or_risk_description', 'tsi_minor',
        'premium_minor', 'currency', 'branch_code', 'uw_year', 'business_key',
        'source_row_hash', 'upload_batch_id', 'version_no', 'previous_record_id',
        'is_current', 'record_status', 'validation_status', 'created_at', 'created_by',
        'updated_at', 'updated_by', 'approved_at', 'approved_by'],
      ['PRD-0007', 'AGT-0002', 'AGT002', 'POL-2026-0002', 'RISK-001', '2026-08-20',
        '2026-09-01', '2027-03-01', 'Endorsement Increase', 'FIRE', 'FIRE_ALL',
        'Gudang distribusi Bandung - penambahan nilai pertanggungan', 250000000000,
        500000000, 'IDR', 'BDG', 2026, h7.businessKey, h7.hash, 'UPL-0003', 1, null,
        1, 'Active', 'Posted', '2026-10-19T06:45:00Z', 'USR-UPLOADER',
        '2026-10-19T06:45:00Z', 'USR-UPLOADER', '2026-10-19T06:46:00Z', 'USR-OPS']);

    // Batch claim: 5 claim, 6 settlement
    const claimRows = [];
    for (const s of SETTLEMENTS) {
      const c = CLAIMS.find((x) => x.id === s.claim);
      const { hash, businessKey: bk } = settlementRow(s, c);
      claimRows.push({
        businessKey: bk, hash, classification: 'New', validationStatus: 'Posted',
        postedRecordId: s.id,
        raw: { CLAIM_NO: c.claimNo, POLICY_NO: c.policyNo, SETTLEMENT_DATE: s.date,
          GROSS_CLAIM: s.gross / 100, INDEMNITY: s.indemnity / 100, CURRENCY: s.currency },
        normalized: { claimNo: c.claimNo, policyNo: c.policyNo, dateOfSettlement: s.date,
          grossClaim: s.gross, indemnity: s.indemnity, currency: s.currency },
      });
    }
    batch('UPL-0004', 'CLAIM', 'CLAIM_SETTLED_2026.xlsx',
      canonicalHash(claimRows.map((r) => r.hash)),
      '2026-10-20T01:15:00Z', 'Posted', claimRows);

    for (const c of CLAIMS) {
      ins('claim_master',
        ['claim_id', 'claim_key', 'agent_id_internal', 'source_agent_code', 'claim_no',
          'policy_no', 'policy_risk_id', 'uw_year', 'branch_code', 'product_name',
          'product_at_loss', 'coverage_at_loss', 'tsi_at_loss_minor', 'currency',
          'cause_of_loss', 'loss_date', 'claim_status', 'upload_batch_id', 'created_at',
          'created_by', 'updated_at', 'updated_by'],
        [c.id, businessKey([c.claimNo]), c.agent, c.sourceAgent, c.claimNo, c.policyNo,
          c.riskId, c.uwYear, c.branch, null, c.productAtLoss, c.coverageAtLoss,
          c.tsiAtLoss, c.currency, c.cause, c.lossDate, c.status, 'UPL-0004',
          '2026-10-20T01:15:00Z', 'USR-UPLOADER', '2026-10-20T01:15:00Z', 'USR-UPLOADER']);
    }
    for (const s of SETTLEMENTS) {
      const c = CLAIMS.find((x) => x.id === s.claim);
      const { hash } = settlementRow(s, c);
      ins('claim_settlement',
        ['claim_settlement_id', 'claim_id', 'settlement_no', 'date_of_settlement',
          'gross_claim_minor', 'indemnity_minor', 'deductible_minor', 'salvage_minor',
          'subrogation_minor', 'currency', 'source_row_hash', 'upload_batch_id',
          'version_no', 'previous_settlement_id', 'is_current', 'record_status',
          'validation_status', 'created_at', 'created_by', 'updated_at', 'updated_by',
          'approved_at', 'approved_by'],
        [s.id, s.claim, s.settlementNo, s.date, s.gross, s.indemnity, s.deductible,
          s.salvage, s.subrogation, s.currency, hash, 'UPL-0004', 1, null, 1, 'Active',
          'Posted', '2026-10-20T01:15:00Z', 'USR-UPLOADER', '2026-10-20T01:15:00Z',
          'USR-UPLOADER', '2026-10-20T01:16:00Z', 'USR-OPS']);
    }

    // Batch menunggu review: 1 new, 1 duplicate, 1 rejected (belum diposting)
    const reviewRows = [
      {
        businessKey: businessKey(['POL-2026-0010', 'RISK-001', '2026-11-01', 'New Business']),
        hash: canonicalHash(['POL-2026-0010', 'RISK-001', '2026-11-01', 'New Business',
          'MOTOR', 'COMP', 12000000000, 280000000, 'IDR']),
        classification: 'New', validationStatus: 'New',
        raw: { POLICY_NO: 'POL-2026-0010', PREMIUM: 2800000 },
        normalized: { policyNo: 'POL-2026-0010', premium: 280000000 },
      },
      {
        businessKey: h1v1.businessKey, hash: h1v1.hash, classification: 'Duplicate',
        validationStatus: 'Duplicate', duplicateOf: 'PRD-0001',
        message: 'SourceRowHash sudah pernah diposting pada PRD-0001',
        raw: { POLICY_NO: 'POL-2026-0001', PREMIUM: 3500000 },
        normalized: { policyNo: 'POL-2026-0001', premium: 350000000 },
      },
      {
        businessKey: '', hash: null, classification: 'Rejected', validationStatus: 'Rejected',
        message: 'Effective Date tidak valid: 2026-13-45',
        raw: { POLICY_NO: 'POL-2026-0011', EFFECTIVE_DATE: '2026-13-45' },
        normalized: null,
      },
    ];
    batch('UPL-0005', 'PRODUCTION', 'PRODUKSI_NOV.xlsx',
      canonicalHash(['review-batch', ...reviewRows.map((r) => r.hash)]),
      '2026-10-21T00:30:00Z', 'Ready for Review', reviewRows,
      { remarks: 'Menunggu review Data Operations' });
  });

  const counts = {};
  for (const table of ['roles', 'role_permissions', 'users', 'master_currency', 'master_branch',
    'master_product', 'master_coverage', 'master_cause_of_loss', 'business_rules', 'hash_config',
    'exchange_rate', 'upload_batches', 'upload_rows', 'master_agent', 'master_agent_version',
    'master_produksi', 'claim_master', 'claim_settlement', 'audit_log']) {
    counts[table] = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;
  }
  return counts;
}

module.exports = { seed, DEMO_PASSWORD };

if (require.main === module) {
  const counts = seed();
  console.log('[seed] selesai. Jumlah baris per tabel:');
  for (const [table, count] of Object.entries(counts)) {
    console.log(`  ${table.padEnd(24)} ${count}`);
  }
  console.log(`[seed] login demo: admin@demo.local / ${DEMO_PASSWORD}`);
}
