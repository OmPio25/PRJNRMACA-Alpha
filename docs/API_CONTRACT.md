# API Contract — NextMitracaReport v1

Kontrak ini bersifat **mengikat** untuk Back-end (implementasi) dan Front-end (konsumsi).
Jangan mengubah nama field, bentuk respons, atau rute tanpa persetujuan Tech Lead.

## 1. Umum

- Base path: `/api`
- Content-Type: `application/json` (kecuali upload multipart dan unduhan CSV)
- Autentikasi: cookie sesi `sid` (HttpOnly, SameSite=Lax, Path=/). Semua rute `/api/*`
  selain `POST /api/auth/login` dan `GET /api/auth/me` memerlukan sesi aktif.
- Respons sukses:
  ```json
  { "ok": true, "data": { ... } }
  ```
- Respons daftar (paged):
  ```json
  { "ok": true, "data": { "rows": [], "page": 1, "pageSize": 25, "total": 0, "totalPages": 1 } }
  ```
- Respons gagal:
  ```json
  { "ok": false, "error": { "code": "VALIDATION_ERROR", "message": "Pesan untuk pengguna",
                            "details": [{ "field": "email", "message": "..." }] } }
  ```
- Kode error: `AUTH_REQUIRED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_ERROR`,
  `CONFLICT`, `UPLOAD_INVALID`, `INVALID_STATE`, `RATE_LIMITED`, `INTERNAL_ERROR`.
- Status HTTP: 400/401/403/404/409/422/429/500 sesuai kode di atas.
- Paginasi: `?page=1&pageSize=25` (pageSize max 200), `?sort=field&order=asc|desc`.
- Semua nominal di JSON berupa **number desimal** (bukan string), mis. `1234567.89`.
  Penyimpanan internal memakai minor unit (integer), konversi terjadi di layer service.
- Semua tanggal di JSON: string `YYYY-MM-DD`; timestamp ISO-8601 UTC.
- Setiap respons error tidak boleh memuat stack trace/SQL.

## 2. Peran dan izin

`roleKey`: `administrator`, `data_operations`, `uploader`, `underwriting`, `claims`,
`finance`, `auditor`.

Permission key:

| Permission | administrator | data_operations | uploader | underwriting | claims | finance | auditor |
|---|---|---|---|---|---|---|---|
| upload.create | ✓ | ✓ | ✓ (jenis yang diizinkan) | – | – | – | – |
| upload.view.all | ✓ | ✓ | – (hanya miliknya) | ✓ | ✓ | ✓ | ✓ |
| upload.approve | ✓ | ✓ | – | – | – | – | – |
| upload.post | ✓ | ✓ | – | – | – | – | – |
| upload.cancel | ✓ | ✓ | – | – | – | – | – |
| agent.write | ✓ | ✓ | – | – | – | – | – |
| production.write | ✓ | ✓ | – | ✓ | – | – | – |
| claim.write | ✓ | ✓ | – | – | ✓ | – | – |
| report.view | ✓ | ✓ | ✓ (ringkas) | ✓ | ✓ | ✓ | ✓ |
| report.financial | ✓ | ✓ | – | – | – | ✓ | ✓ |
| report.claim | ✓ | ✓ | – | – | ✓ | ✓ | ✓ |
| report.production | ✓ | ✓ | – | ✓ | – | ✓ | ✓ |
| export.claim | ✓ | – | – | – | ✓ | ✓ | – |
| audit.view | ✓ | ✓ | – | – | – | – | ✓ |
| admin.users | ✓ | – | – | – | – | – | – |
| admin.master | ✓ | ✓ | – | – | – | – | – |
| admin.rules | ✓ | – | – | – | – | ✓ (hanya kurs & formula) | – |
| admin.hash | ✓ | – | – | – | – | – | – |

Aturan tambahan:
- `uploader`: hanya jenis upload pada `allowedUploadTypes`; hanya melihat batch miliknya.
- `branchScope`: array kode cabang; `[]` berarti semua cabang. Diterapkan pada laporan,
  daftar produksi, daftar claim, dan daftar agent.
- Semua pemeriksaan izin **wajib di server**. UI hanya menyembunyikan aksi.

## 3. Auth

