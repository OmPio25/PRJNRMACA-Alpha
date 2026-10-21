# Design Spec — NextMitracaReport

Dokumen ini adalah acuan visual dan interaksi untuk SPA di `public/`. Implementasi token ada di
[`public/css/app.css`](../public/css/app.css); komponen bersama ada di `public/js/ui.js`.

## 1. Prinsip

1. **Rapat dan mudah dipindai.** Aplikasi operasional: kepadatan informasi tinggi, tetapi
   hierarki jelas. Angka adalah tokoh utama, dekorasi minimal.
2. **Basis selalu terlihat.** Setiap laporan mencetak basis perhitungan, periode, dan mode
   currency di atas tabel — pengguna tidak perlu menebak.
3. **Jujur pada data.** Tidak ada angka pengganti, tidak ada penjumlahan lintas currency,
   tidak ada status yang dikarang. Data kosong ditampilkan sebagai kosong dengan penjelasan.
4. **Aman dan dapat ditelusuri.** Aksi destruktif meminta alasan, menjelaskan konsekuensi, dan
   mengarahkan ke audit trail.
5. **Tenang, bukan ramai.** Warna aksen dipakai untuk aksi utama dan status; sisanya netral.

## 2. Design tokens

### Warna

| Token | Nilai | Pemakaian |
|---|---|---|
| `--bg` | `#f4f6fa` | Kanvas aplikasi |
| `--surface` | `#ffffff` | Card, tabel, modal |
| `--surface-2` | `#f7f9fc` | Header tabel, tile ringkasan, filter |
| `--surface-3` | `#eef2f8` | Hover baris, track chart |
| `--sidebar` | `#0d1526` | Sidebar |
| `--sidebar-2` | `#131d33` | Sub-permukaan sidebar |
| `--sidebar-text` | `#a7b4c9` | Teks navigasi |
| `--sidebar-active` | `#1b2743` | Item navigasi aktif |
| `--text` | `#101828` | Teks utama |
| `--text-muted` | `#667085` | Deskripsi, label sekunder |
| `--text-faint` | `#98a2b3` | Placeholder, nilai kosong |
| `--border` | `#e3e8ef` | Garis pemisah |
| `--border-strong` | `#cdd5e0` | Border input fokus/aktif |
| `--primary` | `#2457e6` | Aksi utama, tautan, tab aktif |
| `--primary-hover` | `#1b46c2` | Hover aksi utama |
| `--primary-soft` | `#eaf0ff` | Latar pill/aksi sekunder |
| `--accent` | `#0f766e` | Aksen sekunder (agent) |
| `--success` | `#067647` | Posted, Active, tersimpan |
| `--warning` | `#b54708` | Ready for Review, Changed, kurs hilang |
| `--danger` | `#b42318` | Rejected, gagal, pembatalan |
| `--info` | `#175cd3` | New, Pending Mapping, informasi |

Status tidak pernah dikodekan warna saja: selalu ada teks (dan titik) pada `pill`.

### Tipografi

| Token | Ukuran | Pemakaian |
|---|---|---|
| `--text-xs` | 11px | Label uppercase, metadata tabel |
| `--text-sm` | 12.5px | Teks bantu, sel sekunder, tombol kecil |
| `--text-base` | 13.5px | Teks tubuh |
| `--text-md` | 15px | Nilai KPI, judul card |
| `--text-lg` | 18px | Judul halaman di layar kecil |
| `--text-xl` | 22px | Judul halaman |
| `--text-2xl` | 28px | Judul pemasaran/login |

- Sans: `Inter`, fallback `Segoe UI`, system UI.
- Mono: `JetBrains Mono`, fallback Consolas — untuk kode, hash, ID, dan **semua angka tabel**
  agar digit sejajar.
- Angka memakai `font-variant-numeric: tabular-nums`.

### Ruang, bentuk, bayangan

