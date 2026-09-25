/**
 * config.js — Konfigurasi global Ticket Manager Web App
 *
 * ⚠️ ISI nilai-nilai di bawah setelah setup Supabase & n8n!
 */

const CONFIG = {
  // ----------------------------------------------------------
  // SUPABASE
  // Dapatkan dari: Supabase Dashboard → Settings → API
  // ----------------------------------------------------------
  SUPABASE_URL:      'https://sgflrdvkmifkysdsummf.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_5IxbasMdt6iaAZi6Em61wg_F4VnKmqp',

  // ----------------------------------------------------------
  // N8N WEBHOOK
  // Dapatkan setelah import & aktifkan n8n/webhook-lensa.json
  // Contoh: https://n8n.domain-kamu.com/webhook/ukur-lensa
  // ----------------------------------------------------------
  N8N_WEBHOOK_URL: 'https://n8n-server.my.id/webhook/ukur-lensa',

  // ----------------------------------------------------------
  // Tier config — warna & label
  // ----------------------------------------------------------
  TIERS: {
    HVC_DIAMOND: { label: 'DIAMOND', color: '#06b6d4', bg: '#ecfeff', badge: '#0e7490', icon: '💎' },
    HVC_PLATINUM: { label: 'PLATINUM', color: '#8b5cf6', bg: '#f5f3ff', badge: '#6d28d9', icon: '⚪' },
    HVC_GOLD:    { label: 'GOLD',    color: '#f59e0b', bg: '#fffbeb', badge: '#b45309', icon: '🟡' },
    INDIBIZ:     { label: 'INDIBIZ', color: '#3b82f6', bg: '#eff6ff', badge: '#1d4ed8', icon: '🔵' },
    REGULER:     { label: 'REGULER', color: '#6b7280', bg: '#f9fafb', badge: '#374151', icon: '⚫' },
  },

  // ----------------------------------------------------------
  // SLA timer thresholds (dalam menit)
  // ----------------------------------------------------------
  SLA_GREEN:  4 * 60,   // < 4 jam → hijau
  SLA_YELLOW: 8 * 60,   // 4–8 jam → kuning
  // >= 8 jam → merah, lewat deadline → hitam berkedip
};

export default CONFIG;