| Method | Path | Body / Query | Data |
|---|---|---|---|
| POST | /auth/login | `{email, password}` | `{user}` |
| POST | /auth/logout | – | `{loggedOut:true}` |
| GET | /auth/me | – | `{user, permissions:[], roles:[]}` |
| POST | /auth/change-password | `{currentPassword, newPassword}` | `{changed:true}` |

`user`:
```json
{ "userId":"USR-...", "email":"...", "fullName":"...", "roleKey":"data_operations",
  "roleName":"Data Operations", "allowedUploadTypes":["AGENT","PRODUCTION","CLAIM"],
  "branchScope":[], "mustChangePassword":false }
```

## 4. Upload

| Method | Path | Keterangan |
|---|---|---|
| POST | /uploads | multipart: `file`, `uploadType` (AGENT/PRODUCTION/CLAIM), `remarks?`, `dateFormat?` → `{batch}` (status `Uploaded`) |
| GET | /uploads | filter `type,status,q,from,to,mine=1,page,pageSize,sort,order` → paged `batch` |
| GET | /uploads/:id | `{batch, summary, duplicateFiles:[{uploadBatchId,originalFileName,uploadedAt,uploadedBy}]}` |
| POST | /uploads/:id/validate | jalankan staging/validasi/normalisasi/hash/dedup → `{batch, summary}` |
| GET | /uploads/:id/rows | filter `status,q,page,pageSize` → paged `row` |
| GET | /uploads/:id/rows/export | CSV hasil validasi per baris (Content-Disposition attachment) |
| POST | /uploads/:id/approve | `{remarks?}` → `{batch}` |
| POST | /uploads/:id/reject | `{reason}` → `{batch}` |
| POST | /uploads/:id/post | `{remarks?}` → `{batch, summary}` |
| POST | /uploads/:id/cancel | `{reason}` → `{batch}` |
| GET | /uploads/:id/file | unduh file asli |
| GET | /uploads/templates/:type | CSV template kolom baku + contoh baris |

`batch`:
```json
{ "uploadBatchId":"UPL-...", "uploadType":"PRODUCTION", "originalFileName":"PRODUKSI.xlsx",
  "fileContentHash":"sha256:...", "fileSizeBytes":12345,
  "uploadedBy":"USR-...", "uploadedByName":"Nama", "uploadedAt":"2026-10-20T08:00:00Z",
  "totalRows":550, "newRows":40, "duplicateRows":500, "changedRows":6,
  "rejectedRows":3, "pendingMappingRows":1, "postedRows":46,
  "processingStatus":"Posted with Exceptions", "processedAt":"...",
  "approvedBy":null,"approvedAt":null,"rejectedBy":null,"rejectedAt":null,
  "rejectionReason":null,"cancelledBy":null,"cancelledAt":null,"cancellationReason":null,
  "hashConfigVersion":"PRODUCTION-v1", "dateFormat":"DD/MM/YYYY",
  "remarks":null, "createdAt":"...", "canValidate":false,"canApprove":true,
  "canPost":true,"canCancel":true,"canReject":true }
```
`summary` (ringkasan minimal sesuai spesifikasi):
```json
{ "totalRows":0,"newRows":0,"duplicateRows":0,"changedRows":0,
  "rejectedRows":0,"pendingMappingRows":0,"postedRows":0 }
```
`row`:
```json
{ "uploadRowId":"ROW-...","sourceRowNumber":2,"businessKey":"POL-001|RISK-1|2026-02-01|NEW BUSINESS",
  "sourceRowHash":"sha256:...","validationStatus":"New",
  "validationMessage":null,"duplicateOfRecordId":null,"postedRecordId":"PRD-...",
  "rawPayload":{ ... },"normalizedPayload":{ ... },"createdAt":"..." }
```

Aturan transisi status batch:
`Uploaded → Validating → Ready for Review → (Approved) → Posted | Posted with Exceptions`;
`Rejected` (dari review), `Cancelled` (dari Uploaded/Ready for Review/Approved), `Failed` (kesalahan teknis).
`POST /post` diizinkan dari `Ready for Review` bila `business_rules.batch_approval_required=false`,
atau dari `Approved` bila `true` (default `true`).

## 5. Master Agent

