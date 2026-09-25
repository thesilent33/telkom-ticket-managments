/**
 * parser.js — Ticket text parser
 *
 * Mendukung 3 format:
 *   1. WO panjang  (copy-paste dari bot grup WO)
 *   2. Pipe-separated singkat  (manual / format ringkas)
 *   3. Multi-baris  (beberapa tiket sekaligus, satu per baris)
 *
 * Semua field di-extract via regex — tidak bergantung pada
 * posisi/delimiter saja, sehingga akurat meski formatnya campur.
 */

// ─── Tier normalization ───────────────────────────────────────────────────────
const TIER_MAP = [
  { re: /HVC_DIAMOND/i,    value: 'HVC_DIAMOND'  },
  { re: /HVC_PLATINUM/i,   value: 'HVC_PLATINUM' },
  { re: /HVC_GOLD/i,       value: 'HVC_GOLD'     },
  { re: /INDIBIZ|HSI_INDIBIZ/i, value: 'INDIBIZ' },
  { re: /\bDIAMOND\b/i,    value: 'HVC_DIAMOND'  },
  { re: /\bPLATINUM\b/i,   value: 'HVC_PLATINUM' },
  { re: /\bGOLD\b/i,       value: 'HVC_GOLD'     },
  { re: /\bPREMIUM\b/i,    value: 'HVC_PLATINUM' },
  { re: /\bSILVER\b/i,     value: 'HVC_PLATINUM' },
  { re: /REGULER|REGULAR/i, value: 'REGULER'     },
];

function normalizeTier(raw) {
  if (!raw) return 'REGULER';
  for (const { re, value } of TIER_MAP) {
    if (re.test(raw)) return value;
  }
  return 'REGULER';
}

// ─── Date parser: "DD-MM-YYYY HH:MM:SS" → ISO string ─────────────────────────
function parseWODate(str) {
  if (!str || str.trim() === '-') return null;
  const m = str.match(/(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  // Asumsikan WIB (UTC+8)
  return `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}+08:00`;
}

// ─── Core regex extraction ────────────────────────────────────────────────────
function extractFields(text) {
  // INC — ambil yang pertama
  const incM = text.match(/\bINC(\d{7,})\b/i);
  const inc = incM ? `INC${incM[1].toUpperCase()}` : '';

  // iNetID — prioritaskan label "ID Pelanggan" / "User Pelanggan"
  const inetLabel = text.match(/(?:ID Pelanggan|User Pelanggan)\s*[:\|]\s*(172\d{9,12})/i);
  // Fallback: pola 172 diikuti 9–12 digit — tapi hindari match di tengah string Datek panjang
  const inetRaw = text.match(/\b(172\d{9,12})\b/);
  const inet = inetLabel ? inetLabel[1] : (inetRaw ? inetRaw[1] : '');

  // ODP — ambil yang pertama
  const odpM = text.match(/\b(ODP-[A-Z0-9]+-[A-Z0-9\/\.\-]+)/i);
  const odp = odpM ? odpM[1].replace(/\s.*$/, '').trim() : '';

  // Tier — prioritaskan label "Customer Type", fallback scan teks
  const tierLabel = text.match(/Customer Type\s*:\s*([^\n\r,|]+)/i);
  let tierRaw = tierLabel ? tierLabel[1].trim() : '';
  if (!tierRaw) {
    const tierScan = text.match(/\b(HVC_DIAMOND|HVC_PLATINUM|HVC_GOLD|INDIBIZ|HSI_INDIBIZ|DIAMOND|PLATINUM|GOLD|PREMIUM|SILVER|REGULER)\b/i);
    tierRaw = tierScan ? tierScan[1] : '';
  }
  const tier = normalizeTier(tierRaw);

  // Reported Date
  const repM = text.match(/Reported Date\s*:\s*(\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2}:\d{2})/i);
  const reported_at = parseWODate(repM ? repM[1] : null);

  // SLA / Maksimal Closed
  const slaM = text.match(/Maksimal Closed\s*:\s*(\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2}:\d{2})/i);
  const sla_deadline = parseWODate(slaM ? slaM[1] : null);

  return { inc, inet, odp, tier, reported_at, sla_deadline };
}

