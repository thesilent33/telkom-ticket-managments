/**
 * ui.js — Semua fungsi rendering & DOM manipulation
 */

import CONFIG from './config.js';
import { generateRekap } from './parser.js';
import { formatRedamanSummary } from './lensa.js';

// ─── SLA Timer helpers ────────────────────────────────────────────────────────

function getElapsedMs(ticket) {
  if (!ticket) return null;
  if (ticket.reported_at) {
    const t = new Date(ticket.reported_at).getTime();
    if (!isNaN(t)) return Date.now() - t;
  }
  // Fallback: ekstrak "XX.XX Jam" dari rest atau raw_input
  const sourceText = `${ticket.rest || ''} ${ticket.raw_input || ''}`;
  const m = sourceText.match(/(\d+(?:\.\d+)?)\s*Jam/i);
  if (m) {
    const hours = parseFloat(m[1]);
    const createdAtMs = ticket.created_at ? new Date(ticket.created_at).getTime() : Date.now();
    const timeSinceCreated = Date.now() - createdAtMs;
    return (hours * 3600000) + timeSinceCreated;
  }
  return null;
}

function formatDuration(ms) {
  if (ms === null || ms < 0) return null;
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}j ${m}m`;
  return `${m}m`;
}

function formatLastUpdated(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const now = Date.now();
  const diffMin = Math.floor((now - d.getTime()) / 60000);
  let rel = '';
  if (diffMin < 1) {
    rel = 'baru saja';
  } else if (diffMin < 60) {
    rel = `${diffMin}m lalu`;
  } else if (diffMin < 1440) {
    const h = Math.floor(diffMin / 60);
    const m = diffMin % 60;
    rel = `${h}j ${m}m lalu`;
  } else {
    const days = Math.floor(diffMin / 1440);
    rel = `${days}h lalu`;
  }
  const day = String(d.getDate()).padStart(2, '0');
  const mon = String(d.getMonth() + 1).padStart(2, '0');
  const hr  = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${day}/${mon} ${hr}:${min} (${rel})`;
}

/**
 * Returns: { label, className }
 * className: 'sla-green' | 'sla-yellow' | 'sla-red' | 'sla-overdue'
 */
function getSlaInfo(ticket) {
  const elapsedMs = getElapsedMs(ticket);
  if (elapsedMs === null) return null;

  const elapsedMin = elapsedMs / 60000;

  // Cek apakah sudah lewat SLA deadline
  if (ticket.sla_deadline) {
    const deadlineMs = new Date(ticket.sla_deadline).getTime() - Date.now();
    if (deadlineMs <= 0) {
      return { label: `Lewat SLA ${formatDuration(-deadlineMs)}`, className: 'sla-overdue' };
    }
  }

  const label = formatDuration(elapsedMs);
  let className = 'sla-green';
  if (elapsedMin >= CONFIG.SLA_YELLOW) className = 'sla-red';
  else if (elapsedMin >= CONFIG.SLA_GREEN) className = 'sla-yellow';

  return { label, className };
}

// ─── Teknisi storage helper ───────────────────────────────────────────────────

function getSavedTechnicians() {
  try {
    const list = JSON.parse(localStorage.getItem('saved_technicians') || '[]');
    if (Array.isArray(list) && list.length > 0) return list;
  } catch (e) {}
  return ['JONI SUBROTO'];
}

function saveTechnicianName(name) {
  if (!name || !name.trim()) return;
  const n = name.trim();
  const list = getSavedTechnicians();
  if (!list.includes(n)) {
    list.unshift(n);
    localStorage.setItem('saved_technicians', JSON.stringify(list.slice(0, 30)));
  }
}

// ─── Tier badge ───────────────────────────────────────────────────────────────

function renderTierBadge(tier) {
  const cfg = CONFIG.TIERS[tier] ?? CONFIG.TIERS.REGULER;
  return `<span class="tier-badge" style="background:${cfg.badge};color:#fff">${cfg.icon} ${cfg.label}</span>`;
}

// ─── Redaman display ──────────────────────────────────────────────────────────

function extractOntType(ticket) {
  if (ticket.onu_tipe) return ticket.onu_tipe;
  const raw = ticket.result_text || '';
  if (!raw) return '';
  const lines = raw.split('\n');
  const snLine = lines.find(l => l.includes('SN ONT') || l.includes('onu sn'));
  if (!snLine) return '';
  const idx = snLine.indexOf('(', snLine.indexOf('SN ONT') > -1 ? snLine.indexOf('SN ONT') : 0);
  const lastIdx = snLine.lastIndexOf(')');
  if (idx !== -1 && lastIdx > idx) {
    return snLine.substring(idx + 1, lastIdx).trim();
  }
  return '';
}