| Method | Path | Keterangan |
|---|---|---|
| GET | /agents | `q,branch,statusKey,page,pageSize` → paged `agent` |
| GET | /agents/:id | `{agent, versions:[], productionSummary:[], claimSummary:[]}` |
| POST | /agents | `{kodeagen, agentIdSource?, namaAgent, branchCode, statusAgent}` → `{agent}` |
| PATCH | /agents/:id | field yang boleh diubah: `namaAgent,branchCode,statusAgent` → `{agent}` (versi baru + audit) |
| GET | /agents/pending-mapping | baris upload berstatus `Pending Mapping` yang mengandung kode agen belum termapping → `{rows:[{kodeagen,count,batchIds:[],sampleRows:[]}]}` |
| POST | /agents/resolve-mapping | `{kodeagen, action:"CREATE"|"MAP", agentIdInternal?}` → `{agent, affectedRows}` |

`agent`:
```json
{ "agentIdInternal":"AGT-...","agentKey":"AGT001","kodeagen":"AGT001",
  "agentIdSource":"AGT001","namaAgent":"...","branchCode":"JKT","branchName":"Jakarta",
  "statusAgent":"Active","isCurrent":true,"currentVersionNo":2,
  "sourceRowHash":"sha256:...","uploadBatchId":"UPL-...",
  "createdAt":"...","createdBy":"...","updatedAt":"...","updatedBy":"..." }
```

## 6. Produksi

| Method | Path | Keterangan |
|---|---|---|
| GET | /production | `policyNo,agentId,branch,product,coverage,currency,transactionType,isCurrent,effectiveFrom,effectiveTo,transactionFrom,transactionTo,status,page,pageSize,sort,order` → paged `production` |
| GET | /production/:id | `{record, versions:[], trace:{uploadRow, batch, uploadedBy}}` |
| GET | /production/positions | `isCurrent=true` saja, filter sama, basis `POLICY_AND_RISK` → paged `production` |
| POST | /production/:id/cancel | `{reason}` → `{record}` (record_status=Cancelled, is_current=0, audit) |
| GET | /production/export | CSV (maks 50.000 baris) |

`production`:
```json
{ "productionId":"PRD-...","agentIdInternal":"AGT-...","agentName":"...",
  "sourceAgentCode":"AGT001","policyNo":"POL-001","policyRiskId":"RISK-1",
  "transactionDate":"2026-01-05","effectiveDate":"2026-02-01","expiryDate":"2027-02-01",
  "transactionType":"New Business","productCode":"MOTOR","coverageCode":"COMP",
  "vehicleOrRiskDescription":"...","tsi":150000000.00,"premium":3500000.00,
  "currency":"IDR","branchCode":"JKT","branchName":"Jakarta","uwYear":2026,
  "businessKey":"POL-001|RISK-1|2026-02-01|NEW BUSINESS",
  "sourceRowHash":"sha256:...","uploadBatchId":"UPL-...","versionNo":1,
  "previousRecordId":null,"isCurrent":true,"recordStatus":"Active",
  "createdAt":"...","createdBy":"...","updatedAt":"...","updatedBy":"...",
  "cancelledAt":null,"cancelledBy":null,"cancellationReason":null }
```

## 7. Claim

| Method | Path | Keterangan |
|---|---|---|
| GET | /claims | `claimNo,policyNo,agentId,uwYear,branch,currency,causeOfLoss,settledFrom,settledTo,page,pageSize` → paged `claim` (termasuk agregat settlement) |
| GET | /claims/:id | `{claim, settlements:[], trace:{...}}` |
| POST | /claims/:id/settlements/:settlementId/cancel | `{reason}` → `{settlement}` |
| GET | /claims/export | CSV (butuh `export.claim`) |
| GET | /claims/:id/export | CSV settlement claim (butuh `export.claim`) |

