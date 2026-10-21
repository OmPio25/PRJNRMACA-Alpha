# Arsitektur — NextMitracaReport

Aplikasi upload, pengelolaan, dan pelaporan Data Agent, Produksi, dan Claim Settled
(Spesifikasi Fungsional dan Teknis v1.0 — Baseline Final).

## 1. Stack (keputusan Tech Lead)

| Lapisan | Teknologi | Alasan |
|---|---|---|
| Runtime | Node.js ≥ 22.5 (diuji pada Node 26) | Tersedia di runtime, tanpa build tooling |
| HTTP | Express 4 | Rute JSON sederhana, middleware RBAC |
| Database | SQLite via `node:sqlite` (`DatabaseSync`) | Relasional nyata (FK, CHECK, partial unique index, transaksi) tanpa service eksternal |
| Upload parsing | `multer` 2 + `exceljs` + parser CSV internal | Menerima `.csv` dan `.xlsx` |
| Front-end | Static SPA: HTML + CSS design system + ES modules vanilla | Tanpa langkah build; `npm start` langsung jalan |
| Auth | Sesi server-side di tabel `sessions`, cookie `sid` HttpOnly | Tidak ada token di localStorage |
| Password | `scrypt` (`node:crypto`) | Bawaan Node, tanpa dependensi |
| Test | `node:test` + `node:assert` | Bawaan Node |

Tidak ada build step. Persyaratan menjalankan (dari root repository):
`npm ci && npm run reset && npm start`. Untuk instalasi yang sudah ada, `npm run migrate`
dan `npm run seed` bersifat idempoten.

## 2. Struktur folder dan kepemilikan file

```
PRJNRMACA-Alpha/  (root repository = root aplikasi)
├─ package.json                  Tech Lead
├─ README.md                     Tech Lead
├─ docs/                         ARCHITECTURE (TL), DATA_MODEL (DB), API_CONTRACT (TL), DESIGN_SPEC (UI/UX)
├─ db/
│  ├─ schema.sql                 Tech Lead (kontrak data, tidak boleh diubah tanpa TL)
│  ├─ database.js                Database Engineering
│  ├─ migrate.js                 Database Engineering
│  ├─ seed.js                    Database Engineering
│  ├─ reset.js                   Database Engineering
│  └─ seed-data/                 Database Engineering
├─ src/
│  ├─ server/index.js            Back-end (bootstrap)
│  ├─ server/app.js              Back-end (express app)
│  ├─ server/config.js           Back-end
│  ├─ server/middleware/         Back-end (auth, rbac, errors, requestId)
│  ├─ server/services/           Back-end (normalisasi, hash, dedup, upload, laporan, audit)
│  ├─ server/routes/             Back-end
│  └─ server/util/               Back-end
├─ public/                       Front-end (index.html, css/, js/)
├─ samples/                      Back-end (CSV contoh per jenis upload)
├─ storage/uploads/              Runtime (file asli, gitignored)
├─ data/                         Runtime (app.db, gitignored)
└─ test/                         api.test.js (kontrak/RBAC), acceptance.test.js (13 kriteria), ui-smoke.test.js (render SPA)
```

Aturan kerja: **satu pemilik per folder**. Jangan mengedit folder milik agen lain;
ajukan perubahan lewat Tech Lead.

## 3. Lapisan server

```
routes (HTTP + validasi bentuk)
  → middleware (sesi, RBAC, branch scope, error envelope)
    → services (business rules, transaksi DB)
      → repositories/queries (SQL parameterized, db/database.js)
        → SQLite
```

- Semua logika bisnis (normalisasi, hash, deduplikasi, klasifikasi, posting, agregasi
  laporan) berada di `src/server/services/` — bukan di route, bukan di front-end.
- Setiap operasi yang mengubah lebih dari satu tabel dibungkus satu transaksi
  (`BEGIN IMMEDIATE … COMMIT`), termasuk penulisan `audit_log`.
- Semua query memakai prepared statement + parameter binding. Tidak ada string SQL
  yang disusun dari input pengguna.
- Error tak terduga → `INTERNAL_ERROR` + log server (tanpa membocorkan detail ke klien).

