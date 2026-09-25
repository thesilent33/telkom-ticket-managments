/**
 * ui.js — Semua fungsi rendering & DOM manipulation
 */

import CONFIG from './config.js';
import { generateRekap } from './parser.js';
import { formatRedamanSummary } from './lensa.js';

// ─── SLA Timer helpers ────────────────────────────────────────────────────────

function getElapsedMs(reportedAt) {
  if (!reportedAt) return null;
  return Date.now() - new Date(reportedAt).getTime();
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
  if (diffMin < 1) rel = 'baru saja';
  else if (diffMin < 60) rel = `${diffMin}m lalu`;
  else {
    const h = Math.floor(diffMin / 60);
    const m = diffMin % 60;
    rel = `${h}j ${m}m lalu`;
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
  if (!ticket.reported_at) return null;

  const elapsedMs = getElapsedMs(ticket.reported_at);
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

function renderRedaman(ticket) {
  const summary = formatRedamanSummary(ticket);
  if (!summary && !ticket.redaman_at) {
    return `<span class="redaman-empty">📡 Belum diukur</span>`;
  }

  // Tipe ONT jika ada di result_text atau onu_tipe
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

  // Last update time
  const timeHtml = ticket.redaman_at
    ? `<div class="redaman-time">🕐 Diukur: ${formatLastUpdated(ticket.redaman_at)}</div>`
    : '';

  return `
    ${summary ? `<div class="redaman-summary">${summary}</div>` : ''}
    ${snHtml}
    ${metaHtml}
    ${timeHtml}`;
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

function renderTicketCard(ticket) {
  const tier    = ticket.tier ?? 'REGULER';
  const cfg     = CONFIG.TIERS[tier] ?? CONFIG.TIERS.REGULER;
  const sla     = getSlaInfo(ticket);
  const isDone  = ticket.status === 'done';
  const isKendala = ticket.status === 'kendala';

  let cardClass = 'ticket-card';
  if (isDone)    cardClass += ' card-done';
  if (isKendala) cardClass += ' card-kendala';

  const slaHtml = sla
    ? `<span class="sla-timer ${sla.className}" data-id="${ticket.id}" data-reported="${ticket.reported_at}" data-deadline="${ticket.sla_deadline ?? ''}">⏱️ ${sla.label}</span>`
    : '';

  const incStr   = ticket.inc  ? `<code class="inc-code">${ticket.inc}</code>`   : '—';
  const inetStr  = ticket.inet ? `<code class="inet-code">${ticket.inet}</code>` : '—';
  const odpStr   = ticket.odp  ? `<span class="odp-text">${ticket.odp}</span>`   : '';
  const restStr  = ticket.rest ? `<span class="rest-text"> · ${ticket.rest}</span>` : '';
  const teknisi  = ticket.teknisi || '—';

  return `
<article class="ticket-card ${cardClass} tier-${tier.toLowerCase().replace(/_/g,'-')}"
         data-id="${ticket.id}"
         style="border-left-color: ${cfg.color}; background: ${isDone ? '#f0fdf4' : isKendala ? '#fffbeb' : cfg.bg}">

  <div class="card-header">
    <div class="card-header-left">
      ${renderTierBadge(tier)}
      <span class="inc-wrapper">${incStr}</span>
    </div>
    <div class="card-header-right">
      ${slaHtml}
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
    👤 <span class="teknisi-name">${teknisi}</span>
  </div>

  ${renderActions(ticket)}

</article>`;
}

// ─── Render all tickets with sorting ──────────────────────────────────────────

function renderAllTickets(tickets, filter = {}) {
  const container = document.getElementById('tickets-container');
  if (!container) return;

  let list = [...tickets];

  // Filter status
  if (filter.status && filter.status !== 'all') {
    list = list.filter(t => t.status === filter.status);
  }
  // Filter tier
  if (filter.tier && filter.tier !== 'all') {
    list = list.filter(t => t.tier === filter.tier);
  }

  // Sort logic
  const sortMode = filter.sort || 'ttr_desc';
  list.sort((a, b) => {
    if (sortMode === 'ttr_desc') {
      // TTR terlama = reported_at paling lampau duluan (paling mendekati / lewat SLA)
      const tA = a.reported_at ? new Date(a.reported_at).getTime() : (a.created_at ? new Date(a.created_at).getTime() : 0);
      const tB = b.reported_at ? new Date(b.reported_at).getTime() : (b.created_at ? new Date(b.created_at).getTime() : 0);
      return tA - tB;
    } else if (sortMode === 'ttr_asc') {
      // TTR terbaru = reported_at paling baru duluan
      const tA = a.reported_at ? new Date(a.reported_at).getTime() : (a.created_at ? new Date(a.created_at).getTime() : 0);
      const tB = b.reported_at ? new Date(b.reported_at).getTime() : (b.created_at ? new Date(b.created_at).getTime() : 0);
      return tB - tA;
    } else if (sortMode === 'tier') {
      const tierRank = { HVC_DIAMOND: 1, HVC_PLATINUM: 2, HVC_GOLD: 3, INDIBIZ: 4, REGULER: 5 };
      const rA = tierRank[a.tier] || 99;
      const rB = tierRank[b.tier] || 99;
      return rA - rB;
    } else if (sortMode === 'created_desc') {
      const tA = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tB = b.created_at ? new Date(b.created_at).getTime() : 0;
      return tB - tA;
    }
    return 0;
  });

  if (list.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📭</div>
        <p>Belum ada tiket${filter.status && filter.status !== 'all' ? ` dengan status <b>${filter.status}</b>` : ''}</p>
        <p class="empty-sub">Tap tombol <b>+ Tambah</b> untuk menambahkan tiket baru</p>
      </div>`;
    return;
  }

  container.innerHTML = list.map(renderTicketCard).join('');
}

// ─── In-place card update ─────────────────────────────────────────────────────

function updateCardInPlace(ticket) {
  const el = document.querySelector(`[data-id="${ticket.id}"]`);
  if (!el) return;
  el.outerHTML = renderTicketCard(ticket);
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

function showInputModal(html, { confirmLabel = 'Simpan', cancelLabel = 'Batal', getValues, dangerous = false } = {}) {
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
    // Resolve null on cancel/close
    document.getElementById('modal-cancel').addEventListener('click', () => resolve(null), { once: true });
    document.getElementById('modal-overlay').addEventListener('click', (e) => {
      if (e.target === document.getElementById('modal-overlay')) resolve(null);
    }, { once: true });
  });
}

// ─── Modal: Add Ticket ────────────────────────────────────────────────────────

function modalAddTicket() {
  return `
    <h3 class="modal-title">➕ Tambah Tiket</h3>
    <div class="modal-section">
      <label class="modal-label">Paste teks tiket (WO / format singkat)</label>
      <textarea id="input-paste" class="modal-textarea" rows="7"
        placeholder="📢 NEW WO&#10;HVC_GOLD&#10;...&#10;atau: INC53364888 | 172418214868 | HVC_GOLD | ODP-UBN-FDP/79"></textarea>
    </div>
    <div id="parse-preview" class="parse-preview" style="display:none">
      <div class="preview-title">✨ Hasil parse:</div>
      <div class="preview-grid" id="preview-fields"></div>
    </div>
    <p class="modal-hint">💡 Anda juga bisa paste beberapa tiket sekaligus (satu per baris)</p>`;
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

function updateAllTimers() {
  document.querySelectorAll('.sla-timer').forEach(el => {
    const reported  = el.dataset.reported;
    const deadline  = el.dataset.deadline || null;
    if (!reported) return;

    const ticket = { reported_at: reported, sla_deadline: deadline };
    const sla    = getSlaInfo(ticket);
    if (!sla) return;

    el.textContent = `⏱️ ${sla.label}`;
    el.className   = `sla-timer ${sla.className}`;
  });
}

// ─── Update filter stats ──────────────────────────────────────────────────────

function updateStats(tickets) {
  const counts = { all: tickets.length, open: 0, done: 0, kendala: 0 };
  tickets.forEach(t => { if (counts[t.status] !== undefined) counts[t.status]++; });

  ['all', 'open', 'done', 'kendala'].forEach(k => {
    const el = document.getElementById(`count-${k}`);
    if (el) el.textContent = counts[k];
  });
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
  updateAllTimers,
  updateStats,
  getSlaInfo,
  getSavedTechnicians,
  saveTechnicianName,
};
