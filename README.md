# NextMitracaReport

Aplikasi web untuk **upload, validasi, deduplikasi, pengelolaan, dan pelaporan Data Agent,
Produksi, dan Claim Settled**, dibangun mengikuti *Spesifikasi Fungsional dan Teknis v1.0 —
Baseline Final*.

Fitur utama:

- Upload `.csv` / `.xlsx` dengan validasi template, normalisasi, klasifikasi baris, dan
  deduplikasi berbasis **isi data setelah normalisasi — bukan nama file**.
- Pipeline 12 tahap: staging → validasi → normalisasi → business key → hash → dedup →
  klasifikasi → review → approval → posting → pencatatan audit.
- Versioning Produksi dan Agent: perubahan menghasilkan versi baru, versi lama tidak dihapus.
- Claim dengan banyak settlement; pembatalan bersifat logis (status + audit), bukan hapus fisik.
- 10 laporan dengan basis perhitungan yang tercetak, filter lengkap, ekspor CSV, dan
  pemisahan nominal per currency (IDR dan USD tidak pernah dijumlahkan langsung).
- RBAC 7 role yang ditegakkan di server, branch scope, dan audit trail + traceability
  sampai baris file sumber.
- SPA tanpa build step (HTML + CSS design system + ES module vanilla).

Dokumen teknis:

| Dokumen | Isi |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Stack, struktur, pipeline upload, aturan dedup, quality gate |
| [`docs/API_CONTRACT.md`](docs/API_CONTRACT.md) | Kontrak endpoint, bentuk respons, matriks permission |
| [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) | Skema, relasi, invariant, indeks, retensi |
| [`docs/DESIGN_SPEC.md`](docs/DESIGN_SPEC.md) | Design system, komponen, spesifikasi tiap halaman, aksesibilitas |
| [`docs/source-spec.txt`](docs/source-spec.txt) | Teks spesifikasi sumber (acuan ruang lingkup) |

## Menjalankan

Prasyarat: **Node.js ≥ 22.5** (memakai `node:sqlite` bawaan; diuji pada Node 26) dan npm.

```bash
cd app
npm install
npm run reset     # buat schema + data demo dari nol
npm start         # http://localhost:3000
```

`npm run reset` menghapus database dan file upload lama, menjalankan migrasi, lalu mengisi
data demo. Untuk instalasi yang sudah ada, `npm run migrate` dan `npm run seed` bersifat
idempoten.

Konfigurasi lewat environment variable (tanpa file `.env`):

| Variabel | Default | Keterangan |
|---|---|---|
| `PORT` | `3000` | Port HTTP |
| `DB_PATH` | `data/app.db` | Lokasi database SQLite |
| `UPLOAD_DIR` | `storage/uploads` | Lokasi file asli |
| `COOKIE_SECURE` | `0` | Set `1` bila berjalan di belakang HTTPS |
| `MAX_UPLOAD_BYTES` | `10485760` | Batas ukuran file (10 MB) |
| `SESSION_TTL_MS` | `28800000` | Umur sesi (8 jam) |

## Akun demo

Kata sandi semua akun: **`Demo#2026`**

| Email | Role | Cakupan |
|---|---|---|
| `admin@demo.local` | Administrator | Semua modul, user, role, hash config |
| `ops@demo.local` | Data Operations | Upload, review, master data |
| `uploader@demo.local` | Uploader | Upload dan melihat batch miliknya |
| `uw@demo.local` | Underwriting | Produksi, laporan produksi (cabang JKT, BDG) |
| `claims@demo.local` | Claims | Claim, settlement, ekspor claim |
| `finance@demo.local` | Finance | Kurs resmi, business rules, laporan keuangan |
| `auditor@demo.local` | Auditor/Reader | Laporan dan audit trail (read-only) |

## Alur upload

1. **Pilih jenis dan file** — Agent, Produksi, atau Claim. Nama file tidak menentukan
   identitas data; file dengan nama sama boleh diunggah berkali-kali.
2. **Validasi** — sistem membaca file ke staging, menormalisasi tanggal/nominal/kode,
   menghitung business key + hash baris, lalu mengklasifikasi:
   `New`, `Duplicate`, `Changed`, `Pending Mapping`, atau `Rejected`.
3. **Review dan posting** — batch berstatus `Ready for Review` harus di-approve
   (business rule `batch_approval_required`, default aktif), lalu diposting.
   Hasil akhir: `Posted` atau `Posted with Exceptions`.

Aturan penting:

- Baris `Duplicate` tidak diposting ulang.
- Baris `Changed` membuat versi baru; record lama menjadi `is_current = 0`.
- Kode agen yang belum ada di master menjadi `Pending Mapping` dan dapat diselesaikan di
  **Master Agent → Pending Mapping** (buat agent atau petakan).
- Claim tanpa **Claim No**, atau settlement tanpa **tanggal settlement**, ditolak.
- Baris yang ditolak tetap tersimpan beserta pesan validasinya untuk audit.

### Kolom template

Template CSV dapat diunduh dari `GET /api/uploads/templates/:type` atau dari wizard upload.

