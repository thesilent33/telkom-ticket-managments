-- =============================================================
-- Ticket Manager Web App — Supabase Schema
-- Jalankan di: Supabase Dashboard → SQL Editor → New Query
-- =============================================================

-- Drop jika sudah ada (hati-hati di production!)
-- DROP TABLE IF EXISTS tickets;

CREATE TABLE IF NOT EXISTS tickets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Data tiket
  inc           TEXT,                          -- INC53394750
  inet          TEXT,                          -- 172418813613
  odp           TEXT,                          -- ODP-UBN-FAA/32
  tier          TEXT DEFAULT 'REGULER',        -- HVC_GOLD | HVC_PLATINUM | HVC_DIAMOND | INDIBIZ | REGULER
  rest          TEXT DEFAULT '',               -- info tambahan

  -- Timestamp SLA
  reported_at   TIMESTAMPTZ,                   -- dari "Reported Date"
  sla_deadline  TIMESTAMPTZ,                   -- dari "Maksimal Closed"

  -- Status pengerjaan
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'kendala')),
  perbaikan     TEXT,
  penyebab      TEXT,
  kendala_text  TEXT,
  teknisi       TEXT DEFAULT '',               -- nama teknisi (bebas ketik)

  -- Data redaman dari LENSA
  onu_sn        TEXT,
  onu_status    TEXT,
  onu_rx        TEXT,
  olt_rx        TEXT,
  onu_rx_status TEXT,                          -- ok | warn | error
  olt_rx_status TEXT,
  acs_status    TEXT,
  pcrf          TEXT,
  gpon          TEXT,
  result_text   TEXT,                          -- raw HTML result dari LENSA
  redaman_at    TIMESTAMPTZ,                   -- kapan terakhir diukur

  -- Meta
  raw_input     TEXT DEFAULT '',               -- teks asli yang dipaste
  sort_order    INTEGER DEFAULT 0              -- urutan tampil (ascending)
);

-- Index untuk performa query
CREATE INDEX IF NOT EXISTS idx_tickets_status     ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_tier       ON tickets(tier);
CREATE INDEX IF NOT EXISTS idx_tickets_created    ON tickets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_sort       ON tickets(sort_order ASC, created_at ASC);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tickets_updated_at
  BEFORE UPDATE ON tickets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- Row Level Security
-- Karena tidak ada auth, buka akses untuk anon key
-- =====================================================
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;

-- Policy: izinkan semua operasi untuk anon
CREATE POLICY "Allow all for anon" ON tickets
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- =====================================================
-- Aktifkan Realtime
-- Wajib untuk fitur sync real-time antar browser
-- =====================================================
ALTER TABLE tickets REPLICA IDENTITY FULL;

-- Tambahkan ke publikasi realtime
-- (Jalankan di Supabase: Database → Replication → enable tickets)
-- Atau via SQL:
-- ALTER PUBLICATION supabase_realtime ADD TABLE tickets;

-- =====================================================
-- Fitur Tambahan (Grup & Custom Lists)
-- Jalankan query di bawah jika ingin grup tersinkron multi-perangkat via Supabase:
-- =====================================================
-- ALTER TABLE tickets ADD COLUMN IF NOT EXISTS groups TEXT DEFAULT '';
