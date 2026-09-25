/**
 * app.js — Main controller: init, event handling, realtime
 */

import { parseTickets } from './parser.js';
import { fetchTickets, addTickets, updateTicket, deleteTicket, subscribeToTickets } from './supabase-client.js';
import { ukurRedaman } from './lensa.js';
import {
  renderAllTickets, updateCardInPlace, removeCard, insertCard,
  setUkurLoading, showToast, showModal, showInputModal,
  modalAddTicket, modalDone, modalKendala, modalRekap,
  updateAllTimers, updateStats,
} from './ui.js';

// ─── State ────────────────────────────────────────────────────────────────────
let tickets   = [];   // array of ticket objects (local cache)
let activeFilter = { status: 'all', tier: 'all' };

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  showLoading(true);
  try {
    tickets = await fetchTickets();
    renderAllTickets(tickets, activeFilter);
    updateStats(tickets);
  } catch (e) {
    showToast('❌ Gagal memuat tiket dari Supabase. Cek config.js!', 'error');
    console.error(e);
  } finally {
    showLoading(false);
  }

  // Realtime subscription
  subscribeToTickets(handleRealtimeChange);

  // Timer: update SLA setiap 30 detik
  setInterval(updateAllTimers, 30000);

  // Event delegation
  document.addEventListener('click', handleClick);
  document.addEventListener('input', handleInput);

  // Filter buttons
  document.querySelectorAll('[data-filter-status]').forEach(btn => {
    btn.addEventListener('click', () => {
      activeFilter.status = btn.dataset.filterStatus;
      document.querySelectorAll('[data-filter-status]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderAllTickets(tickets, activeFilter);
    });
  });

  document.querySelectorAll('[data-filter-tier]').forEach(btn => {
    btn.addEventListener('click', () => {
      activeFilter.tier = btn.dataset.filterTier;
      document.querySelectorAll('[data-filter-tier]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderAllTickets(tickets, activeFilter);
    });
  });
}

// ─── Loading indicator ────────────────────────────────────────────────────────
function showLoading(on) {
  const el = document.getElementById('loading-bar');
  if (el) el.style.display = on ? 'block' : 'none';
}

// ─── Realtime handler ─────────────────────────────────────────────────────────
function handleRealtimeChange({ eventType, old: oldRow, new: newRow }) {
  if (eventType === 'INSERT') {
    // Hindari duplikat jika kita yang insert
    if (!tickets.find(t => t.id === newRow.id)) {
      tickets.push(newRow);
      insertCard(newRow);
      updateStats(tickets);
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
  } else if (eventType === 'DELETE') {
    tickets = tickets.filter(t => t.id !== oldRow.id);
    removeCard(oldRow.id);
    updateStats(tickets);
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
    // Realtime akan handle insert, tapi tambahkan ke lokal juga untuk responsivitas
    if (inserted) {
      inserted.forEach(t => {
        if (!tickets.find(x => x.id === t.id)) {
          tickets.push(t);
        }
      });
      renderAllTickets(tickets, activeFilter);
      updateStats(tickets);
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

// ─── Action: Ukur Redaman ─────────────────────────────────────────────────────
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
      onu_sn:        result.onu_sn     ?? null,
      onu_status:    result.onu_status ?? null,
      onu_rx:        result.onu_rx     ?? null,
      olt_rx:        result.olt_rx     ?? null,
      onu_rx_status: result.onu_rx_status ?? null,
      olt_rx_status: result.olt_rx_status ?? null,
      acs_status:    result.acs_status ?? null,
      pcrf:          result.pcrf       ?? null,
      gpon:          result.gpon       ?? null,
      result_text:   result.result_text ?? null,
      redaman_at:    new Date().toISOString(),
    };

    const updated = await updateTicket(ticket.id, changes);
    const idx = tickets.findIndex(t => t.id === ticket.id);
    if (idx !== -1) tickets[idx] = updated;
    updateCardInPlace(updated);
    showToast('📡 Hasil ukur berhasil diperbarui!', 'success');
  } catch (err) {
    console.error(err);
    showToast('❌ Gagal ukur redaman. Cek URL n8n di config.js.', 'error');
    setUkurLoading(ticket.id, false);
  }
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

  try {
    const updated = await updateTicket(ticket.id, {
      status:    'done',
      perbaikan: result.perbaikan,
      penyebab:  result.penyebab || null,
      teknisi:   result.teknisi  || ticket.teknisi || null,
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
    cancelLabel: '',
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
        showToast('🗑️ Tiket dihapus', 'info');
      } catch (err) {
        showToast('❌ Gagal menghapus', 'error');
      }
    },
  });
}

// ─── Start ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
