# 🎟️ Ticket Manager Web App

Versi web dari Ticket Manager Bot — manajemen tiket gangguan internet untuk teknisi lapangan. Realtime, responsif, mobile-first.

---

## ✅ Fitur

- 📥 **Input tiket** via paste teks (format WO panjang, pipe-separated, multi-baris)
- ⏱️ **Timer SLA** live, color-coded per tiket
- 📶 **Ukur Redaman** via n8n webhook → LENSA
- ✅ **Toggle Selesai / Kendala** dengan input keterangan
- 📋 **Rekap** format siap-salin
- 🔄 **Realtime sync** — semua teknisi lihat update bersamaan
- 💾 **Permanen** — tiket tersimpan di Supabase
- 📱 **Responsif** — optimal di mobile & desktop

---

## 🚀 Setup

### 1. Supabase

1. Buat project baru di [supabase.com](https://supabase.com)
2. Buka **SQL Editor** → paste isi file [`sql/schema.sql`](sql/schema.sql) → Run
3. Buka **Database → Replication** → aktifkan tabel `tickets`
4. Buka **Settings → API** → catat `Project URL` dan `anon public key`

### 2. n8n Webhook

1. Buka n8n → Import workflow [`n8n/webhook-lensa.json`](n8n/webhook-lensa.json)
2. Aktifkan workflow
3. Catat URL webhook yang muncul (contoh: `https://n8n.domain-kamu.com/webhook/ukur-lensa`)

> ⚠️ **Penting:** JWT token LENSA di `n8n/webhook-lensa.json` kemungkinan sudah expired. Update dengan token baru sebelum mengaktifkan workflow.

### 3. Konfigurasi Web App

Edit file [`js/config.js`](js/config.js):

```js
const CONFIG = {
  SUPABASE_URL:      'https://XXXXXXXX.supabase.co',   // ← isi ini
  SUPABASE_ANON_KEY: 'eyJXXXXXXXXXXXXXXXXXXXXXX',    // ← isi ini
  N8N_WEBHOOK_URL:   'https://n8n.domain-kamu.com/webhook/ukur-lensa', // ← isi ini
  // ... (sisanya biarkan)
};
```

### 4. Deploy ke GitHub Pages

```bash
# Di folder telkom-ticket-managments/
git init
git add .
git commit -m "Initial commit: Telkom Ticket Manager Web App"
git remote add origin https://github.com/USERNAME/telkom-ticket-managments.git
git push -u origin main
```

Lalu di GitHub: **Settings → Pages → Source: main branch → Save**

URL akan tersedia di: `https://USERNAME.github.io/ticket-managments/`

---

## 📁 Struktur File

```
ticket-managments/
├── index.html              ← Entry point
├── css/
│   └── style.css           ← Custom styles & animasi
├── js/
│   ├── config.js           ← ⚙️ Konfigurasi (EDIT INI!)
│   ├── parser.js           ← Regex parser tiket
│   ├── supabase-client.js  ← Supabase CRUD + realtime
│   ├── lensa.js            ← Fetch webhook ukur redaman
│   ├── ui.js               ← Render komponen UI
│   └── app.js              ← Main controller
├── n8n/
│   └── webhook-lensa.json  ← Import ke n8n
└── sql/
    └── schema.sql          ← Run di Supabase SQL Editor
```

---

## 📋 Format Input Tiket

### Format 1: WO Panjang (copy-paste dari grup)
```
📢 NEW WO
HVC_GOLD
⏰ Reported Date : 25-09-2026 07:50:47
⏰ Maksimal Closed : 25-09-2026 19:50:47
🆔 No Tiket : INC53394750
🏷 ID Pelanggan : 172418813613
...
```

### Format 2: Pipe-Separated Singkat
```
INC53364888 | 172418214868 | HVC_GOLD | ODP-UBN-FDP/79 | 25.80 Jam
```

### Format 3: Multi-Tiket (satu per baris)
```
INC53364888 | 172418214868 | HVC_GOLD
INC53394750 | 172418813613 | HVC_PLATINUM | ODP-UBN-FAA/32
```

---

## 📋 Format Rekap Output

```
/Tiket ATAU SC : INC53394750
USER : 172418813613
STATUS : CLOSED
PENYEBAB : ONT mati total
PERBAIKAN : Ganti ONT
Nik1 : 16974028
Nik2 : -
Nik3 : -
Kategori : B2C
```

Kategori: `B2B` untuk INDIBIZ, `B2C` untuk semua lainnya.

---

## 🛠️ Tech Stack

| Layer | Teknologi |
|-------|-----------|
| Hosting | GitHub Pages (gratis) |
| Database | Supabase (PostgreSQL + Realtime) |
| UI | Tailwind CSS (CDN) + Vanilla JS |
| API | n8n Webhook (self-hosted) |