`claim`:
```json
{ "claimId":"CLM-...","claimKey":"CLM/2026/0001","claimNo":"CLM/2026/0001",
  "policyNo":"POL-001","policyRiskId":"RISK-1","agentIdInternal":"AGT-...","agentName":"...",
  "uwYear":2026,"branchCode":"JKT","branchName":"Jakarta",
  "productAtLoss":"MOTOR","coverageAtLoss":"COMP","tsiAtLoss":150000000.00,
  "currency":"IDR","causeOfLoss":"COLLISION","lossDate":"2026-03-11","claimStatus":"Settled",
  "settlementCount":2,"settledAmount":0,"settlementCurrency":"IDR",
  "settlementsByCurrency":[{"currency":"IDR","grossClaim":1000,"indemnity":900,"deductible":100,
    "salvage":0,"subrogation":0,"settlementCount":2}],
  "createdAt":"...","createdBy":"..." }
```
`settlement`:
```json
{ "claimSettlementId":"STL-...","claimId":"CLM-...","claimNo":"CLM/2026/0001",
  "settlementNo":"SET-1","dateOfSettlement":"2026-04-02","grossClaim":12000000.00,
  "indemnity":10000000.00,"deductible":2000000.00,"salvage":500000.00,
  "subrogation":100000.00,"currency":"IDR","sourceRowHash":"sha256:...",
  "uploadBatchId":"UPL-...","versionNo":1,"isCurrent":true,
  "recordStatus":"Active","createdAt":"...","cancelledAt":null,
  "cancellationReason":null }
```

## 8. Laporan

Semua laporan menerima filter:
`from, to, dateBasis=EFFECTIVE_DATE|TRANSACTION_DATE|SETTLEMENT_DATE, agentId, branch, product,
coverage, currency, causeOfLoss, transactionType, groupBy, format=json|csv,
convertTo=IDR|USD, rateType=MID`.

Semua laporan mengembalikan bentuk:
```json
{ "reportKey":"production-summary", "title":"Ringkasan Produksi",
  "basis":"Berdasarkan Effective Date; hanya transaksi valid (bukan seluruh versi)",
  "basisLabel":"Effective Date", "period":{"from":"2026-01-01","to":"2026-12-31"},
  "filters":{...}, "currencyMode":"BY_CURRENCY",
  "columns":[{ "key":"policyNo","label":"Policy No","type":"text|number|date|currency","align":"left|right" }],
  "rows":[{ ... }],
  "totals":[{ "currency":"IDR","premium":..., "tsi":..., ... }],
  "totalsByCurrency":[{ "currency":"IDR", ... }],
  "conversion": null,
  "generatedAt":"...", "rowCount":0 }
```
Bila `convertTo` dipakai: `currencyMode:"CONVERTED"`, `conversion` berisi
`{ "toCurrency":"IDR","rateType":"MID","method":"RATE_AS_OF_PERIOD_END",
  "rates":[{"fromCurrency":"USD","rate":16250,"rateDate":"2026-12-31","exchangeRateId":"RATE-..."}] }`
dan setiap `totalsByCurrency` diberi `convertedAmount` + `rate` + `rateDate`.
Bila kurs tidak tersedia: baris tetap tampil dengan `convertedAmount:null` dan
`warnings:[{code:"RATE_MISSING",message:"..."}]`.

Daftar laporan (`reportKey`):

| reportKey | Judul | Kolom minimum |
|---|---|---|
| production-summary | Ringkasan Produksi | groupBy, currency, transactionCount, policyCount, tsi, premium |
| policy-positions | Posisi Polis Terkini | policyNo, policyRiskId, agent, branch, product, coverage, effectiveDate, expiryDate, tsi, premium, currency |
| production-by-agent | Produksi per Agent | agentId, agentName, branch, transactionCount, policyCount, premium, tsi, currency |
| production-by-branch | Produksi per Cabang | branchCode, branchName, transactionCount, policyCount, premium, tsi, currency |
| settled-claims | Claim Settled per Periode | claimNo, policyNo, dateOfSettlement, grossClaim, indemnity, deductible, salvage, subrogation, currency |
| claims-by-policy | Claim per Polis | policyNo, claimCount, settlementCount, grossClaim, indemnity, currency |
| claims-by-uw-year | Claim per UW Year | uwYear, claimCount, settlementCount, grossClaim, indemnity, currency |
| cause-of-loss | Cause of Loss | causeOfLoss, claimCount, grossClaim, indemnity, currency |
| recovery | Recovery | claimNo, dateOfSettlement, salvage, subrogation, currency |
| upload-audit | Audit Upload | uploadBatchId, uploadType, originalFileName, uploadedBy, uploadedAt, totalRows, newRows, duplicateRows, changedRows, rejectedRows, postedRows, processingStatus |

Aturan perhitungan:
- `production-summary`, `production-by-*`: hanya `master_produksi` dengan
  `record_status='Active'` dan **transaksi/delta** (bukan seluruh versi). Jika `groupBy` tidak
  diisi, default per `transaction_type`.
