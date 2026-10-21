# Data Model — NextMitracaReport

Skema otoritatif ada di [`db/schema.sql`](../db/schema.sql) (SQLite, `PRAGMA foreign_keys = ON`).
Dokumen ini menjelaskan arti tabel, invariant yang dijaga, dan alasan keputusan desain.

## 1. Prinsip umum

| Prinsip | Penerapan |
|---|---|
| Nominal tidak pernah floating point | Semua uang disimpan sebagai `*_minor INTEGER` (×100). Serializer mengubahnya menjadi desimal di JSON. |
| Tanggal ISO-8601 | Tanggal bisnis `YYYY-MM-DD`; timestamp `YYYY-MM-DDTHH:MM:SSZ`. |
| Tidak ada hapus fisik untuk data posted | Pembatalan = `record_status='Cancelled'`, `is_current=0`, alasan, audit. Tidak ada endpoint DELETE. |
| Identitas vs histori | `master_agent` menyimpan identitas + versi aktif; `master_agent_version` menyimpan seluruh histori. Produksi/claim menyimpan rantai versi pada tabel yang sama (`previous_record_id`). |
| Raw data tidak hilang | `upload_rows.raw_payload` menyimpan baris mentah; `normalized_payload` menyimpan hasil normalisasi; `validation_message` menyimpan alasan keputusan. |
| Audit dalam transaksi yang sama | `audit_log` ditulis di dalam `BEGIN IMMEDIATE` bersama perubahan data. |
| Satu versi aktif per business key | Partial unique index `WHERE is_current = 1`. |
| Hash unik per record | `ux_produksi_hash`, `ux_settlement_hash` mencegah record yang sama diposting dua kali. |

## 2. Diagram relasi

```mermaid
erDiagram
  roles ||--o{ role_permissions : has
  roles ||--o{ users : assigned
  users ||--o{ sessions : owns
  users ||--o{ upload_batches : uploads
  upload_batches ||--o{ upload_rows : stages
  upload_batches ||--o{ master_agent : creates
  upload_batches ||--o{ master_produksi : posts
  upload_batches ||--o{ claim_master : posts
  upload_batches ||--o{ claim_settlement : posts
  master_branch ||--o{ master_agent : locates
  master_branch ||--o{ master_produksi : locates
  master_branch ||--o{ claim_master : locates
  master_currency ||--o{ master_produksi : denominates
  master_currency ||--o{ claim_master : denominates
  master_currency ||--o{ claim_settlement : denominates
  master_product ||--o{ master_produksi : product
  master_coverage ||--o{ master_produksi : coverage
  master_cause_of_loss ||--o{ claim_master : cause
  master_agent ||--o{ master_agent_version : history
  master_agent ||--o{ master_produksi : produces
  master_agent ||--o{ claim_master : owns
  master_produksi ||--o{ master_produksi : previous_version
  claim_master ||--o{ claim_settlement : settles
  claim_settlement ||--o{ claim_settlement : previous_version
  upload_rows ||--o| master_produksi : posted_record
  upload_rows ||--o| claim_settlement : posted_record
  audit_log }o--|| users : actor
  audit_log }o--o| upload_batches : context
  exchange_rate }o--|| master_currency : from
  exchange_rate }o--|| master_currency : to
```

## 3. Tabel referensi & konfigurasi

### `roles`, `role_permissions`, `users`, `sessions`
- `roles.role_key` = 7 role: `administrator`, `data_operations`, `uploader`, `underwriting`,
  `claims`, `finance`, `auditor`.
- `role_permissions` adalah relasi banyak-ke-banyak; permission efektif dihitung per request.
- `users.allowed_upload_types` dan `users.branch_scope` disimpan sebagai JSON array. `[]`
  pada `branch_scope` berarti semua cabang.
- `sessions` menyimpan hash token sesi, `expires_at`, dan `user_id`. Cookie browser hanya
  memuat token acak; tidak ada data otorisasi di klien.

### `master_currency`, `master_branch`, `master_product`, `master_coverage`, `master_cause_of_loss`
Master referensi dengan kode alami sebagai PK. Dipakai untuk validasi upload (baris dengan kode
tidak dikenal ditolak), filter laporan, dan label UI. Nonaktif = `is_active = 0`, bukan dihapus.

### `master_mapping`
Pemetaan kode sumber eksternal ke kode internal (`mapping_type`, `source_code`, `internal_code`).
Unik per `(mapping_type, source_code)`. Catatan: mapping kode **agent** tidak memakai tabel ini
karena `master_mapping` tidak mengizinkan tipe `AGENT`; kode sumber agen disimpan sebagai
`master_agent.agent_id_source` dan perubahan mapping dicatat di audit.