## 4. Pipeline upload (kontrak perilaku)

1. `POST /uploads` — simpan metadata + `file_content_hash` (SHA-256 byte file) + file asli di
   `storage/uploads/<batchId>__<hash>.<ext>`; status `Uploaded`.
   File identik (hash sama) **tidak** ditolak: dicatat sebagai peringatan
   `duplicateFiles`, keputusan tetap per baris.
2. `POST /uploads/:id/validate` — status `Validating`:
   pembacaan file → staging (`upload_rows.raw_payload`) → validasi template → normalisasi →
   business key + `source_row_hash` → validasi master/referensi → klasifikasi baris →
   ringkasan → status `Ready for Review`. Kesalahan teknis → `Failed`.
3. `POST /uploads/:id/approve|reject` — `Ready for Review → Approved|Rejected` (audit).
4. `POST /uploads/:id/post` — posting baris `New`/`Changed` ke tabel inti dalam satu transaksi;
   status `Posted` (tanpa rejected/pending) atau `Posted with Exceptions`; baris menjadi `Posted`
   dengan `posted_record_id`.
5. `POST /uploads/:id/cancel` — hanya dari `Uploaded`/`Ready for Review`/`Approved`;
   `Cancelled` + alasan + audit. Data inti yang sudah diposting tidak dihapus.

Data mentah, hasil normalisasi, hasil validasi, dan keputusan deduplikasi (termasuk
`duplicate_of_record_id`) tetap tersimpan di `upload_rows` untuk audit.

### 4.1 Normalisasi (service `normalize.js`)

- Teks/kode: trim, kolaps spasi ganda, uppercase untuk kode (policy no, claim no, agent,
  product, coverage, currency, branch).
- Nama/deskripsi bebas: trim + kolaps spasi, **tanpa** mengubah kapitalisasi.
- Tanggal: format eksplisit per batch (`dateFormat`) atau ISO. Format ambigu
  (mis. `01/02/2026` tanpa konfigurasi) → `Rejected` dengan pesan jelas. Output `YYYY-MM-DD`.
  Tanggal mustahil (31/02) → `Rejected`.
- Nominal: hapus pemisah ribuan, dukung koma/titik desimal sesuai format sumber,
  nilai negatif dalam tanda kurung, output integer minor unit (×100).
- Currency: uppercase, harus ada di `master_currency` dan aktif.
- Null: string kosong/`-`/`N/A`/`NULL` → `null` konsisten.
- Produk/cabang/coverage/cause of loss: dipetakan lewat `master_mapping` lalu divalidasi ke master.
- Hash config per jenis upload (versi tersimpan di batch): kolom dan urutannya dari
  `hash_config` aktif; kanonikalisasi = JSON array nilai ternormalisasi (`null` tetap `null`),
  digabung dengan separator `\u001f`, lalu `SHA-256`, disimpan sebagai `sha256:<hex>`.

### 4.2 Business key dan hash

- Agent: `kodeagen` (fallback `agentIdSource`).
- Produksi: `PolicyNo|PolicyRiskID|EffectiveDate|TransactionType` (hash: + Product, Coverage,
  TSI, Premium, Currency).
- Claim: `ClaimNo` bila `claim_no_globally_unique=true`, jika tidak `ClaimNo|PolicyNo|AgentKey`.
  Hash settlement: `ClaimNo|PolicyNo|SettlementDate|Currency|GrossClaim|Indemnity|Deductible|Salvage|Subrogation`.

### 4.3 Klasifikasi baris

| Jenis | Urutan pemeriksaan |
|---|---|
| AGENT | validasi wajib → agent_key baru ⇒ `New`; ada & hash sama ⇒ `Duplicate`; ada & hash beda ⇒ `Changed` (versi baru + `is_current` lama = 0) |
| PRODUCTION | validasi wajib → agent tidak termapping ⇒ `Pending Mapping` (atau `Rejected` sesuai `unmapped_agent_action`) → hash sudah diposting ⇒ `Duplicate` → business key baru ⇒ `New`; business key ada & hash beda ⇒ `Changed` (versi baru, record lama `is_current=0`) → selain itu `Duplicate` |
| CLAIM | claim_no kosong / settlement date kosong-tidak valid / currency tidak valid ⇒ `Rejected` → hash settlement sudah diposting ⇒ `Duplicate` → claim_key baru ⇒ `New` → claim_key ada: settlement_no sama & nominal berubah ⇒ `Changed` (versi settlement baru); selain itu ⇒ `New` (settlement tambahan pada claim yang sama) |

