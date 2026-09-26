/**
 * app.js — Main controller: init, event handling, realtime, ukur semua
 */

import { parseTickets } from './parser.js';
import { fetchTickets, addTickets, updateTicket, deleteTicket, subscribeToTickets } from './supabase-client.js';
import { ukurRedaman } from './lensa.js';
import {
  renderAllTickets, updateCardInPlace, removeCard, insertCard,
  setUkurLoading, showToast, showModal, showInputModal,
  modalAddTicket, modalDone, modalKendala, modalRekap,
  updateAllTimers, updateStats, saveTechnicianName,
} from './ui.js';

// ─── State ────────────────────────────────────────────────────────────────────
let tickets           = [];   // array of ticket objects (local cache)
let activeFilter      = { status: 'all', tier: 'all', sort: 'ttr_desc' };
let isMeasuringAll    = false;
let abortMeasuringAll = false;

// ─── Helper: Get tickets matching active filter ──────────────────────────────
function getFilteredTickets() {
  let list = [...tickets];
  if (activeFilter.status && activeFilter.status !== 'all') {
    list = list.filter(t => t.status === activeFilter.status);
  }
  if (activeFilter.tier && activeFilter.tier !== 'all') {
    list = list.filter(t => t.tier === activeFilter.tier);
  }
  return list;
}