- Skala ruang: 4 / 8 / 12 / 16 / 24 / 32 / 48 px.
- Radius: 6px (kontrol kecil), 10px (card/input), 14px (panel besar).
- Bayangan: `xs` untuk kontrol, `sm` untuk card, `md` untuk dropdown/popover, `lg` untuk modal.
- Fokus keyboard: outline 3px `rgba(36,87,230,.28)` — tidak pernah `outline: none` tanpa pengganti.

## 3. Layout

```
┌──────────────┬──────────────────────────────────────────────┐
│ Sidebar 244  │ Topbar 60: judul • breadcrumb • aksi • user   │
│ (gelap)      ├──────────────────────────────────────────────┤
│ brand        │ Content: max 1440, padding 24 (16 mobile)     │
│ nav grup     │  page-head (judul + deskripsi + aksi)          │
│              │  card / filter / tabel / totals                │
│ footer versi │                                                │
└──────────────┴──────────────────────────────────────────────┘
```

- Sidebar tetap (fixed) pada ≥1024px; di bawah itu menjadi drawer dengan tombol hamburger.
- Topbar sticky; aksi halaman ditempatkan di kanan topbar pada desktop, turun ke bawah judul
  pada mobile.
- Konten memakai lebar penuh hingga 1440px, lalu berhenti agar tabel tidak melebar tak terkendali.
- Grid umum: 12 kolom; form memakai `form-grid` 2 kolom (1 kolom < 768px).
- Breakpoint: **480 / 768 / 1024 / 1180 / 1280**.
- Tabel lebar: horizontal scroll di dalam card dengan header sticky; halaman tidak pernah
  menggulir horizontal.

## 4. Komponen

### Tombol
- `btn-primary`: satu per area aksi (aksi utama halaman).
- `btn-secondary`: aksi pendukung (filter, ekspor, detail).
- `btn-ghost`: aksi rendah bobot (batal, reset, buka).
- `btn-danger`: hanya untuk pembatalan/reject; selalu disertai konfirmasi + alasan.
- `btn-icon`: ikon 18px dengan `aria-label`; target sentuh minimal 36×36px.
- Tinggi kontrol 34–38px; radius 8–10px; transisi 120ms.

### Form
- Label selalu di atas kontrol, wajib ditandai `<span class="req">*</span>`.
- Hint di bawah kontrol untuk format/akibat, bukan placeholder yang hilang saat mengetik.
- Error: border danger + pesan teks di bawah; `aria-invalid="true"`.
- Filter bar: kontrol sejajar, "Terapkan" (secondary) dan "Reset" (ghost); input grow untuk
  pencarian. Nilai filter dipertahankan saat pagination.
- Tanggal memakai input `type="date"`; rentang selalu "Dari"/"Sampai".

### Card
- `card-head`: judul + sub-judul kiri, aksi/ringkasan kanan.
- `card-body`: padding 16–20px; `flush` untuk tabel tanpa padding.
- `card-foot`: aksi akhir (mis. tombol simpan) bila diperlukan.
- Card tidak dipakai untuk membungkus satu tombol; gunakan `page-actions`.

### Tabel
- Header sticky, uppercase 10.5–11px, latar `surface-2`.
- Angka rata kanan + mono; tanggal rata kiri; aksi di kolom kanan tetap terlihat.
- Baris dapat diklik hanya bila seluruh baris adalah tautan; jika tidak, sediakan tombol
  "Detail" eksplisit.
- Sel identitas dua baris: nama/ID utama + metadata kecil (`cell-sub`).
- Empty state menggantikan seluruh area tabel, bukan baris kosong.
- Pagination menampilkan "Menampilkan X–Y dari N baris" + tombol halaman; halaman aktif
  ditandai `aria-current="true"`.

### Status pill
| Status | Tone |
|---|---|
| `Uploaded`, `Cancelled`, `Inactive`, `Duplicate` | neutral |
| `Validating`, `Approved`, `New`, `Pending Mapping` | info |
| `Ready for Review`, `Changed`, `Posted with Exceptions`, `Open` | warning |
| `Posted`, `Active`, `Settled` | success |
| `Rejected`, `Failed` | danger |