| Jenis | Kolom baku |
|---|---|
| Agent | `KODEAGEN, AgentIDSource, NamaAgent, Cabang, StatusAgent` |
| Produksi | `PolicyNo, PolicyRiskID, TransactionDate, EffectiveDate, ExpiryDate, TransactionType, Product, Coverage, VehicleOrRiskDescription, TSI, Premium, Currency, KodeAgen, Cabang` |
| Claim | `ClaimNo, PolicyNo, SettlementNo, SettlementDate, GrossClaim, Indemnity, Deductible, Salvage, Subrogation, Currency, KodeAgen, Cabang, UWYear, ProductAtLoss, CoverageAtLoss, TSIAtLoss, CauseOfLoss, LossDate, ClaimStatus` |

Tanggal default `YYYY-MM-DD`; format `DD/MM/YYYY`, `MM/DD/YYYY`, dan `DD-MM-YYYY` dapat
dipilih saat upload. Tanggal ambigu tanpa format eksplisit ditolak.

Contoh file tersedia di [`samples/`](samples/).

## Laporan

| Report key | Judul | Basis |
|---|---|---|
| `production-summary` | Ringkasan Produksi | Effective/Transaction Date, transaksi valid |
| `policy-positions` | Posisi Polis Terkini | `is_current=1` per Policy + PolicyRiskID |
| `production-by-agent` | Produksi per Agent | Transaksi valid per agent |
| `production-by-branch` | Produksi per Cabang | Transaksi valid per cabang |
| `settled-claims` | Claim Settled per Periode | **Date Of Settlement** |
| `claims-by-policy` | Claim per Polis | `COUNT(DISTINCT claim)` |
| `claims-by-uw-year` | Claim per UW Year | **UW Year** claim |
| `cause-of-loss` | Cause of Loss | Settlement aktif |
| `recovery` | Recovery | Salvage & subrogation |
| `upload-audit` | Audit Upload | Counter batch upload |

Semua laporan menerima `from, to, dateBasis, agentId, branch, product, coverage, currency,
causeOfLoss, transactionType, groupBy, convertTo, rateType, format=json|csv`. Nominal selalu
ditampilkan per currency; konversi memakai tabel kurs resmi dan ditandai `currencyMode:
CONVERTED` beserta kurs dan tanggalnya.

**Net Claims Cost tidak dihitung** karena rumus resminya masih berstatus
`pending_approval` di spesifikasi. Endpoint mengembalikan `available: false` dengan
penjelasan, bukan angka asumsi.

## Pengujian

```bash
npm test
```

Tiga lapis pengujian, semuanya memakai database sementara sendiri:

- `test/api.test.js` — kontrak API, autentikasi, RBAC per role, validasi, pagination, aset SPA.
- `test/acceptance.test.js` — 13 kriteria penerimaan spesifikasi secara end-to-end lewat HTTP
  (nama file sama/isi berbeda, re-upload tanpa duplikasi, file campuran lama+baru, versioning
  premi, 3 claim pada 1 polis, 2 settlement pada 1 claim, pemisahan currency, Pending Mapping,
  penolakan claim tanpa Claim No, penolakan settlement tanpa tanggal, basis Date Of Settlement,
  basis UW Year, traceability).
- `test/ui-smoke.test.js` — render setiap halaman SPA di jsdom terhadap API nyata
  (dashboard, upload, agent, produksi, claim, 10 laporan, audit, pengaturan).

Hasil saat ini: **44 test lulus, 0 gagal**.

## Struktur proyek

```
app/
├─ db/            schema.sql, koneksi, migrasi, seed, reset
├─ src/server/    app Express, middleware, routes, services, util
├─ public/        SPA: index.html, css/app.css, js/{api,ui,app}.js, js/pages/*.js
├─ samples/       CSV contoh Agent, Produksi, Claim
├─ test/          api, acceptance, ui-smoke, helpers
├─ docs/          arsitektur, kontrak API, data model, design spec
├─ data/          database runtime (gitignored)
└─ storage/       file upload asli (gitignored)
```

## Keamanan

- Sesi server-side; cookie `sid` HttpOnly + SameSite=Lax. Tidak ada token di browser storage.
- Password di-hash `scrypt` dengan salt; password minimal 10 karakter.
- Semua pemeriksaan permission dan branch scope dilakukan di server; UI hanya menyembunyikan aksi.
- Query memakai prepared statement; tidak ada SQL yang disusun dari input pengguna.
- Respons error tidak memuat stack trace, SQL, atau path internal.
- Upload dibatasi ekstensi, MIME type, dan ukuran; nama file dinormalisasi sebelum disimpan.
- Tidak ada endpoint DELETE untuk data posted; pembatalan selalu tercatat di audit.

## Batasan & keputusan yang menunggu bisnis

Parameter berikut **tidak boleh diasumsikan** dan karena itu belum diaktifkan:

- **Rumus Net Claims Cost** — menunggu persetujuan Finance & Claims; nilai formula kosong.
- **Daftar kolom baku final per jenis data** — aplikasi memakai kolom pada tabel template di
  atas; perubahan harus lewat konfigurasi hash/business key dan persetujuan bisnis.
- **Detail alur approval berjenjang** — saat ini satu tingkat approval (`upload.approve`)
  dengan aturan `batch_approval_required`; persetujuan berjenjang belum dinyatakan di spesifikasi.

Business rule lain (mis. `unmapped_agent_action`, `default_date_format`, `claim_no_globally_unique`)
dapat diubah oleh Administrator/Finance melalui **Pengaturan → Business Rules** dan setiap
perubahan tercatat di audit trail.