### `exchange_rate`
Kurs resmi: `rate_date`, `from_currency`, `to_currency`, `rate_type` (`MID|BUY|SELL|CENTRAL_BANK|CONTRACTUAL`),
`exchange_rate REAL` (bukan nominal uang), `approved_by/at`. Index `ix_rate_lookup` mendukung
pencarian kurs terakhir pada/atau sebelum tanggal tertentu. Konversi laporan dilakukan di
lapisan baca; nilai sumber tidak diubah.

### `business_rules`
Aturan yang dapat diubah tanpa deploy: `rule_key`, `rule_value` (JSON), `data_type`
(`boolean|number|string|json|formula`), `status`, `version_no`, `approved_by/at`.
`net_claim_formula` berstatus `pending_approval` dan nilainya kosong sampai disetujui.

### `hash_config`
Konfigurasi versi hash per jenis upload: `columns_json` (kolom pembentuk hash),
`business_key_json` (kolom business key), `hash_config_version`, `effective_from`, `is_active`.
Batch menyimpan `hash_config_version` yang dipakai, sehingga perubahan konfigurasi tidak
mengubah hash record lama.

## 4. Upload & staging

### `upload_batches`
Satu baris = satu file yang diunggah.

- `file_content_hash` = SHA-256 byte file (`sha256:<hex>`). Hash sama **tidak** menolak upload;
  dipakai untuk menampilkan peringatan `duplicateFiles`. Deduplikasi keputusan tetap per baris.
- Counter: `total_rows`, `new_rows`, `duplicate_rows`, `changed_rows`, `rejected_rows`,
  `pending_mapping_rows`, `posted_rows`.
- `processing_status`: `Uploaded → Validating → Ready for Review → Approved → Posted |
  Posted with Exceptions`; jalur lain `Rejected`, `Cancelled`, `Failed`.
- Menyimpan `approved_by/at`, `rejected_by/at/reason`, `cancelled_by/at/reason` untuk audit.

### `upload_rows`
Staging per baris file.

- `(upload_batch_id, source_row_number)` unik.
- `raw_payload` wajib; `normalized_payload` diisi setelah normalisasi.
- `classification` menyimpan keputusan klasifikasi (`New|Duplicate|Changed|Rejected|Pending Mapping`)
  dan tetap ada setelah `validation_status` berubah menjadi `Posted`. Ini menjaga counter batch
  tetap dapat direkonsiliasi setelah posting.
- `duplicate_of_record_id` menunjuk record yang membuat baris dianggap duplikat.
- `posted_record_id` menunjuk `master_produksi.production_id` / `claim_settlement.claim_settlement_id`
  / `master_agent.agent_id_internal`, menjadi penghubung traceability.

## 5. Master Agent

### `master_agent` (identitas + versi aktif)
- PK internal `agent_id_internal` (mis. `AGT-0001`), terpisah dari kode bisnis.
- `agent_key` unik = `KODEAGEN` ternormalisasi (fallback `AgentIDSource`).
- `current_version_no` menunjuk versi aktif; `is_current` selalu 1 untuk baris ini.
- Produksi/claim melakukan FK ke `agent_id_internal`, **bukan** ke kode agen, sehingga kode
  sumber dapat berubah tanpa memutus relasi.

### `master_agent_version`
Histori lengkap. `(agent_id_internal, version_no)` unik; partial unique index memastikan hanya
satu `is_current = 1` per agent. Setiap perubahan nama/cabang/status menambah versi baru dengan
`previous_version_id` dan `change_reason`.

## 6. Produksi

### `master_produksi`
Satu baris = satu transaksi produksi (bukan satu polis).

- Business key: `PolicyNo|PolicyRiskID|EffectiveDate|TransactionType`.
- `source_row_hash` unik → tidak ada posting ganda untuk isi yang sama.
- Partial unique index `ux_produksi_current` pada `business_key WHERE is_current = 1` → satu
  posisi terkini per polis/risiko.
- Perubahan (`Changed`): baris baru `version_no + 1`, `previous_record_id` menunjuk versi lama,
  versi lama di-set `is_current = 0`. Tidak ada UPDATE nilai historis.
- `record_status`: `Active | Cancelled | Corrected`. Pembatalan tidak menghapus baris.
- `uw_year` dihitung/diisi dari data sumber dan dipakai laporan UW Year.