### KPI & ringkasan
- `kpi-grid`: 4 kartu per baris (2 di tablet, 1 di ponsel); label 10.5px uppercase, nilai 15px
  tebal, footer penjelas kecil.
- Garis aksen kiri 3px membedakan kelompok KPI; warna tidak menjadi satu-satunya pembeda.
- `summary-tile` 7 kolom untuk detail record (label + nilai); varian warna untuk
  New/Changed/Duplicate/Rejected/Posted/Pending.

### Wizard upload
- `steps`: tiga langkah bernomor. Langkah aktif beraksen, langkah selesai diberi tanda centang
  secara visual (kelas `done`), langkah berikutnya tidak dapat dilompati.
- Dropzone: area besar, dapat diklik dan menerima drag-and-drop, menampilkan nama file + ukuran
  setelah dipilih, serta tombol ganti file.
- Ringkasan validasi memakai tile berwarna per klasifikasi; angka total harus sama dengan
  jumlah tile.
- Tombol posting dinonaktifkan sampai batch `Approved` (kecuali aturan approval dimatikan).

### Banner, toast, modal
- Banner: informational (biru), warning (kuning), danger (merah), success (hijau); selalu
  punya teks, bukan hanya ikon. Dipakai untuk konteks yang harus dibaca (mis. Net Claims Cost
  belum tersedia).
- Toast: konfirmasi singkat 4 detik, `role="status"`, tidak dipakai untuk error yang butuh
  tindakan.
- Modal: judul, isi, dua tombol (Batal secondary, aksi primary/danger). Aksi destruktif wajib
  meminta alasan ≥3 karakter. Fokus masuk ke modal, `Esc` menutup, klik luar tidak menutup
  form yang belum disimpan.

### Chart
- `chartBars`: batang horizontal, satu baris per currency/kategori, nilai di kanan.
- Chart tidak pernah menggabungkan IDR dan USD dalam satu batang atau satu skala.
- Jika tidak ada nominal: teks "Tidak ada nominal untuk ditampilkan", bukan chart kosong.

### Loading, empty, error
- Loading: skeleton baris (bukan spinner penuh halaman) agar layout tidak melompat.
- Empty: ikon netral + judul + penjelasan + satu aksi relevan (jika pengguna berhak).
- Error halaman: judul "Halaman gagal dimuat", pesan aman (tanpa stack/SQL), tombol "Coba lagi".
- Empty state tidak menyalahkan pengguna; jelaskan apa yang bisa dilakukan.

## 5. Spesifikasi halaman

### Login (`#/login`)
Dua panel: kiri gelap berisi nilai produk dan 4 poin alur; kanan form email + kata sandi.
Akun demo ditampilkan kecil di bawah form. Error login muncul di dalam form, bukan alert browser.
Fokus awal pada email. Di ponsel, panel kiri disembunyikan.

### Dashboard (`#/dashboard`)
- 8 KPI dalam dua baris: batch bulan ini, menunggu review, pending mapping, baris posted,
  agent aktif, posisi polis, claim, settlement bulan ini.
- Kiri: chart premi per currency + chart gross claim settled per currency (dipisah).
- Kanan: status batch (pill + jumlah) dan tabel batch terakhir (file, jenis, status, counter,
  pengunggah/waktu).
- Aksi: "Upload data" (jika berhak) dan "Buka laporan".

### Upload (`#/uploads`, `#/uploads/new`, `#/uploads/:id`)
- Daftar: filter jenis/status/pencarian, tabel counter lengkap, pagination.
- Wizard: langkah 1 jenis + format tanggal + catatan + file; langkah 2 hasil validasi
  (tile New/Duplicate/Changed/Rejected/Pending Mapping/Posted) + tabel baris + unduh CSV hasil;
  langkah 3 approval/posting dengan ringkasan dan peringatan bila ada exception.