// ─── Parse satu blok teks (WO panjang ATAU 1 baris pipe) ─────────────────────
function parseSingleBlock(text, isWO = false) {
  const f = extractFields(text);
  if (!f.inc && !f.inet) return null;

  // Ekstrak "rest" dari pipe-format jika ada (dan bukan format WO resmi)
  let rest = '';
  if (!isWO) {
    const pipeParts = text.split('|').map(p => p.trim()).filter(Boolean);
    if (pipeParts.length >= 2) {
      const knownPatterns = [
        /^INC\d+$/i,
        /^172\d{9,12}$/,
        /^ODP-/i,
        /^(HVC_DIAMOND|HVC_PLATINUM|HVC_GOLD|INDIBIZ|REGULER)$/i,
      ];
      const restParts = pipeParts.filter(p =>
        !knownPatterns.some(re => re.test(p))
      );
      rest = restParts.join(' | ').trim();
    }
  }

  let reported_at = f.reported_at;
  if (!reported_at) {
    const jamM = text.match(/(\d+(?:\.\d+)?)\s*Jam/i);
    if (jamM) {
      const hours = parseFloat(jamM[1]);
      reported_at = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    }
  }

  return {
    inc:          f.inc,
    inet:         f.inet,
    odp:          f.odp,
    tier:         f.tier,
    rest,
    reported_at,
    sla_deadline: f.sla_deadline,
    status:       'open',
    raw_input:    text.trim(),
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * parseTickets(text) → Array of ticket objects
 *
 * Mengembalikan array — bisa kosong, satu, atau banyak tiket.
 */
function parseTickets(text) {
  if (!text || !text.trim()) return [];
  const trimmed = text.trim();

  // ── Format 1: WO Panjang ──────────────────────────────────────────────────
  // Ditandai dengan "Reported Date :" atau "NO TIKET :" atau "NEW WO"
  const isWO = /Reported Date\s*:/i.test(trimmed)
    || /NO TIKET\s*:/i.test(trimmed)
    || /NEW WO/i.test(trimmed)
    || /Booking Date\s*:/i.test(trimmed);

  if (isWO) {
    const ticket = parseSingleBlock(trimmed, true);
    return ticket ? [ticket] : [];
  }

  // ── Format 3: Multi-baris (scan tiap baris) ───────────────────────────────
  const lines = trimmed.split('\n').map(l => l.trim()).filter(Boolean);

  // Hitung baris yang mengandung INC atau 172xxxxxxxxx
  const ticketLines = lines.filter(l =>
    /\bINC\d{7,}\b/i.test(l) || /\b172\d{9,12}\b/.test(l)
  );

  if (ticketLines.length > 1) {
    return ticketLines
      .map(line => parseSingleBlock(line))
      .filter(Boolean);
  }

  // ── Format 2: Single line / pipe-separated ────────────────────────────────
  const ticket = parseSingleBlock(trimmed);
  return ticket ? [ticket] : [];
}

/**
 * generateRekap(ticket) → string rekap siap-salin
 */
function generateRekap(ticket) {
  const kategori = ticket.tier === 'INDIBIZ' ? 'B2B' : 'B2C';
  const statusStr = ticket.status === 'kendala' ? 'KENDALA' : 'CLOSED';
  const lines = [
    `/Tiket ATAU SC : ${ticket.inc || '-'}`,
    `USER : ${ticket.inet || '-'}`,
    `STATUS : ${statusStr}`,
    `PENYEBAB : ${ticket.penyebab || ticket.kendala_text || '-'}`,
    `PERBAIKAN : ${ticket.perbaikan || '-'}`,
    `Nik1 : 16974028`,
    `Nik2 : -`,
    `Nik3 : -`,
    `Kategori : ${kategori}`,
  ];
  return lines.join('\n');
}

export { parseTickets, generateRekap, normalizeTier, parseWODate };