function getCompactRedamanStatus(ticket) {
  // 1. Ekstrak onu_rx numerik jika ada
  let rxVal = null;
  if (ticket.onu_rx !== null && ticket.onu_rx !== undefined && ticket.onu_rx !== '') {
    const parsed = parseFloat(String(ticket.onu_rx).replace(/[^\d.-]/g, ''));
    if (!isNaN(parsed)) rxVal = parsed;
  }
  if (rxVal === null && ticket.result_text) {
    const m = ticket.result_text.match(/onu(?:\s+rx)?(?:\s+power)?\s*[:=]?\s*([-\d.]+)/i);
    if (m) {
      const parsed = parseFloat(m[1]);
      if (!isNaN(parsed)) rxVal = parsed;
    }
  }

  // 2. Status string
  const onuStatus = (ticket.onu_status || '').toUpperCase();
  const rawText = `${ticket.raw_input || ''} ${ticket.rest || ''} ${ticket.gangguan || ''} ${ticket.result_text || ''}`.toUpperCase();

  // 3. Cek LOS / Offline / Putus terlebih dahulu
  if (
    onuStatus.includes('LOS') ||
    onuStatus.includes('OFFLINE') ||
    onuStatus.includes('DYING') ||
    /-\s*‼️/.test(rawText) ||
    /\bLOS\b/.test(rawText)
  ) {
    return {
      type: 'los',
      text: 'St: LOS ❌',
      badgeClass: 'status-los',
    };
  }

  // 4. Jika ada rxVal:
  // Unspec ketika redaman ONU di bawah -23.99 dBm (e.g. -24.00, -26.02)
  if (rxVal !== null) {
    if (rxVal < -23.99) {
      return {
        type: 'unspec',
        text: 'St: UNSPEC ⚠️',
        badgeClass: 'status-unspec',
      };
    } else {
      return {
        type: 'online',
        text: 'St: ONLINE ✅',
        badgeClass: 'status-online',
      };
    }
  }

  // 5. Cek apakah online berdasarkan onu_status atau teks
  if (onuStatus.includes('ONLINE') || /\bONLINE\b/.test(rawText)) {
    return {
      type: 'online',
      text: 'St: ONLINE ✅',
      badgeClass: 'status-online',
    };
  }

  // 6. Belum diukur
  if (!ticket.redaman_at && !ticket.onu_status && !ticket.onu_rx) {
    return {
      type: 'unmeasured',
      text: 'Belum Diukur ⏳',
      badgeClass: 'status-unmeasured',
    };
  }

  // Fallback
  return {
    type: 'unmeasured',
    text: `St: ${ticket.onu_status || 'Belum Diukur'}`,
    badgeClass: 'status-unmeasured',
  };
}

function renderRedaman(ticket) {
  const compactStatus = getCompactRedamanStatus(ticket);
  const summary = formatRedamanSummary(ticket);
  const tipeOnt = extractOntType(ticket);

  const snHtml = ticket.onu_sn
    ? `<div class="redaman-sn">🔌 SN: <code>${ticket.onu_sn}</code>${tipeOnt ? ` <span class="ont-tipe">(${tipeOnt})</span>` : ''}</div>`
    : '';

  // ACS Status & PCRF (Paket)
  const acsVal = ticket.acs_status ||
    ticket.result_text?.match(/Conn status \(ACS\):\s*([^\n<⚠️✅❌]+)/i)?.[1]?.trim() ||
    ticket.result_text?.match(/ACS:\s*([^\n<⚠️✅❌]+)/i)?.[1]?.trim();
  const acsEmoji = (acsVal ?? '').toLowerCase() === 'online' ? '✅' : '⚠️';

  const pcrfVal = ticket.pcrf ||
    ticket.result_text?.match(/PCRF \(Paket\):\s*([^\n<]+)/i)?.[1]?.trim() ||
    ticket.result_text?.match(/PCRF:\s*([^\n<]+)/i)?.[1]?.trim();

  let metaBadges = [];
  if (acsVal) metaBadges.push(`<span class="redaman-meta-badge">🌐 ACS: <b>${acsVal}</b> ${acsEmoji}</span>`);
  if (pcrfVal) metaBadges.push(`<span class="redaman-meta-badge">📦 Paket: <b>${pcrfVal}</b></span>`);
  const metaHtml = metaBadges.length > 0 ? `<div class="redaman-meta">${metaBadges.join(' ')}</div>` : '';

  // Last update time (Waktu Diukur) - ditaruh di compact row agar TIDAK dihide saat collapse
  const timeHtml = ticket.redaman_at
    ? `<span class="redaman-time" data-measured="${ticket.redaman_at}">🕐 Diukur: ${formatLastUpdated(ticket.redaman_at)}</span>`
    : '';

  const detailsHtml = (summary || snHtml || metaHtml)
    ? `
      <div class="redaman-details">
        ${summary ? `<div class="redaman-summary">${summary}</div>` : ''}
        ${snHtml}
        ${metaHtml}
      </div>`
    : `
      <div class="redaman-details">
        <span class="redaman-empty">📡 Belum ada rincian pengukuran</span>
      </div>`;

  return `
    <div class="redaman-compact-row">
      <div class="redaman-compact-left">
        <span class="redaman-compact-badge ${compactStatus.badgeClass}">${compactStatus.text}</span>
        ${timeHtml}
      </div>
      <button class="btn-card-expand" data-action="toggle-card-collapse" data-id="${ticket.id}" title="Buka / tutup rincian" aria-label="Toggle rincian kartu">▼</button>
    </div>
    ${detailsHtml}`;
}

