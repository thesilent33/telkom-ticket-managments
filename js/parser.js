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

  // iNetID — prioritaskan label "ID Pelanggan" / "User Pelanggan" / ikon globe 🌐
  const inetLabel = text.match(/(?:ID Pelanggan|User Pelanggan|🌐)\s*[:\|]?\s*([0-9]{9,13})/i);
  const inetRaw = text.match(/\b(172\d{9,12})\b/);
  const inet = inetLabel ? inetLabel[1] : (inetRaw ? inetRaw[1] : '');

  // Nama pelanggan (dari ikon 👤 atau label Customer Name / Nama Pelanggan)
  const namaM = text.match(/(?:👤|Customer Name\s*:|Nama Pelanggan\s*:)\s*([^\n\r(]+)/i);
  const nama = namaM ? namaM[1].trim().replace(/\s+/g, ' ') : '';

  // ODP / ODC — ambil ODP- atau ODC-
  const odpM = text.match(/\b((?:ODP|ODC)-[A-Z0-9]+-[A-Z0-9\/\.\-]+)/i);
  let odp = odpM ? odpM[1].replace(/\s.*$/, '').trim() : '';
  if (!odp) {
    const locM = text.match(/📍\s*([A-Z0-9\/\.\-]+)/i);
    if (locM && locM[1] !== '-') odp = locM[1].trim();
  }

  // Tier — prioritaskan tanda kurung spesifik (HVC_GOLD, dll), lalu label, lalu scan teks
  let tierRaw = '';
  const tierBracket = text.match(/\((HVC_DIAMOND|HVC_PLATINUM|HVC_GOLD|INDIBIZ|HSI_INDIBIZ|DIAMOND|PLATINUM|GOLD|PREMIUM|SILVER|REGULER)\)/i);
  if (tierBracket) {
    tierRaw = tierBracket[1];
  } else {
    const tierLabel = text.match(/Customer Type\s*:\s*([^\n\r,|]+)/i);
    if (tierLabel) {
      tierRaw = tierLabel[1].trim();
    } else {
      const tierScan = text.match(/\b(HVC_DIAMOND|HVC_PLATINUM|HVC_GOLD|INDIBIZ|HSI_INDIBIZ|DIAMOND|PLATINUM|GOLD|PREMIUM|SILVER)\b/i);
      tierRaw = tierScan ? tierScan[1] : '';
    }
  }
  const tier = normalizeTier(tierRaw);

  // Reported Date
  const repM = text.match(/Reported Date\s*:\s*(\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2}:\d{2})/i);
  let reported_at = parseWODate(repM ? repM[1] : null);

  // SLA / Maksimal Closed
  const slaM = text.match(/Maksimal Closed\s*:\s*(\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2}:\d{2})/i);
  let sla_deadline = parseWODate(slaM ? slaM[1] : null);

  // Parse TTR format: "⏱️ TTR: 3j 40m / Max 24j (✅ AMAN)"
  const ttrM = text.match(/TTR:\s*(?:(\d+)\s*j(?:am)?)?\s*(?:(\d+)\s*m(?:enit)?)?(?:\s*\/\s*Max\s*(\d+)\s*j(?:am)?)?/i);
  if (ttrM && !reported_at) {
    const elapsedHours = parseInt(ttrM[1] || '0', 10);
    const elapsedMins = parseInt(ttrM[2] || '0', 10);
    const elapsedMs = (elapsedHours * 3600 + elapsedMins * 60) * 1000;
    const repDate = new Date(Date.now() - elapsedMs);
    reported_at = repDate.toISOString();

    const maxHours = ttrM[3] ? parseInt(ttrM[3], 10) : (tier === 'HVC_DIAMOND' ? 3 : 24);
    sla_deadline = new Date(repDate.getTime() + maxHours * 3600 * 1000).toISOString();
  }

  return { inc, inet, odp, nama, tier, reported_at, sla_deadline };
}