## 7. Claim & settlement

### `claim_master`
Identitas claim, unik pada `claim_key` (= `ClaimNo`, atau `ClaimNo|PolicyNo|AgentKey` bila
`claim_no_globally_unique = false`). Menyimpan atribut saat loss: `product_at_loss`,
`coverage_at_loss`, `tsi_at_loss_minor`, `cause_of_loss`, `loss_date`, `uw_year`, `currency`.
Satu claim dapat memiliki banyak settlement.

### `claim_settlement`
Satu baris = satu settlement.

- `date_of_settlement` wajib dan menjadi **satu-satunya basis** laporan Claim Settled.
- `source_row_hash` unik → settlement identik tidak diposting dua kali. Settlement tambahan
  dengan nomor/tanggal/nominal berbeda adalah baris baru pada claim yang sama (bukan versi).
- Perubahan settlement dengan `settlement_no` sama dan nominal berubah → versi baru
  (`version_no + 1`, `previous_settlement_id`), versi lama `is_current = 0`.
- `record_status` + `cancelled_*` untuk pembatalan logis.

## 8. Audit & traceability

### `audit_log`
- `entity_type` (mis. `UPLOAD_BATCH`, `PRODUCTION`, `CLAIM`, `SETTLEMENT`, `AGENT`, `ROLE`,
  `BUSINESS_RULE`, `EXCHANGE_RATE`, `MASTER_*`), `entity_id`, `action`
  (`CREATE|UPDATE|STATUS_CHANGE|APPROVE|REJECT|CANCEL|POST|LOGIN|EXPORT|OVERRIDE`).
- `before_json`/`after_json` menyimpan nilai sebelum/sesudah; `reason` untuk alasan wajib.
- `upload_batch_id` menghubungkan aksi ke batch.
- Index: `(entity_type, entity_id)`, `occurred_at DESC`, `(actor_id, occurred_at DESC)`.

Rantai traceability satu angka laporan:

```
laporan (agregasi SQL)
  → master_produksi / claim_settlement        (record aktif, versi terkini)
    → upload_rows.posted_record_id            (baris staging)
      → upload_rows.raw_payload               (isi mentah)
      → upload_batches.upload_batch_id         (file, pengunggah, waktu, hash)
        → audit_log                            (siapa mengubah/memposting, kapan, alasan)
```

Endpoint `GET /api/audit/trace?recordType=PRODUCTION|CLAIM|SETTLEMENT|AGENT&recordId=...`
mengembalikan record, `uploadRow`, `batch`, dan `actor` dalam satu respons.

## 9. Siklus hidup & retensi

| Data | Perlakuan |
|---|---|
| File asli upload | Disimpan di `storage/uploads/<batchId>__<hash>.<ext>`; dapat diunduh dari detail batch. |
| Staging rows | Disimpan permanen; tidak dibersihkan otomatis (bukti validasi). |
| Data posted | Tidak dihapus; pembatalan logis. |
| Audit log | Append-only; tidak ada endpoint update/delete. |
| Sesi | Kedaluwarsa 8 jam (default); baris kedaluwarsa dapat dibersihkan tanpa memengaruhi audit. |
| Database | Backup = salin `data/app.db` (plus `-wal`/`-shm` saat DB aktif) atau hentikan server lalu salin. |

Kebijakan retensi angka (berapa tahun audit disimpan) belum ditetapkan dalam spesifikasi,
sehingga aplikasi tidak memuat penghapusan otomatis.

## 10. Data demo (seed)

`npm run reset` membangun 7 role, 56 permission, 7 user, 2 currency, 5 cabang, 5 produk,
4 coverage, 6 cause of loss, 11 business rule, 3 hash config, 2 kurs, 5 batch upload,
25 upload row, 6 agent, 8 record produksi (termasuk satu rantai versi), 5 claim,
6 settlement, dan 9 entri audit. Data ini deterministik dan dirancang agar 13 kriteria
penerimaan dapat didemonstrasikan tanpa upload manual:

- `POL-2026-0001` memiliki 3 claim (`CLM-2026-0001/0002/0003`).
- `CLM-2026-0001` memiliki 2 settlement (`STL-0001`, `STL-0002`).
- `PRD-0001` (v1) dan `PRD-0101` (v2) menunjukkan perubahan premi.
- `POL-2026-0003` adalah polis USD; `CLM-2025-0007` adalah claim UW Year 2025.
- `UPL-0005` berstatus `Ready for Review` untuk mendemonstrasikan approval.