// ─── Update count on "Ukur Semua" button ──────────────────────────────────────
function updateUkurAllButton() {
  const btn = document.getElementById('btn-ukur-all');
  const countEl = document.getElementById('ukur-all-count');
  if (!btn || !countEl) return;

  const targets = getFilteredTickets().filter(t => t.inet);
  countEl.textContent = targets.length;
  if (!isMeasuringAll) {
    btn.disabled = targets.length === 0;
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  showLoading(true);
  try {
    tickets = await fetchTickets();
    renderAllTickets(tickets, activeFilter);
    updateStats(tickets);
    updateUkurAllButton();
  } catch (e) {
    showToast('❌ Gagal memuat tiket dari Supabase. Cek config.js!', 'error');
    console.error(e);
  } finally {
    showLoading(false);
  }

  // Realtime subscription
  subscribeToTickets(handleRealtimeChange);

  // Timer: update SLA & waktu ukur setiap 15 detik
  setInterval(() => updateAllTimers(tickets), 15000);

  // Event delegation
  document.addEventListener('click', handleClick);
  document.addEventListener('input', handleInput);

  // Filter buttons (Status)
  document.querySelectorAll('[data-filter-status]').forEach(btn => {
    btn.addEventListener('click', () => {
      activeFilter.status = btn.dataset.filterStatus;
      document.querySelectorAll('[data-filter-status]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderAllTickets(tickets, activeFilter);
      updateUkurAllButton();
    });
  });

  // Filter buttons (Tier)
  document.querySelectorAll('[data-filter-tier]').forEach(btn => {
    btn.addEventListener('click', () => {
      activeFilter.tier = btn.dataset.filterTier;
      document.querySelectorAll('[data-filter-tier]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderAllTickets(tickets, activeFilter);
      updateUkurAllButton();
    });
  });

  // Sort dropdown
  const sortSelect = document.getElementById('select-sort');
  if (sortSelect) {
    sortSelect.value = activeFilter.sort;
    sortSelect.addEventListener('change', (e) => {
      activeFilter.sort = e.target.value;
      renderAllTickets(tickets, activeFilter);
    });
  }

  // Tombol Ukur Semua
  const btnUkurAll = document.getElementById('btn-ukur-all');
  if (btnUkurAll) {
    btnUkurAll.addEventListener('click', handleUkurSemua);
  }
}

// ─── Loading indicator ────────────────────────────────────────────────────────
function showLoading(on) {
  const el = document.getElementById('loading-bar');
  if (el) el.style.display = on ? 'block' : 'none';
}

// ─── Realtime handler ─────────────────────────────────────────────────────────
function handleRealtimeChange({ eventType, old: oldRow, new: newRow }) {
  if (eventType === 'INSERT') {
    if (!tickets.find(t => t.id === newRow.id)) {
      tickets.push(newRow);
      renderAllTickets(tickets, activeFilter);
      updateStats(tickets);
      updateUkurAllButton();
    }
  } else if (eventType === 'UPDATE') {
    const idx = tickets.findIndex(t => t.id === newRow.id);
    if (idx !== -1) {
      tickets[idx] = newRow;
    } else {
      tickets.push(newRow);
    }
    updateCardInPlace(newRow);
    updateStats(tickets);
    updateUkurAllButton();
  } else if (eventType === 'DELETE') {
    tickets = tickets.filter(t => t.id !== oldRow.id);
    removeCard(oldRow.id);
    updateStats(tickets);
    updateUkurAllButton();
  }
}

// ─── Event delegation ─────────────────────────────────────────────────────────
async function handleClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;

  const action = btn.dataset.action;
  const id     = btn.dataset.id;
  const ticket = tickets.find(t => t.id === id);

  switch (action) {
    case 'ukur':    return handleUkur(ticket);
    case 'done':    return handleDone(ticket);
    case 'kendala': return handleKendala(ticket);
    case 'rekap':   return handleRekap(ticket);
    case 'delete':  return handleDelete(ticket);
    case 'add':     return handleAddTicket();
  }
}

function handleInput(e) {
  // Live parse preview di modal tambah tiket
  if (e.target.id === 'input-paste') {
    updateParsePreview(e.target.value);
  }
}

// ─── Action: Tambah Tiket ─────────────────────────────────────────────────────
async function handleAddTicket() {
  const result = await showInputModal(modalAddTicket(), {
    confirmLabel: '✅ Tambah Tiket',
    getValues: () => {
      const raw = document.getElementById('input-paste')?.value ?? '';
      return { raw };
    },
  });

  if (!result) return;

  const parsed = parseTickets(result.raw);
  if (!parsed.length) {
    showToast('❌ Format tidak dikenali. Coba paste ulang teks WO atau format singkat.', 'error');
    return;
  }

  try {
    const inserted = await addTickets(parsed);
    if (inserted) {
      inserted.forEach(t => {
        if (!tickets.find(x => x.id === t.id)) {
          tickets.push(t);
        }
      });
      renderAllTickets(tickets, activeFilter);
      updateStats(tickets);
      updateUkurAllButton();
    }
    showToast(`✅ ${parsed.length} tiket berhasil ditambahkan!`, 'success');
  } catch (err) {
    console.error(err);
    showToast('❌ Gagal menyimpan tiket. Cek koneksi & konfigurasi Supabase.', 'error');
  }
}

// ─── Live parse preview ───────────────────────────────────────────────────────
function updateParsePreview(text) {
  const preview = document.getElementById('parse-preview');
  const fields  = document.getElementById('preview-fields');
  if (!preview || !fields) return;

  const parsed = parseTickets(text);
  if (!parsed.length) {
    preview.style.display = 'none';
    return;
  }

  preview.style.display = 'block';
  fields.innerHTML = parsed.map((t, i) => `
    <div class="preview-ticket">
      ${parsed.length > 1 ? `<div class="preview-num">Tiket ${i+1}</div>` : ''}
      <div class="preview-row"><span>INC</span><code>${t.inc || '—'}</code></div>
      <div class="preview-row"><span>iNetID</span><code>${t.inet || '—'}</code></div>
      <div class="preview-row"><span>ODP</span><span>${t.odp || '—'}</span></div>
      <div class="preview-row"><span>Tier</span><span>${t.tier}</span></div>
      ${t.reported_at ? `<div class="preview-row"><span>Reported</span><span>${new Date(t.reported_at).toLocaleString('id-ID')}</span></div>` : ''}
      ${t.sla_deadline ? `<div class="preview-row"><span>SLA</span><span>${new Date(t.sla_deadline).toLocaleString('id-ID')}</span></div>` : ''}
    </div>`).join('');
}

// ─── Action: Ukur Redaman (Single) ────────────────────────────────────────────
async function handleUkur(ticket) {
  if (!ticket?.inet) {
    showToast('❌ Tiket ini tidak memiliki nomor iNetID.', 'error');
    return;
  }

  setUkurLoading(ticket.id, true);
  try {
    const result = await ukurRedaman(ticket.inet);

    if (!result.success) {
      showToast(`⚠️ ${result.message || 'LENSA tidak merespons. Coba lagi.'}`, 'warning');
      setUkurLoading(ticket.id, false);
      return;
    }

    // Simpan ke Supabase
    const changes = {
      onu_sn:        result.onu_sn        ?? null,
      onu_status:    result.onu_status    ?? null,
      onu_rx:        result.onu_rx        ?? null,
      olt_rx:        result.olt_rx        ?? null,
      onu_rx_status: result.onu_rx_status ?? null,
      olt_rx_status: result.olt_rx_status ?? null,
      acs_status:    result.acs_status    ?? null,
      pcrf:          result.pcrf          ?? null,
      gpon:          result.gpon          ?? null,
      result_text:   result.result_text   ?? null,
      redaman_at:    new Date().toISOString(),
    };

    const updated = await updateTicket(ticket.id, changes);
    const idx = tickets.findIndex(t => t.id === ticket.id);
    if (idx !== -1) tickets[idx] = updated;
    updateCardInPlace(updated);
    showToast('📡 Hasil ukur berhasil diperbarui!', 'success');
  } catch (err) {
    console.error(err);
    showToast(`❌ Gagal ukur redaman: ${err.message || 'Cek URL n8n di config.js.'}`, 'error');
    setUkurLoading(ticket.id, false);
  }
}

// ─── Helper: Identifikasi Tiket LOS & Belum Diukur ────────────────────────────
function isTicketLos(t) {
  const s = (t.onu_status || '').toUpperCase();
  const raw = t.raw_input || '';
  const res = t.result_text || '';
  const gg = t.gangguan || '';
  return s.includes('LOS') ||
         s.includes('OFFLINE') ||
         s.includes('DYING GASP') ||
         /-\s*‼️/i.test(raw) ||
         /\bLOS\b/i.test(raw) ||
         /\bLOS\b/i.test(res) ||
         /\bLOS\b/i.test(gg);
}

function isTicketUnmeasured(t) {
  return !t.redaman_at && !t.onu_status;
}

// ─── Action: Ukur Semua (Terisolasi tiap Filter & dengan Opsi Scope) ───────────
async function handleUkurSemua() {
  if (isMeasuringAll) {
    if (confirm('Hentikan proses pengukuran massal yang sedang berjalan?')) {
      abortMeasuringAll = true;
    }
    return;
  }

  const baseTargets = getFilteredTickets().filter(t => t.inet);
  if (baseTargets.length === 0) {
    showToast('⚠️ Tidak ada tiket ber-iNetID pada filter yang aktif.', 'warning');
    return;
  }

  const targetsAll = baseTargets;
  const targetsLos = baseTargets.filter(isTicketLos);
  const targetsUnmeasured = baseTargets.filter(isTicketUnmeasured);

  const statusLabel = activeFilter.status === 'all' ? 'Semua' : activeFilter.status.toUpperCase();
  const tierLabel   = activeFilter.tier === 'all'   ? 'Semua' : activeFilter.tier;

  let selectedScope = 'all';
  let currentTargets = targetsAll;

  showModal(`
    <h3 class="modal-title">📡 Ukur Redaman Massal</h3>
    <p class="modal-subtitle">Filter Aktif: Status [<b>${statusLabel}</b>] · Tier [<b>${tierLabel}</b>]</p>

    <div class="ukur-scope-options">
      <!-- Opsi 1: Ukur All -->
      <label class="ukur-option-card active" data-scope="all">
        <input type="radio" name="ukur-scope" value="all" checked>
        <div class="ukur-option-content">
          <div class="ukur-option-header">
            <span class="ukur-option-title">🌐 Ukur All</span>
            <span class="ukur-option-badge badge-all">${targetsAll.length} tiket</span>
          </div>
          <div class="ukur-option-desc">Ukur semua tiket yang ada pada filter aktif saat ini</div>
        </div>
      </label>

      <!-- Opsi 2: Ukur LOS -->
      <label class="ukur-option-card ${targetsLos.length === 0 ? 'disabled' : ''}" data-scope="los">
        <input type="radio" name="ukur-scope" value="los" ${targetsLos.length === 0 ? 'disabled' : ''}>
        <div class="ukur-option-content">
          <div class="ukur-option-header">
            <span class="ukur-option-title">🔴 Ukur LOS</span>
            <span class="ukur-option-badge badge-los">${targetsLos.length} tiket</span>
          </div>
          <div class="ukur-option-desc">Hanya tiket berstatus LOS / putus / belum ada redaman normal</div>
        </div>
      </label>

      <!-- Opsi 3: Ukur yg Belum Diukur -->
      <label class="ukur-option-card ${targetsUnmeasured.length === 0 ? 'disabled' : ''}" data-scope="unmeasured">
        <input type="radio" name="ukur-scope" value="unmeasured" ${targetsUnmeasured.length === 0 ? 'disabled' : ''}>
        <div class="ukur-option-content">
          <div class="ukur-option-header">
            <span class="ukur-option-title">⏳ Ukur yg Belum Diukur</span>
            <span class="ukur-option-badge badge-unmeasured">${targetsUnmeasured.length} tiket</span>
          </div>
          <div class="ukur-option-desc">Hanya tiket baru yang belum pernah diukur di aplikasi ini</div>
        </div>
      </label>
    </div>

    <div class="ukur-info-box" id="ukur-info-box">
      Akan mengukur redaman untuk <b>${targetsAll.length} tiket</b> secara berurutan.<br>
      <span style="font-size:0.75rem; color:#64748b;">(Estimasi waktu: ~${Math.ceil((targetsAll.length * 20) / 60)} menit. Server i-booster Telkom ~15-25 detik/tiket)</span>
    </div>
  `, {
    confirmLabel: `📡 Mulai Ukur (${targetsAll.length})`,
    cancelLabel: 'Batal',
    onConfirm: async () => {
      if (currentTargets.length === 0) {
        showToast('⚠️ Tidak ada tiket pada kategori yang dipilih.', 'warning');
        return;
      }

      isMeasuringAll = true;
      abortMeasuringAll = false;
      const btn = document.getElementById('btn-ukur-all');
      if (btn) {
        btn.disabled = false;
        btn.classList.add('measuring-active');
      }

      let successCount = 0;
      for (let i = 0; i < currentTargets.length; i++) {
        if (abortMeasuringAll) break;

        const t = currentTargets[i];
        if (btn) {
          btn.innerHTML = `<span>⏳</span><span>${i + 1}/${currentTargets.length} (Batal)</span>`;
        }
        setUkurLoading(t.id, true);

        try {
          const result = await ukurRedaman(t.inet);
          if (result && result.success) {
            const changes = {
              onu_sn:        result.onu_sn        ?? null,
              onu_status:    result.onu_status    ?? null,
              onu_rx:        result.onu_rx        ?? null,
              olt_rx:        result.olt_rx        ?? null,
              onu_rx_status: result.onu_rx_status ?? null,
              olt_rx_status: result.olt_rx_status ?? null,
              acs_status:    result.acs_status    ?? null,
              pcrf:          result.pcrf          ?? null,
              gpon:          result.gpon          ?? null,
              result_text:   result.result_text   ?? null,
              redaman_at:    new Date().toISOString(),
            };
            const updated = await updateTicket(t.id, changes);
            const idx = tickets.findIndex(x => x.id === t.id);
            if (idx !== -1) tickets[idx] = updated;
            updateCardInPlace(updated);
            successCount++;
          }
        } catch (err) {
          console.error(`Gagal ukur tiket ${t.inc}:`, err);
        } finally {
          setUkurLoading(t.id, false);
        }
      }

      isMeasuringAll = false;
      if (btn) {
        btn.classList.remove('measuring-active');
        btn.innerHTML = `<span>📡</span><span>Ukur Semua (<span id="ukur-all-count">${baseTargets.length}</span>)</span>`;
      }
      updateUkurAllButton();

      if (abortMeasuringAll) {
        showToast(`⏹️ Pengukuran dihentikan (${successCount}/${currentTargets.length} selesai).`, 'warning');
      } else {
        showToast(`✅ Selesai mengukur ${successCount} dari ${currentTargets.length} tiket!`, 'success');
      }
    }
  });

  // Attach interactive listeners for option selection
  const cards = document.querySelectorAll('.ukur-option-card');
  const infoBox = document.getElementById('ukur-info-box');
  const confirmBtn = document.getElementById('modal-confirm');

  cards.forEach(card => {
    card.addEventListener('click', () => {
      if (card.classList.contains('disabled')) return;
      const scope = card.dataset.scope;
      if (!scope) return;
      selectedScope = scope;

      if (scope === 'all') currentTargets = targetsAll;
      else if (scope === 'los') currentTargets = targetsLos;
      else if (scope === 'unmeasured') currentTargets = targetsUnmeasured;

      const count = currentTargets.length;

      cards.forEach(c => {
        const isCur = c.dataset.scope === scope;
        c.classList.toggle('active', isCur);
        const radio = c.querySelector('input[type="radio"]');
        if (radio) radio.checked = isCur;
      });

      if (confirmBtn) {
        confirmBtn.disabled = count === 0;
        confirmBtn.textContent = count > 0 ? `📡 Mulai Ukur (${count})` : 'Tidak Ada Tiket';
      }

      if (infoBox) {
        if (count === 0) {
          infoBox.innerHTML = `⚠️ <b>0 tiket ditemukan</b> untuk opsi ini.`;
        } else {
          const estMin = Math.ceil((count * 20) / 60);
          infoBox.innerHTML = `
            Akan mengukur redaman untuk <b>${count} tiket</b> secara berurutan.<br>
            <span style="font-size:0.75rem; color:#64748b;">(Estimasi waktu: ~${estMin} menit. Server i-booster Telkom ~15-25 detik/tiket)</span>
          `;
        }
      }
    });
  });
}

// ─── Action: Toggle Done ──────────────────────────────────────────────────────
async function handleDone(ticket) {
  if (!ticket) return;

  // Unmark jika sudah done
  if (ticket.status === 'done') {
    showModal(`
      <h3 class="modal-title">↩️ Batalkan Status Selesai?</h3>
      <p>Tiket <code>${ticket.inc || '—'}</code> akan dikembalikan ke status <b>Open</b>.</p>
    `, {
      confirmLabel: '↩️ Ya, Unmark',
      dangerous: true,
      onConfirm: async () => {
        try {
          const updated = await updateTicket(ticket.id, {
            status: 'open', perbaikan: null, penyebab: null,
          });
          const idx = tickets.findIndex(t => t.id === ticket.id);
          if (idx !== -1) tickets[idx] = updated;
          updateCardInPlace(updated);
          showToast('↩️ Status tiket dikembalikan ke Open', 'info');
        } catch (err) {
          showToast('❌ Gagal update', 'error');
        }
      },
    });
    return;
  }

  // Mark done — minta input
  const result = await showInputModal(modalDone(ticket), {
    confirmLabel: '✅ Tandai Selesai',
    getValues: () => ({
      perbaikan: document.getElementById('input-perbaikan')?.value.trim() ?? '',
      penyebab:  document.getElementById('input-penyebab')?.value.trim() ?? '',
      teknisi:   document.getElementById('input-teknisi-done')?.value.trim() ?? '',
    }),
  });

  if (!result) return;
  if (!result.perbaikan) {
    showToast('⚠️ Isi dulu kolom Perbaikan!', 'warning');
    return;
  }

  // Simpan nama teknisi ke daftar dropdown
  if (result.teknisi) {
    saveTechnicianName(result.teknisi);
  }

  try {
    const updated = await updateTicket(ticket.id, {
      status:       'done',
      perbaikan:    result.perbaikan,
      penyebab:     result.penyebab || null,
      teknisi:      result.teknisi  || ticket.teknisi || null,
      kendala_text: null,
    });
    const idx = tickets.findIndex(t => t.id === ticket.id);
    if (idx !== -1) tickets[idx] = updated;
    updateCardInPlace(updated);
    showToast('✅ Tiket ditandai Selesai!', 'success');
  } catch (err) {
    console.error(err);
    showToast('❌ Gagal update', 'error');
  }
}

// ─── Action: Toggle Kendala ───────────────────────────────────────────────────
async function handleKendala(ticket) {
  if (!ticket) return;

  if (ticket.status === 'kendala') {
    showModal(`
      <h3 class="modal-title">↩️ Batalkan Kendala?</h3>
      <p>Tiket <code>${ticket.inc || '—'}</code> akan dikembalikan ke status <b>Open</b>.</p>
    `, {
      confirmLabel: '↩️ Batalkan Kendala',
      dangerous: true,
      onConfirm: async () => {
        try {
          const updated = await updateTicket(ticket.id, { status: 'open', kendala_text: null });
          const idx = tickets.findIndex(t => t.id === ticket.id);
          if (idx !== -1) tickets[idx] = updated;
          updateCardInPlace(updated);
          showToast('↩️ Kendala dibatalkan', 'info');
        } catch (err) {
          showToast('❌ Gagal update', 'error');
        }
      },
    });
    return;
  }

  const result = await showInputModal(modalKendala(ticket), {
    confirmLabel: '⚠️ Tandai Kendala',
    getValues: () => ({
      kendala_text: document.getElementById('input-kendala')?.value.trim() ?? '',
      teknisi:      document.getElementById('input-teknisi-kendala')?.value.trim() ?? '',
    }),
  });

  if (!result) return;

  // Simpan nama teknisi ke daftar dropdown
  if (result.teknisi) {
    saveTechnicianName(result.teknisi);
  }

  try {
    const updated = await updateTicket(ticket.id, {
      status:       'kendala',
      kendala_text: result.kendala_text || null,
      teknisi:      result.teknisi || ticket.teknisi || null,
    });
    const idx = tickets.findIndex(t => t.id === ticket.id);
    if (idx !== -1) tickets[idx] = updated;
    updateCardInPlace(updated);
    showToast('⚠️ Tiket ditandai Kendala!', 'warning');
  } catch (err) {
    console.error(err);
    showToast('❌ Gagal update', 'error');
  }
}

// ─── Action: Rekap ────────────────────────────────────────────────────────────
function handleRekap(ticket) {
  if (!ticket) return;
  showModal(modalRekap(ticket), {
    confirmLabel: '✖ Tutup',
    cancelLabel: '', // otomatis disembunyikan di showModal
  });
}

// ─── Action: Delete ───────────────────────────────────────────────────────────
function handleDelete(ticket) {
  if (!ticket) return;
  showModal(`
    <h3 class="modal-title">🗑️ Hapus Tiket?</h3>
    <p>Tiket <code>${ticket.inc || ticket.inet || '—'}</code> akan dihapus permanen.</p>
  `, {
    confirmLabel: '🗑️ Hapus',
    dangerous: true,
    onConfirm: async () => {
      try {
        await deleteTicket(ticket.id);
        tickets = tickets.filter(t => t.id !== ticket.id);
        removeCard(ticket.id);
        updateStats(tickets);
        updateUkurAllButton();
        showToast('🗑️ Tiket dihapus', 'info');
      } catch (err) {
        showToast('❌ Gagal menghapus', 'error');
      }
    },
  });
}

// ─── Start ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
