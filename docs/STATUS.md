# Status Implementasi

Diperbarui: 21 Oktober 2026.

## Ringkas

| Lapisan | Status |
|---|---|
| Skema database (`db/schema.sql`) | Selesai — UploadBatch, UploadRow, MasterAgent (+ histori versi), MasterProduksi, ClaimMaster, ClaimSettlement, ExchangeRate, users/roles, audit_log, settings |
| Migrasi & seed (`db/`) | Selesai |
| API back-end (`src/server/`) | Selesai — auth, uploads, agents, production, claims, reports, dashboard, audit, admin |
| Pipeline upload 12 tahap | Selesai — staging, validasi, normalisasi, business key + SHA-256, validasi master, deduplikasi/klasifikasi, review, approval, posting, audit |
| RBAC & sesi | Selesai — 7 peran, branch scope, cookie sesi HttpOnly, rate limit login |
| Audit trail | Selesai — create/update/status/approve/override, traceable sampai baris sumber |
| Laporan | Selesai — 10 laporan, basis tanggal tercetak, filter, ekspor CSV, pemisahan per currency |
| Front-end SPA (`public/`) | Selesai — dashboard, upload, master agent, produksi, claim, laporan, audit, pengaturan |
| Tes otomatis (`test/`) | Selesai — 44 tes: kriteria penerimaan, kontrak API/RBAC, smoke render SPA |

## Verifikasi

```bash
npm ci
npm test          # 44 tes
npm run reset     # schema + data demo
npm start         # http://localhost:3000
```

Login demo: `admin@demo.local` / `Demo#2026` (berlaku untuk seluruh peran demo).

Uji manual yang sudah dilakukan terhadap build ini:

- Upload `.csv` dan `.xlsx` untuk ketiga jenis data (Agent, Produksi, Claim).
- Re-upload isi identik → seluruh baris `Duplicate`, tidak ada record baru.
- Nama file sama dengan isi berbeda → klasifikasi per baris (`New`/`Changed`/`Duplicate`), bukan per file.
- Ke-10 laporan diakses dengan filter periode → seluruhnya `200`.

## Parameter bisnis yang belum final

Sesuai spesifikasi, nilai berikut **tidak diasumsikan** dan sengaja belum diaktifkan:

- Rumus **Net Claims Cost** — masih `pending_approval`; laporan mengembalikan `available: false`.
- **Alur approval berjenjang** — belum didefinisikan; saat ini satu tingkat (`upload.approve`).
- **Daftar kolom baku final per jenis data** — mengikuti template yang ada; perubahan perlu persetujuan bisnis.

Business rule lain (`unmapped_agent_action`, `default_date_format`, `claim_no_globally_unique`) dapat diubah Administrator melalui **Pengaturan → Business Rules**, dan setiap perubahan tercatat di audit trail.