// ─── Progress text ────────────────────────────────────────────────────────────

function renderProgress(ticket) {
  if (ticket.status === 'done') {
    let txt = '✅ <b>Selesai</b>';
    if (ticket.perbaikan) {
      txt += `: ${ticket.perbaikan}`;
      if (ticket.penyebab) txt += ` <span class="penyebab">(${ticket.penyebab})</span>`;
    }
    return txt;
  }
  if (ticket.status === 'kendala') {
    let txt = '⚠️ <b>Kendala</b>';
    if (ticket.kendala_text) txt += `: ${ticket.kendala_text}`;
    return txt;
  }
  return '<span class="progress-empty">⏳ Belum dikerjakan</span>';
}

// ─── Action buttons ───────────────────────────────────────────────────────────

function renderActions(ticket) {
  const id = ticket.id;
  const isDone    = ticket.status === 'done';
  const isKendala = ticket.status === 'kendala';

  const ukurLabel    = (ticket.onu_status || ticket.redaman_at) ? '📶 Ukur Ulang' : '📶 Ukur';
  const doneLabel    = isDone    ? '↩️ Unmark' : '✅ Selesai';
  const kendalaLabel = isKendala ? '↩️ Batal'  : '⚠️ Kendala';

  return `
    <div class="card-actions">
      <button class="btn-action btn-ukur"    data-action="ukur"    data-id="${id}" title="${ukurLabel}">${ukurLabel}</button>
      <button class="btn-action btn-done"    data-action="done"    data-id="${id}" title="${doneLabel}">${doneLabel}</button>
      <button class="btn-action btn-kendala" data-action="kendala" data-id="${id}" title="${kendalaLabel}">${kendalaLabel}</button>
      <button class="btn-action btn-rekap"   data-action="rekap"   data-id="${id}" title="Rekap Tiket">📋 Rekap</button>
    </div>`;
}

// ─── Full card render ─────────────────────────────────────────────────────────

function renderTicketCard(ticket, isCompact = true, isBatch = false, isSelected = false) {
  const tier    = ticket.tier ?? 'REGULER';
  const cfg     = CONFIG.TIERS[tier] ?? CONFIG.TIERS.REGULER;
  const sla     = getSlaInfo(ticket);
  const isDone  = ticket.status === 'done';
  const isKendala = ticket.status === 'kendala';

  const cardClasses = ['ticket-card'];
  if (isDone)      cardClasses.push('card-done');
  if (isKendala)   cardClasses.push('card-kendala');
  if (isCompact)   cardClasses.push('is-collapsed');
  if (isSelected)  cardClasses.push('is-batch-selected');

  const isPinned = ticket.is_pinned || ticket.sort_order === 1;
  if (isPinned) cardClasses.push('card-pinned');
  cardClasses.push(`tier-${tier.toLowerCase().replace(/_/g, '-')}`);

  const slaHtml = sla
    ? `<span class="sla-timer ${sla.className}" data-id="${ticket.id}" data-reported="${ticket.reported_at}" data-deadline="${ticket.sla_deadline ?? ''}">⏱️ ${sla.label}</span>`
    : '';

  const incStr   = ticket.inc  ? `<code class="inc-code">${ticket.inc}</code>`   : '—';
  const inetStr  = ticket.inet ? `<code class="inet-code">${ticket.inet}</code>` : '—';
  const odpStr   = ticket.odp  ? `<span class="odp-text">${ticket.odp}</span>`   : '';
  const restStr  = ticket.rest ? `<span class="rest-text"> · ${ticket.rest}</span>` : '';
  const teknisi  = ticket.teknisi || '—';

  const pinBtn   = `<button class="btn-card-pin ${isPinned ? 'active' : ''}" data-action="pin" data-id="${ticket.id}" title="${isPinned ? 'Lepas Pin' : 'Pin Tiket'}" aria-label="Pin tiket">📌</button>`;

  const rawGroups = ticket.groups;
  const groups = Array.isArray(rawGroups) ? rawGroups : (typeof rawGroups === 'string' && rawGroups ? rawGroups.split(',').map(s=>s.trim()).filter(Boolean) : []);
  const groupsHtml = groups.map(g => `<span class="group-tag-chip">📁 ${g}</span>`).join('');

  const batchCheckbox = `<input type="checkbox" class="card-batch-select" data-batch-id="${ticket.id}" ${isSelected ? 'checked' : ''} aria-label="Pilih tiket ${ticket.inc || ticket.id}">`;

  return `
<article class="${cardClasses.join(' ')}"
         data-id="${ticket.id}"
         style="border-left-color: ${cfg.color}; background: ${isDone ? '#f0fdf4' : isKendala ? '#fffbeb' : cfg.bg}">

  <div class="card-header">
    <div class="card-header-left">
      ${batchCheckbox}
      ${renderTierBadge(tier)}
      <span class="inc-wrapper">${incStr}</span>
    </div>
    <div class="card-header-right">
      ${slaHtml}
      ${pinBtn}
      <button class="btn-card-delete" data-action="delete" data-id="${ticket.id}" title="Hapus tiket" aria-label="Hapus tiket">✕</button>
    </div>
  </div>

  <div class="card-info">
    ${inetStr}${odpStr ? ` <span class="separator">·</span> ${odpStr}` : ''}${restStr}
  </div>

  <div class="card-redaman">
    ${renderRedaman(ticket)}
  </div>

  <div class="card-progress">
    📋 ${renderProgress(ticket)}
  </div>

  <div class="card-teknisi">
    <div>👤 <span class="teknisi-name">${teknisi}</span></div>
    <div class="card-groups">
      ${groupsHtml}
      <button class="btn-card-group-add" data-action="manage-groups" data-id="${ticket.id}" title="Kelola grup tiket">+ Grup</button>
    </div>
  </div>

  ${renderActions(ticket)}

</article>`;
}