- Detail: metadata batch, counter, status, riwayat approval/pembatalan, daftar file duplikat,
  tabel baris dengan modal detail (raw + normalized payload), unduh file asli/hasil validasi.
- Aksi tersedia mengikuti flag server (`canValidate`, `canApprove`, `canPost`, `canCancel`).

### Master Agent (`#/agents`, `#/agents/:id`)
- Panel Pending Mapping di atas daftar (jika ada): kode agen, jumlah baris, batch, aksi
  "Buat agent".
- Daftar: kode agen, Agent ID Source, nama, cabang, status, versi, diperbarui.
- Detail: ringkasan identitas, produksi & claim per currency, tabel histori versi (versi,
  nama, cabang, status, alasan, waktu, hash), jejak batch sumber.
- Form ubah menjelaskan bahwa perubahan membuat versi baru.

### Produksi (`#/production`, `#/production/:id`)
- Filter: policy, cabang, produk, currency, jenis transaksi, versi/terkini; toggle
  "posisi polis terkini" yang mengubah endpoint dan label basis.
- Tabel: policy/risk, agent, effective + jenis, produk/coverage, TSI, premi + currency,
  versi/current, status.
- Detail: 7 tile ringkasan (premi, TSI, currency, agent, cabang, UW year, status), rincian
  transaksi, jejak sumber, riwayat versi. Pembatalan meminta alasan dan menjelaskan bahwa
  record tidak dihapus.
- Ekspor CSV mengikuti filter aktif.

### Claim & Settlement (`#/claims`, `#/claims/:id`)
- Filter: claim no, policy no, UW year, cabang, currency, cause, rentang tanggal settlement.
- Tabel: claim/policy, agent, UW year, cause + loss date, jumlah settlement, gross settled
  per currency, status.
- Detail: tile status/jumlah settlement/currency/cause/agent/cabang/TSI at loss, tabel
  settlement (tanggal, gross, indemnity, deductible, salvage, subrogation, status), total per
  currency, jejak sumber, ekspor settlement.
- Pembatalan settlement per baris, dengan alasan; baris tetap tampil sebagai `Cancelled`.

### Laporan (`#/reports?report=...`)
- Tab horizontal untuk 10 laporan; tab aktif jelas dan dapat diakses keyboard.
- Filter: periode, basis tanggal (hanya pilihan yang valid untuk laporan tersebut), group by
  (bila ada), cabang, produk, coverage, currency, cause, jenis transaksi, konversi + jenis kurs.
- Header hasil: banner basis, periode, jumlah baris, mode currency, waktu generate; chip
  konversi berisi kurs dan tanggal.
- Tabel dinamis dari `columns` API; total per currency di bawah tabel (`totals-strip`).
- Peringatan `RATE_MISSING` ditampilkan sebagai banner warning; baris tetap tampil.
- Tombol "Unduh CSV" hanya muncul setelah laporan berhasil dimuat.
- Net Claims Cost: banner informasi bahwa formula belum aktif; tidak ada angka.

### Audit Trail (`#/audit`)
- Kartu traceability: pilih jenis record + ID → tampilkan record, batch, baris sumber,
  pengunggah, hash, payload.
- Filter log: entity type, entity ID, aksi, rentang tanggal.
- Tabel: waktu, entity, ID, aksi, aktor + role, batch, alasan, "Lihat".
- Modal detail menampilkan before/after JSON yang dapat digulir; tidak ada tombol edit.

### Pengaturan (`#/admin?tab=...`)
- Tab hanya muncul sesuai permission: Pengguna & Role, Master Data, Kurs, Business Rules,
  Hash Config.
- Pengguna: tabel nama/email, role, status, jenis upload, cakupan cabang, login terakhir;
  aksi ubah dan reset sandi. Form menyertakan checkbox jenis upload dan cakupan cabang.