- `policy-positions`: hanya `is_current = 1` dan `record_status='Active'`; basis
  `Policy + PolicyRiskID`; basis wajib tampil di `basis`/`basisLabel`.
- `settled-claims`: `claim_settlement.is_current=1 AND record_status='Active'` dan
  `date_of_settlement` dalam periode.
- `claims-by-policy` / `claims-by-uw-year` / `cause-of-loss`: hitung
  `COUNT(DISTINCT claim_id)`, jangan hanya claim terakhir.
- Nominal **tidak pernah** dijumlahkan lintas currency. `totals` selalu per currency.
- `Net Claims Cost` tidak dihitung kecuali `business_rules.net_claim_formula.status='active'`;
  bila belum aktif, API `GET /reports/net-claims-cost` mengembalikan
  `ok:true` dengan `available:false` dan `message` penjelasan.
- `export.claim` izin diperlukan untuk CSV claim.

Endpoint tambahan: `GET /reports/meta` → `{reports:[{reportKey,title,groupByOptions,dateBases}],
masters:{branches:[],products:[],currencies:[],coverages:[],causesOfLoss:[]},
netClaimFormula:{available:false,message:"..."}}`

## 9. Audit dan traceability

| Method | Path | Keterangan |
|---|---|---|
| GET | /audit | `entityType,entityId,action,actorId,from,to,page,pageSize` → paged `auditEntry` |
| GET | /audit/trace | `recordType=AGENT|PRODUCTION|CLAIM|SETTLEMENT&recordId=...` → `{record, uploadRow, batch, actor}` |

`auditEntry`:
```json
{ "auditId":"AUD-...","entityType":"PRODUCTION","entityId":"PRD-...","action":"POST",
  "actorId":"USR-...","actorName":"...","actorRole":"data_operations",
  "occurredAt":"...","before":null,"after":{...},"reason":null,"uploadBatchId":"UPL-..." }
```

## 10. Administrasi

| Method | Path | Keterangan |
|---|---|---|
| GET/POST | /admin/users | daftar & buat user (password minimal 10 karakter) |
| PATCH | /admin/users/:id | ubah `fullName,roleKey,status,allowedUploadTypes,branchScope` |
| POST | /admin/users/:id/reset-password | `{newPassword}` → set `mustChangePassword=true` |
| GET | /admin/roles | `{roles:[{roleKey,roleName,description,permissions:[]}]}` |
| PATCH | /admin/roles/:roleKey | `{permissions:[]}` (hanya administrator) |
| GET/POST/PATCH | /admin/currencies, /admin/branches, /admin/products, /admin/coverages, /admin/causes-of-loss, /admin/mappings | master data |
| GET/POST/PATCH | /admin/exchange-rates | kurs; `POST` menyimpan `approvedBy/At` = user finance/administrator |
| GET/PATCH | /admin/business-rules | daftar & ubah nilai aturan (perubahan tercatat di audit + version_no) |
| GET/POST | /admin/hash-configs | versi konfigurasi kolom hash |
| GET | /admin/audit-settings? | (tidak ada; retensi hanya informatif) |

Business rule keys (seed):
`batch_approval_required` (boolean, default true), `unmapped_agent_action`
(`PENDING_MAPPING|REJECT`, default `PENDING_MAPPING`), `claim_no_globally_unique` (default true),
`default_date_format` (default `DD/MM/YYYY`), `reject_unknown_product` (default true),
`net_claim_formula` (status `pending_approval`, default kosong), `report_rate_method`
(default `RATE_AS_OF_PERIOD_END`), `production_business_key_columns` (json),
`production_hash_columns` (json), `claim_hash_columns` (json), `agent_hash_columns` (json).

## 11. Dashboard

`GET /dashboard` →
```json
{ "kpis":{ "batchesThisMonth":0,"pendingReview":0,"pendingMapping":0,
           "postedRowsThisMonth":0,"activeAgents":0,"currentPolicies":0,
           "openClaims":0,"claimSettlementsThisMonth":0 },
  "premiumByCurrency":[{"currency":"IDR","premium":0,"tsi":0,"transactionCount":0}],
  "settledByCurrency":[{"currency":"IDR","grossClaim":0,"indemnity":0,"settlementCount":0}],
  "recentBatches":[{batch}], "statusBreakdown":[{"processingStatus":"Posted","count":0}] }
```