`Changed` pada posting **tidak menghapus** record lama: `version_no+1`,
`previous_record_id`, `is_current=0` untuk lama, `is_current=1` hanya untuk satu record per
business key (partial unique index).

## 5. RBAC + audit

- Permission matrix: lihat `docs/API_CONTRACT.md` §2. Seed di `db/seed.js`.
- Branch scope diterapkan di query laporan/daftar (bukan hanya UI).
- Aksi yang diaudit: login, create/update user, create/update agent, create batch, validate,
  approve, reject, post, cancel (batch/produksi/settlement), perubahan kurs, perubahan
  business rule, perubahan master/hash config, ekspor claim. Setiap entri memuat
  `before_json`/`after_json`, aktor, waktu, alasan.
- Tidak ada endpoint DELETE untuk data posted.
- Ekspor claim memerlukan izin `export.claim`; akses file upload hanya untuk pemilik batch,
  `data_operations`, `administrator`, `auditor`.

## 6. Kontrak UI (ringkas; detail di `docs/DESIGN_SPEC.md`)

Tema: profesional, rapat, berbasis data. Sidebar gelap, kanvas terang, aksen biru-teal.
Token aktual ada di `public/css/app.css`; `docs/DESIGN_SPEC.md` adalah acuan visual lengkap.

```
--bg: #f4f6fa; --surface: #ffffff; --surface-2: #f7f9fc; --surface-3: #eef2f8;
--sidebar: #0d1526; --sidebar-2: #131d33; --sidebar-text: #a7b4c9; --sidebar-active: #1b2743;
--text: #101828; --text-muted: #667085; --text-faint: #98a2b3;
--border: #e3e8ef; --border-strong: #cdd5e0;
--primary: #2457e6; --primary-hover: #1b46c2; --primary-soft: #eaf0ff; --accent: #0f766e;
--success: #067647; --success-soft: #e8f8ef;
--warning: #b54708; --warning-soft: #fff6e6;
--danger: #b42318; --danger-soft: #fef1f0;
--info: #175cd3; --info-soft: #eff6ff;
--radius-sm: 6px; --radius: 10px; --radius-lg: 14px;
--space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px; --space-5: 24px; --space-6: 32px;
--font-sans: Inter, "Segoe UI", system-ui, -apple-system, sans-serif;
--font-mono: "JetBrains Mono", Consolas, monospace;
--sidebar-w: 244px; --topbar-h: 60px;
```

- Breakpoint: 480 / 768 / 1024 / 1280. Sidebar → topbar + drawer < 1024.
- Tabel: header sticky, zebra halus, angka rata kanan + font mono, kolom aksi tetap terlihat,
  horizontal scroll dengan shadow tepi (bukan terpotong).
- Status pill: teks + ikon/titik, bukan warna saja.
- Setiap halaman: judul, deskripsi singkat, filter, empty state, loading skeleton, error state.
- Fokus keyboard terlihat (`:focus-visible` outline 2px), semua kontrol punya label aksesibel.
- Format angka Indonesia pada tampilan (pemisah ribuan titik, desimal koma) dengan
  simbol currency asal; nominal lintas currency tidak pernah dijumlahkan.

## 7. Definisi selesai (quality gate)

- `npm test` lulus (kontrak API/RBAC, kriteria penerimaan, dan smoke render SPA).
- Semua 13 kriteria penerimaan pada spesifikasi punya bukti uji otomatis di `test/acceptance.test.js`.
- Tidak ada endpoint yang mengembalikan 500 pada input tidak valid.
- Laporan menyertakan basis perhitungan di header dan tidak menjumlahkan lintas currency.
- Data posted tidak dapat dihapus dari UI.