// ─── Render all tickets with sorting ──────────────────────────────────────────

function renderAllTickets(tickets, filter = {}, options = {}) {
  const container = document.getElementById('tickets-container');
  if (!container) return;

  const isCompact = options.isCompact !== undefined ? options.isCompact : true;
  const isBatch = Boolean(options.isBatch);
  const selectedIds = options.selectedIds || new Set();
  const isCardCollapsedFn = options.isCardCollapsedFn || null;

  let list = [...tickets];

  // Filter status
  if (filter.status && filter.status !== 'all') {
    list = list.filter(t => t.status === filter.status);
  }
  // Filter tier
  if (filter.tier && filter.tier !== 'all') {
    list = list.filter(t => t.tier === filter.tier);
  }
  // Filter group
  if (filter.group && filter.group !== 'all') {
    list = list.filter(t => {
      const g = Array.isArray(t.groups) ? t.groups : (typeof t.groups === 'string' && t.groups ? t.groups.split(',').map(s=>s.trim()).filter(Boolean) : []);
      return g.includes(filter.group);
    });
  }

  // Filter search
  if (filter.search && filter.search.trim()) {
    const q = filter.search.trim().toLowerCase();
    list = list.filter(t => {
      const inc = (t.inc || '').toLowerCase();
      const inet = (t.inet || '').toLowerCase();
      const odp = (t.odp || '').toLowerCase();
      const teknisi = (t.teknisi || '').toLowerCase();
      const raw = (t.raw_input || '').toLowerCase();
      const res = (t.result_text || '').toLowerCase();
      const rest = (t.rest || '').toLowerCase();
      const perbaikan = (t.perbaikan || '').toLowerCase();
      const kendala = (t.kendala_text || '').toLowerCase();
      const tier = (t.tier || '').toLowerCase();
      const groups = Array.isArray(t.groups) ? t.groups.join(' ').toLowerCase() : (typeof t.groups === 'string' ? t.groups.toLowerCase() : '');
      return inc.includes(q) ||
             inet.includes(q) ||
             odp.includes(q) ||
             teknisi.includes(q) ||
             raw.includes(q) ||
             res.includes(q) ||
             rest.includes(q) ||
             perbaikan.includes(q) ||
             kendala.includes(q) ||
             tier.includes(q) ||
             groups.includes(q);
    });
  }

  // Sort logic
  const sortMode = filter.sort || 'ttr_desc';
  list.sort((a, b) => {
    // 0. Tiket yang di-pin SELALU berada di paling atas
    const pinA = a.is_pinned || a.sort_order === 1 ? 1 : 0;
    const pinB = b.is_pinned || b.sort_order === 1 ? 1 : 0;
    if (pinA !== pinB) return pinB - pinA;

    if (sortMode === 'ttr_desc') {
      // TTR terlama = jam berjalan paling banyak di paling atas
      const msA = getElapsedMs(a) ?? -1;
      const msB = getElapsedMs(b) ?? -1;
      return msB - msA;
    } else if (sortMode === 'ttr_asc') {
      // TTR terbaru = jam berjalan paling sedikit di paling atas
      const msA = getElapsedMs(a) ?? 9999999999;
      const msB = getElapsedMs(b) ?? 9999999999;
      return msA - msB;
    } else if (sortMode === 'tier_desc' || sortMode === 'tier') {
      // Tier tertinggi: DIAMOND, PLATINUM, GOLD, INDIBIZ, REGULER
      const tierRank = { HVC_DIAMOND: 1, HVC_PLATINUM: 2, HVC_GOLD: 3, INDIBIZ: 4, REGULER: 5 };
      const rA = tierRank[a.tier] || 99;
      const rB = tierRank[b.tier] || 99;
      if (rA !== rB) return rA - rB;
      const msA = getElapsedMs(a) ?? -1;
      const msB = getElapsedMs(b) ?? -1;
      return msB - msA;
    } else if (sortMode === 'tier_asc') {
      // Tier terendah: REGULER, INDIBIZ, GOLD, PLATINUM, DIAMOND
      const tierRankAsc = { REGULER: 1, INDIBIZ: 2, HVC_GOLD: 3, HVC_PLATINUM: 4, HVC_DIAMOND: 5 };
      const rA = tierRankAsc[a.tier] || 99;
      const rB = tierRankAsc[b.tier] || 99;
      if (rA !== rB) return rA - rB;
      const msA = getElapsedMs(a) ?? -1;
      const msB = getElapsedMs(b) ?? -1;
      return msB - msA;
    } else if (sortMode === 'created_desc') {
      const tA = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tB = b.created_at ? new Date(b.created_at).getTime() : 0;
      return tB - tA;
    }
    return 0;
  });

  if (list.length === 0) {
    const isSearching = Boolean(filter.search && filter.search.trim());
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">${isSearching ? '🔍' : '📭'}</div>
        <p>${isSearching ? `Tidak ada tiket yang cocok dengan "<b>${filter.search}</b>"` : `Belum ada tiket${filter.status && filter.status !== 'all' ? ` dengan status <b>${filter.status}</b>` : ''}`}</p>
        <p class="empty-sub">${isSearching ? 'Coba kata kunci pencarian yang lain' : 'Tap tombol <b>+ Tambah</b> untuk menambahkan tiket baru'}</p>
      </div>`;
    return;
  }

  container.innerHTML = list.map(ticket => {
    const isSelected = selectedIds.has(ticket.id);
    const cardCollapsed = isCardCollapsedFn ? isCardCollapsedFn(ticket.id) : isCompact;
    return renderTicketCard(ticket, cardCollapsed, isBatch, isSelected);
  }).join('');
}

// ─── In-place card update ─────────────────────────────────────────────────────

function updateCardInPlace(ticket, isCompact = undefined, isBatch = undefined, isSelected = undefined) {
  const el = document.querySelector(`[data-id="${ticket.id}"]`);
  if (!el) return;
  const currentlyCollapsed = el.classList.contains('is-collapsed');
  const currentlySelected = el.classList.contains('is-batch-selected');
  const currentlyBatchMode = document.body.classList.contains('batch-mode-active');
  el.outerHTML = renderTicketCard(
    ticket,
    isCompact !== undefined ? isCompact : currentlyCollapsed,
    isBatch !== undefined ? isBatch : currentlyBatchMode,
    isSelected !== undefined ? isSelected : currentlySelected
  );
}

function removeCard(id) {
  const el = document.querySelector(`[data-id="${id}"]`);
  if (el) {
    el.classList.add('card-removing');
    setTimeout(() => el.remove(), 300);
  }
}

function insertCard(ticket) {
  const container = document.getElementById('tickets-container');
  if (!container) return;
  const empty = container.querySelector('.empty-state');
  if (empty) container.innerHTML = '';

  const temp = document.createElement('div');
  temp.innerHTML = renderTicketCard(ticket);
  const card = temp.firstElementChild;
  card.classList.add('card-new');
  container.prepend(card);
  setTimeout(() => card.classList.remove('card-new'), 500);
}

// ─── Ukur button loading state ────────────────────────────────────────────────

function setUkurLoading(id, loading) {
  const btn = document.querySelector(`[data-action="ukur"][data-id="${id}"]`);
  if (!btn) return;
  if (loading) {
    btn.disabled = true;
    btn.textContent = '⏳ Mengukur...';
    btn.classList.add('loading');
  } else {
    btn.disabled = false;
    btn.classList.remove('loading');
  }
}

// ─── Toast notification ───────────────────────────────────────────────────────

function showToast(msg, type = 'info') {
  const existing = document.getElementById('toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'toast';
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  document.body.appendChild(toast);

  setTimeout(() => toast.classList.add('toast-visible'), 10);
  setTimeout(() => {
    toast.classList.remove('toast-visible');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ─── Modal system ─────────────────────────────────────────────────────────────

function showModal(html, { onConfirm, confirmLabel = 'OK', cancelLabel = 'Batal', dangerous = false } = {}) {
  const overlay = document.getElementById('modal-overlay');
  const box     = document.getElementById('modal-box');
  const body    = document.getElementById('modal-body');
  const btnOk   = document.getElementById('modal-confirm');
  const btnX    = document.getElementById('modal-cancel');

  body.innerHTML = html;
  btnOk.textContent = confirmLabel;
  btnOk.className   = `btn-modal-confirm${dangerous ? ' btn-danger' : ''}`;

  if (!cancelLabel) {
    btnX.style.display = 'none';
  } else {
    btnX.style.display = 'block';
    btnX.textContent  = cancelLabel;
  }

  overlay.classList.add('modal-open');

  const close = () => overlay.classList.remove('modal-open');

  // Clone nodes to remove old listeners
  const newOk = btnOk.cloneNode(true);
  btnOk.parentNode.replaceChild(newOk, btnOk);
  const newX = btnX.cloneNode(true);
  btnX.parentNode.replaceChild(newX, btnX);

  document.getElementById('modal-confirm').addEventListener('click', () => {
    close();
    if (onConfirm) onConfirm();
  });
  document.getElementById('modal-cancel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); }, { once: true });
}

function showInputModal(html, { confirmLabel = 'Simpan', cancelLabel = 'Batal', getValues, dangerous = false, onMount } = {}) {
  return new Promise((resolve) => {
    showModal(html, {
      confirmLabel,
      cancelLabel,
      dangerous,
      onConfirm: () => {
        const vals = getValues ? getValues() : null;
        resolve(vals);
      },
    });
    if (typeof onMount === 'function') {
      try { onMount(); } catch (err) { console.error(err); }
    }
    // Resolve null on cancel/close
    document.getElementById('modal-cancel').addEventListener('click', () => resolve(null), { once: true });
    document.getElementById('modal-overlay').addEventListener('click', (e) => {
      if (e.target === document.getElementById('modal-overlay')) resolve(null);
    }, { once: true });
  });
}

// ─── Modal: Add Ticket ────────────────────────────────────────────────────────

function modalAddTicket(allGroups = [], defaultGroup = 'all') {
  const groupItemsHtml = allGroups.length === 0
    ? `<div id="modal-add-group-empty" style="color: #94a3b8; font-size: 0.82rem; padding: 6px 0; text-align: center;">Belum ada grup. Ketik nama grup baru di bawah jika ingin mengelompokkan tiket ini.</div>`
    : allGroups.map(g => {
        const isChecked = (defaultGroup && defaultGroup !== 'all' && g === defaultGroup);
        return `
          <label class="group-select-item ${isChecked ? 'checked' : ''}" data-group-name="${g}">
            <span>📁 <b>${g}</b></span>
            <input type="checkbox" name="add-ticket-group-check" value="${g}" ${isChecked ? 'checked' : ''}>
          </label>
        `;
      }).join('');

  return `
    <h3 class="modal-title">➕ Tambah Tiket</h3>
    <div class="modal-section">
      <label class="modal-label">Paste teks tiket (WO / format singkat)</label>
      <textarea id="input-paste" class="modal-textarea" rows="6"
        placeholder="📢 NEW WO&#10;HVC_GOLD&#10;...&#10;atau: INC53364888 | 172418214868 | HVC_GOLD | ODP-UBN-FDP/79"></textarea>
    </div>
    <div id="parse-preview" class="parse-preview" style="display:none">
      <div class="preview-title">✨ Hasil parse:</div>
      <div class="preview-grid" id="preview-fields"></div>
    </div>
    <p class="modal-hint" style="margin-bottom: 12px;">💡 Anda juga bisa paste beberapa tiket sekaligus (satu per baris)</p>

    <div class="modal-section" style="border-top: 1px solid #f1f5f9; padding-top: 12px;">
      <label class="modal-label" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
        <span>📁 Masukkan ke Grup / Folder <span class="optional">(opsional)</span></span>
      </label>
      <div style="font-size: 0.8rem; color: #64748b; margin-bottom: 8px;">Pilih satu atau lebih grup untuk tiket baru:</div>
      <div class="group-select-list" id="modal-add-group-list" style="max-height: 130px; margin: 4px 0 8px;">
        ${groupItemsHtml}
      </div>
      <div class="group-create-row" style="margin-top: 6px;">
        <input type="text" id="input-modal-add-group" placeholder="+ Buat grup baru..." maxlength="30">
        <button type="button" id="btn-modal-add-group">Tambah</button>
      </div>
    </div>`;
}

// ─── Modal: Done ──────────────────────────────────────────────────────────────

function modalDone(ticket) {
  const label = ticket.inc || `tiket #`;
  const savedTechs = getSavedTechnicians();
  return `
    <h3 class="modal-title">✅ Tandai Selesai</h3>
    <p class="modal-subtitle">Tiket: <code>${label}</code></p>
    <div class="modal-section">
      <label class="modal-label">Perbaikan <span class="required">*</span></label>
      <input id="input-perbaikan" class="modal-input" type="text"
        placeholder="cth: Ganti ONT" value="${ticket.perbaikan ?? ''}">
    </div>
    <div class="modal-section">
      <label class="modal-label">Penyebab <span class="optional">(opsional)</span></label>
      <input id="input-penyebab" class="modal-input" type="text"
        placeholder="cth: ONT mati total" value="${ticket.penyebab ?? ''}">
    </div>
    <div class="modal-section">
      <label class="modal-label">Teknisi (Pilih atau Ketik Baru)</label>
      <input id="input-teknisi-done" class="modal-input" type="text"
        list="teknisi-list-done"
        placeholder="Pilih atau ketik nama teknisi"
        value="${ticket.teknisi ?? ''}">
      <datalist id="teknisi-list-done">
        ${savedTechs.map(t => `<option value="${t}">`).join('')}
      </datalist>
    </div>`;
}

// ─── Modal: Kendala ───────────────────────────────────────────────────────────

function modalKendala(ticket) {
  const label = ticket.inc || `tiket`;
  const savedTechs = getSavedTechnicians();
  return `
    <h3 class="modal-title">⚠️ Tandai Kendala</h3>
    <p class="modal-subtitle">Tiket: <code>${label}</code></p>
    <div class="modal-section">
      <label class="modal-label">Deskripsi Kendala <span class="required">*</span></label>
      <input id="input-kendala" class="modal-input" type="text"
        placeholder="cth: Akses rumah terkunci, pelanggan tidak bisa dihubungi"
        value="${ticket.kendala_text ?? ''}">
    </div>
    <div class="modal-section">
      <label class="modal-label">Teknisi (Pilih atau Ketik Baru)</label>
      <input id="input-teknisi-kendala" class="modal-input" type="text"
        list="teknisi-list-kendala"
        placeholder="Pilih atau ketik nama teknisi"
        value="${ticket.teknisi ?? ''}">
      <datalist id="teknisi-list-kendala">
        ${savedTechs.map(t => `<option value="${t}">`).join('')}
      </datalist>
    </div>`;
}

// ─── Modal: Rekap ─────────────────────────────────────────────────────────────

function modalRekap(ticket) {
  const rekap = generateRekap(ticket);
  return `
    <h3 class="modal-title">📋 Rekap Tiket</h3>
    <p class="modal-subtitle">${ticket.inc || '—'} <span class="text-xs text-slate-400">(Bisa diedit langsung sebelum disalin)</span></p>
    <div class="rekap-box">
      <textarea id="rekap-text" class="rekap-textarea" rows="11" spellcheck="false">${rekap}</textarea>
    </div>
    <button class="btn-copy" onclick="navigator.clipboard.writeText(document.getElementById('rekap-text').value).then(() => { this.textContent='✅ Berhasil Disalin!'; setTimeout(()=>this.textContent='📋 Salin Semua', 2000); }).catch(() => this.textContent='❌ Gagal')">
      📋 Salin Semua
    </button>`;
}

// ─── Update SLA timers (dipanggil setiap menit) ───────────────────────────────

function updateAllTimers(allTickets = []) {
  // Update TTR SLA timer badge
  document.querySelectorAll('.sla-timer').forEach(el => {
    const id = el.dataset.id;
    const ticket = allTickets.find(t => t.id === id);
    if (!ticket) return;

    const sla = getSlaInfo(ticket);
    if (!sla) return;

    el.textContent = `⏱️ ${sla.label}`;
    el.className   = `sla-timer ${sla.className}`;
  });

  // Update live relative time for redaman measurement ("baru saja", "1m lalu", dst.)
  document.querySelectorAll('.redaman-time[data-measured]').forEach(el => {
    const measuredAt = el.dataset.measured;
    if (!measuredAt) return;
    el.textContent = `🕐 Diukur: ${formatLastUpdated(measuredAt)}`;
  });
}

// ─── Update filter stats ──────────────────────────────────────────────────────

function updateStats(tickets) {
  // Status counts
  const counts = { all: tickets.length, open: 0, done: 0, kendala: 0 };
  tickets.forEach(t => { if (counts[t.status] !== undefined) counts[t.status]++; });

  ['all', 'open', 'done', 'kendala'].forEach(k => {
    const el = document.getElementById(`count-${k}`);
    if (el) el.textContent = counts[k];
  });

  // Tier counts
  const tierCounts = {
    all: tickets.length,
    diamond: 0,
    platinum: 0,
    gold: 0,
    indibiz: 0,
    reguler: 0
  };
  tickets.forEach(t => {
    const tr = (t.tier || 'REGULER').toUpperCase();
    if (tr.includes('DIAMOND')) tierCounts.diamond++;
    else if (tr.includes('PLATINUM')) tierCounts.platinum++;
    else if (tr.includes('GOLD')) tierCounts.gold++;
    else if (tr.includes('INDIBIZ')) tierCounts.indibiz++;
    else tierCounts.reguler++;
  });

  ['all', 'diamond', 'platinum', 'gold', 'indibiz', 'reguler'].forEach(k => {
    const el = document.getElementById(`count-tier-${k}`);
    if (el) el.textContent = tierCounts[k];
  });

  // Optical condition counts
  const optCounts = {
    all: tickets.length,
    los: 0,
    unspec: 0,
    spec: 0,
    unmeasured: 0
  };
  tickets.forEach(t => {
    const st = getCompactRedamanStatus(t);
    if (st.type === 'los') optCounts.los++;
    else if (st.type === 'unspec') optCounts.unspec++;
    else if (st.type === 'online') optCounts.spec++;
    else optCounts.unmeasured++;
  });

  ['all', 'los', 'unspec', 'spec', 'unmeasured'].forEach(k => {
    const el = document.getElementById(`count-opt-${k}`);
    if (el) el.textContent = optCounts[k];
  });
}

// ─── Group Tabs Rendering ─────────────────────────────────────────────────────

function renderGroupTabs(allGroups = [], activeGroup = 'all', tickets = []) {
  const container = document.getElementById('custom-group-tabs');
  const countAllEl = document.getElementById('count-group-all');
  if (countAllEl) countAllEl.textContent = tickets.length;

  const allTab = document.querySelector('.btn-group-tab[data-group="all"]');
  if (allTab) allTab.classList.toggle('active', activeGroup === 'all');

  if (!container) return;

  container.innerHTML = allGroups.map(grp => {
    const isAct = grp === activeGroup;
    const count = tickets.filter(t => {
      const g = Array.isArray(t.groups) ? t.groups : (typeof t.groups === 'string' && t.groups ? t.groups.split(',').map(s=>s.trim()).filter(Boolean) : []);
      return g.includes(grp);
    }).length;

    return `
      <button class="btn-group-tab ${isAct ? 'active' : ''}" data-group="${grp}">
        <span>📁</span> ${grp} <span class="group-count">${count}</span>
        <span class="btn-delete-group" data-action="delete-group" data-group="${grp}" title="Hapus grup ${grp}">×</span>
      </button>
    `;
  }).join('');
}

// ─── Modal: Manage Groups per Ticket ──────────────────────────────────────────

function modalManageGroups(ticket, allGroups = []) {
  const rawGroups = ticket.groups;
  const currentGroups = Array.isArray(rawGroups) ? rawGroups : (typeof rawGroups === 'string' && rawGroups ? rawGroups.split(',').map(s=>s.trim()).filter(Boolean) : []);

  const itemsHtml = allGroups.length === 0
    ? `<div style="color:#94a3b8; font-size:0.85rem; padding:10px; text-align:center;">Belum ada grup yang dibuat. Ketik nama grup baru di bawah.</div>`
    : allGroups.map(g => {
        const isChecked = currentGroups.includes(g);
        return `
          <label class="group-select-item ${isChecked ? 'checked' : ''}" data-group-name="${g}">
            <span>📁 <b>${g}</b></span>
            <input type="checkbox" name="ticket-group-check" value="${g}" ${isChecked ? 'checked' : ''}>
          </label>
        `;
      }).join('');

  return `
    <h3 class="modal-title">📁 Kelola Grup Tiket</h3>
    <p class="modal-subtitle">Tiket: <code>${ticket.inc || ticket.inet || '—'}</code></p>
    <div style="font-size:0.82rem; color:#64748b; margin-bottom:8px;">Pilih grup untuk tiket ini (bisa lebih dari satu):</div>
    <div class="group-select-list" id="group-select-list">
      ${itemsHtml}
    </div>
    <div class="group-create-row">
      <input type="text" id="input-new-group-name" placeholder="+ Tambah grup baru..." maxlength="30">
      <button type="button" id="btn-quick-create-group">Tambah</button>
    </div>
  `;
}

export {
  renderAllTickets,
  renderTicketCard,
  updateCardInPlace,
  removeCard,
  insertCard,
  setUkurLoading,
  showToast,
  showModal,
  showInputModal,
  modalAddTicket,
  modalDone,
  modalKendala,
  modalRekap,
  modalManageGroups,
  renderGroupTabs,
  updateAllTimers,
  updateStats,
  getSlaInfo,
  getCompactRedamanStatus,
  getSavedTechnicians,
  saveTechnicianName,
};