// ─── Parse satu blok teks (WO panjang, baris pipe, atau multi-line tiket) ─────
function parseSingleBlock(text, isWO = false) {
  const f = extractFields(text);
  if (!f.inc && !f.inet) return null;

  // Ekstrak "rest" dari pipe-format jika ada (dan bukan format WO resmi)
  let rest = '';
  if (!isWO) {
    const pipeParts = text.split('|').map(p => p.trim()).filter(Boolean);
    if (pipeParts.length >= 2) {
      const knownPatterns = [
        /^(?:\d+[\.\)]\s*)?INC\d+$/i,
        /^(?:172\d{9,12}|\d{10,13})$/,
        /^(?:ODP|ODC)-/i,
        /^(?:🔵\s*)?(?:Reguler\s+(?:HVC|Non\s+HVC)|HVC_DIAMOND|HVC_PLATINUM|HVC_GOLD|INDIBIZ|REGULER)$/i,
        /^(?:📍|🌐|👤|⏱️)/,
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
    nama:         f.nama,
    tier:         f.tier,
    rest,
    reported_at,
    sla_deadline: f.sla_deadline,
    status:       'open',
    raw_input:    text.trim(),
  };
}

// ─── Chunking / Split multi-tiket ke blok-blok tersendiri ────────────────────
function splitIntoTicketBlocks(rawText) {
  const text = rawText.trim();
  if (!text) return [];

  // Check 1: Multiple WO resmi bot
  if (/(?:📢\s*)?NEW WO\b/i.test(text)) {
    const woMatches = [...text.matchAll(/(?:^|\n)(?=(?:📢\s*)?NEW WO\b)/gi)];
    if (woMatches.length > 1) {
      const blocks = [];
      for (let i = 0; i < woMatches.length; i++) {
        const start = woMatches[i].index;
        const end = i + 1 < woMatches.length ? woMatches[i + 1].index : text.length;
        const chunk = text.slice(start, end).trim();
        if (chunk) blocks.push(chunk);
      }
      return blocks;
    }
  } else if (/NO TIKET\s*:/i.test(text)) {
    const noTiketMatches = [...text.matchAll(/(?:^|\n)(?=NO TIKET\s*:)/gi)];
    if (noTiketMatches.length > 1) {
      const blocks = [];
      for (let i = 0; i < noTiketMatches.length; i++) {
        const start = noTiketMatches[i].index;
        const end = i + 1 < noTiketMatches.length ? noTiketMatches[i + 1].index : text.length;
        const chunk = text.slice(start, end).trim();
        if (chunk) blocks.push(chunk);
      }
      return blocks;
    }
  }

  // Check 2: Multiple nomor INC (dengan nomor urut "1. INC..." atau langsung "INC...")
  const incBoundaryRegex = /(?:^|\n\s*)(?=(?:\d+[\.\)]\s*)?INC\d{7,}\b)/gi;
  const incMatches = [...text.matchAll(incBoundaryRegex)];
  if (incMatches.length > 1) {
    const blocks = [];
    for (let i = 0; i < incMatches.length; i++) {
      const start = incMatches[i].index;
      const end = i + 1 < incMatches.length ? incMatches[i + 1].index : text.length;
      const chunk = text.slice(start, end).trim();
      if (chunk) blocks.push(chunk);
    }
    return blocks;
  }

  // Check 3: Pemisah double newlines (baris kosong antar tiket)
  const doubleNewlineBlocks = text.split(/\n\s*\n+/).map(b => b.trim()).filter(Boolean);
  if (doubleNewlineBlocks.length > 1) {
    const valid = doubleNewlineBlocks.filter(b => /\bINC\d{7,}\b/i.test(b) || /\b172\d{9,12}\b/.test(b));
    if (valid.length > 1) {
      return doubleNewlineBlocks;
    }
  }

  // Check 4: Multiple lines yang masing-masing punya INC dan inet (format single-line berulang)
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const singleLineTickets = lines.filter(l => /\bINC\d{7,}\b/i.test(l) && /\b172\d{9,12}\b/.test(l));
  if (singleLineTickets.length > 1) {
    return singleLineTickets;
  }

  // Check 5: Multiple lines yang masing-masing punya inet 172...
  const linesWithInet = lines.filter(l => /\b172\d{9,12}\b/.test(l));
  if (linesWithInet.length > 1) {
    return linesWithInet;
  }

  return [text];
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * parseTickets(text) → Array of ticket objects
 *
 * Mengembalikan array — bisa kosong, satu, atau banyak tiket.
 */
function parseTickets(text) {
  if (!text || !text.trim()) return [];
  const blocks = splitIntoTicketBlocks(text);
  return blocks.map(b => parseSingleBlock(b)).filter(Boolean);
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