- Role: kartu per role dengan chip permission; hanya Administrator dapat mengubah.
- Master data: sub-navigasi jenis master, tabel kode/nama/region/status, form tambah/ubah.
- Kurs: tabel tanggal, pasangan, jenis, nilai, persetujuan; form tambah kurs.
- Business Rules: banner formula Net Claims Cost bila belum aktif; tabel key/deskripsi/nilai/
  tipe/status/versi; editor menyesuaikan tipe nilai.
- Hash Config: tabel versi/jenis/kolom hash/business key/efektif/status; form versi baru dengan
  input kolom dipisah koma dan penjelasan bahwa versi lama tidak berubah.

## 6. Aturan penyajian data

| Kasus | Tampilan |
|---|---|
| Nominal | Simbol currency asal (`Rp`, `US$`), pemisah ribuan titik, desimal koma. Tidak pernah dijumlahkan lintas currency. |
| Nilai kosong | `—` dengan warna faint; bukan `0`, kecuali memang nol. |
| Tanggal | `02 Apr 2026` (id-ID). Timestamp memakai `02 Apr 2026, 10.15`. |
| Tanggal bisnis vs sistem | Label eksplisit: "Effective Date", "Date Of Settlement", "UW Year". |
| Hash/ID | Mono, ukuran kecil, truncate dengan tooltip `title` bila panjang. |
| Status | Pill teks + titik; makna sama di seluruh halaman. |
| Konversi | Selalu tampilkan kurs + tanggal + metode; jika kurs hilang, tampilkan peringatan dan `—`. |
| Angka negatif | Tanda minus di depan, warna danger hanya bila memang anomali. |

## 7. Copywriting

- Bahasa Indonesia, sentence case, tanpa singkatan internal yang tidak dijelaskan.
- Sebut akibat, bukan hanya perintah: "Record tidak dihapus. Status berubah menjadi Cancelled
  dan berhenti menjadi posisi terkini."
- Hindari menyalahkan pengguna ("File Anda salah") → jelaskan aturan ("Claim No wajib diisi
  pada setiap baris claim").
- Istilah teknis dipertahankan dalam bahasa Inggris bila merupakan nama kolom/konsep
  (`Date Of Settlement`, `Business Key`, `Hash`, `Is Current`).
- Pesan error: apa yang gagal, mengapa, dan langkah berikutnya. Tidak menampilkan stack/SQL.

## 8. Aksesibilitas

- Target WCAG 2.1 AA: kontras teks ≥ 4.5:1 pada permukaan terang.
- Semua kontrol punya `<label for>` atau `aria-label`; ikon dekoratif `aria-hidden="true"`.
- Fokus terlihat di semua elemen interaktif; urutan tab mengikuti urutan visual.
- Skip link "Lewati ke konten utama" pada halaman.
- Status tidak hanya warna; pill menyertakan teks.
- Tabel memakai `<th scope="col">`; angka rata kanan dibaca dengan konteks kolom.
- Modal: `role="dialog"`/`<dialog>`, fokus masuk, `Esc` menutup, judul terhubung
  `aria-labelledby`.
- Pesan dinamis (toast, hasil trace) memakai `role="status"`/`aria-live="polite"`.
- Tombol ikon memiliki nama aksesibel; target sentuh minimal 36px.
- Halaman tetap dapat digunakan pada zoom 200% dan lebar 360px.

## 9. Larangan

- Jangan memakai gradient dekoratif, emoji sebagai ikon status, atau ilustrasi stok.
- Jangan menampilkan chart campuran currency.
- Jangan menyembunyikan aksi kritis hanya di hover; sediakan tombol eksplisit.
- Jangan memakai warna danger untuk aksi non-destruktif.
- Jangan menampilkan angka contoh/placeholder seolah data nyata.
- Jangan menambahkan H1 kedua di dalam konten; judul halaman sudah menjadi H1.
