/**
 * app.js — Main controller: init, event handling, realtime, ukur semua, grup & pin
 */

import { parseTickets } from './parser.js';
import { fetchTickets, addTickets, updateTicket, deleteTicket, subscribeToTickets } from './supabase-client.js';
import { ukurRedaman } from './lensa.js';
import {
  renderAllTickets, updateCardInPlace, removeCard, insertCard,
  setUkurLoading, showToast, showModal, showInputModal,
  modalAddTicket, modalDone, modalKendala, modalRekap,
  modalManageGroups, renderGroupTabs,
  updateAllTimers, updateStats, saveTechnicianName,
  getCompactRedamanStatus,
} from './ui.js';

// ─── State ────────────────────────────────────────────────────────────────────
let tickets           = [];   // array of ticket objects (local cache)
let activeFilter      = { status: 'all', tier: 'all', optical: 'all', sort: 'ttr_desc', group: 'all', search: '' };
let customGroups      = [];   // array nama grup kustom
let isMeasuringAll    = false;
let abortMeasuringAll = false;

// Mode Ringkas / Compact vs Detail (Default: Collapse / Compact)
let isCompactMode       = true;
const expandedTicketIds  = new Set();
const collapsedTicketIds = new Set();

// Mode Batch Selection (Pilih banyak untuk ukur / hapus)
let isBatchMode         = false;
const selectedBatchIds   = new Set();
let isMeasuringBatch    = false;
let abortMeasuringBatch = false;

// ─── Compact / Collapse helper ───────────────────────────────────────────────
function isCardCollapsed(id) {
  return isCompactMode ? !expandedTicketIds.has(id) : collapsedTicketIds.has(id);
}

// ─── Render current view with active filters & options ───────────────────────
function renderCurrentView() {
  renderAllTickets(getGroupTickets(), activeFilter, {
    isCompact: isCompactMode,
    isBatch: isBatchMode,
    selectedIds: selectedBatchIds,
    isCardCollapsedFn: isCardCollapsed,
  });
  updateUkurAllButton();
  updateStats(getGroupTickets(), activeFilter);
}

// ─── Group Storage & Helper ───────────────────────────────────────────────────
function loadStoredCustomGroups() {
  try {
    return JSON.parse(localStorage.getItem('ticket_custom_groups') || '[]');
  } catch {
    return [];
  }
}

function saveCustomGroups() {
  localStorage.setItem('ticket_custom_groups', JSON.stringify(customGroups));
}

function loadStoredGroupMappings() {
  try {
    return JSON.parse(localStorage.getItem('ticket_groups_map') || '{}');
  } catch {
    return {};
  }
}

function mergeGroupsIntoTickets(ticketList) {
  const map = loadStoredGroupMappings();
  ticketList.forEach(t => {
    t.is_pinned = t.sort_order === 1;
    if (t.groups) {
      if (typeof t.groups === 'string') {
        t.groups = t.groups.split(',').map(s => s.trim()).filter(Boolean);
      }
    } else if (map[t.id]) {
      t.groups = map[t.id];
    } else {
      t.groups = [];
    }

    t.groups.forEach(g => {
      if (!customGroups.includes(g)) customGroups.push(g);
    });
  });
  saveCustomGroups();
}

async function saveTicketGroups(ticketId, newGroups) {
  const t = tickets.find(x => x.id === ticketId);
  if (t) t.groups = newGroups;

  const map = loadStoredGroupMappings();
  map[ticketId] = newGroups;
  localStorage.setItem('ticket_groups_map', JSON.stringify(map));

  newGroups.forEach(g => {
    if (!customGroups.includes(g)) customGroups.push(g);
  });
  saveCustomGroups();

  try {
    await updateTicket(ticketId, { groups: newGroups.join(',') });
  } catch (err) {
    // Abaikan jika kolom groups belum ada di DB (data tetap aman di localStorage)
  }
}

// ─── Helper: Get tickets matching active group & filters ──────────────────────
function getGroupTickets() {
  if (!activeFilter.group || activeFilter.group === 'all') return tickets;
  return tickets.filter(t => {
    const g = Array.isArray(t.groups) ? t.groups : (typeof t.groups === 'string' && t.groups ? t.groups.split(',').map(s=>s.trim()).filter(Boolean) : []);
    return g.includes(activeFilter.group);
  });
}

function getFilteredTickets() {
  let list = getGroupTickets();
  if (activeFilter.status && activeFilter.status !== 'all') {
    list = list.filter(t => t.status === activeFilter.status);
  }
  if (activeFilter.tier && activeFilter.tier !== 'all') {
    list = list.filter(t => t.tier === activeFilter.tier);
  }
  if (activeFilter.optical && activeFilter.optical !== 'all') {
    list = list.filter(t => {
      const opt = getCompactRedamanStatus(t);
      if (activeFilter.optical === 'los') return opt.type === 'los';
      if (activeFilter.optical === 'unspec') return opt.type === 'unspec';
      if (activeFilter.optical === 'spec') return opt.type === 'online';
      if (activeFilter.optical === 'unmeasured') return opt.type === 'unmeasured';
      return true;
    });
  }
  if (activeFilter.search && activeFilter.search.trim()) {
    const q = activeFilter.search.trim().toLowerCase();
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

// ─── Batch Action Bar UI Helper ───────────────────────────────────────────────
function updateBatchActionBar() {
  const bar = document.getElementById('batch-action-bar');
  if (!bar) return;

  const countSelected = selectedBatchIds.size;
  const countEl = document.getElementById('batch-selected-count');
  if (countEl) countEl.innerHTML = `${countSelected}<span class="hide-mobile"> dipilih</span>`;

  const btnGroup = document.getElementById('btn-batch-group');
  const countGroupEl = document.getElementById('batch-count-group');
  if (countGroupEl) countGroupEl.textContent = countSelected;
  if (btnGroup) btnGroup.disabled = countSelected === 0;

  const btnUkur = document.getElementById('btn-batch-ukur');
  const countUkurEl = document.getElementById('batch-count-ukur');
  const btnDelete = document.getElementById('btn-batch-delete');
  const countDeleteEl = document.getElementById('batch-count-delete');

  const selectedTickets = tickets.filter(t => selectedBatchIds.has(t.id));
  const selectedWithInet = selectedTickets.filter(t => t.inet);

  if (countUkurEl) countUkurEl.textContent = selectedWithInet.length;
  if (btnUkur && !isMeasuringBatch) btnUkur.disabled = selectedWithInet.length === 0;

  if (countDeleteEl) countDeleteEl.textContent = countSelected;
  if (btnDelete) btnDelete.disabled = countSelected === 0;

  const visibleTickets = getFilteredTickets();
  const allVisibleSelected = visibleTickets.length > 0 && visibleTickets.every(t => selectedBatchIds.has(t.id));
  const selectAllText = document.getElementById('batch-select-all-text');
  const selectAllIcon = document.getElementById('batch-select-all-icon');
  if (selectAllText) {
    selectAllText.innerHTML = allVisibleSelected
      ? '<span class="hide-mobile">Batalkan </span>Batal'
      : '<span class="hide-mobile">Pilih </span>Semua';
  }
  if (selectAllIcon) selectAllIcon.textContent = allVisibleSelected ? '⬜' : '☑️';
}

function setBatchMode(active) {
  isBatchMode = active;
  if (!isBatchMode) {
    selectedBatchIds.clear();
  }
  document.body.classList.toggle('batch-mode-active', isBatchMode);
  const btnBatchMode = document.getElementById('btn-batch-mode');
  if (btnBatchMode) btnBatchMode.classList.toggle('active', isBatchMode);

  const batchActionBar = document.getElementById('batch-action-bar');
  if (batchActionBar) {
    batchActionBar.style.display = isBatchMode ? 'flex' : 'none';
  }

  renderCurrentView();
  updateBatchActionBar();
}

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  showLoading(true);
  try {
    tickets = await fetchTickets();
    customGroups = loadStoredCustomGroups();
    mergeGroupsIntoTickets(tickets);

    renderGroupTabs(customGroups, activeFilter.group, tickets);
    renderCurrentView();
    updateStats(getGroupTickets());
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

  // Checkbox batch selection change listener
  document.addEventListener('change', (e) => {
    if (e.target.classList.contains('card-batch-select')) {
      const id = e.target.dataset.batchId;
      if (!id) return;
      if (e.target.checked) {
        selectedBatchIds.add(id);
      } else {
        selectedBatchIds.delete(id);
      }
      const card = e.target.closest('.ticket-card');
      if (card) card.classList.toggle('is-batch-selected', e.target.checked);
      updateBatchActionBar();
    }
  });

  // Mobile Autohide Sticky Header saat scroll ke bawah
  let lastScrollY = window.scrollY;
  let scrollTicking = false;

  window.addEventListener('scroll', () => {
    if (!scrollTicking) {
      window.requestAnimationFrame(() => {
        const currentScrollY = window.scrollY;
        const stickyNav = document.getElementById('sticky-nav');
        if (stickyNav) {
          const delta = currentScrollY - lastScrollY;
          // Hanya sembunyikan jika scroll ke bawah dan sudah lewat header atas (> 60px)
          if (currentScrollY > 60 && delta > 8) {
            stickyNav.classList.add('nav-hidden');
          } else if (delta < -8 || currentScrollY <= 25) {
            stickyNav.classList.remove('nav-hidden');
          }
        }
        lastScrollY = Math.max(0, currentScrollY);
        scrollTicking = false;
      });
      scrollTicking = true;
    }
  }, { passive: true });

  // Search input & clear button
  const inputSearch = document.getElementById('input-search');
  const btnClearSearch = document.getElementById('btn-clear-search');
  if (inputSearch) {
    inputSearch.addEventListener('input', (e) => {
      activeFilter.search = e.target.value;
      if (btnClearSearch) {
        btnClearSearch.style.display = activeFilter.search ? 'inline-flex' : 'none';
      }
      renderCurrentView();
    });
  }
  if (btnClearSearch) {
    btnClearSearch.addEventListener('click', () => {
      if (inputSearch) inputSearch.value = '';
      activeFilter.search = '';
      btnClearSearch.style.display = 'none';
      renderCurrentView();
    });
  }

  // Toggle Collapse / Expand All
  const btnToggleCompact = document.getElementById('btn-toggle-compact');
  const iconCompactMode = document.getElementById('icon-compact-mode');
  const labelCompactMode = document.getElementById('label-compact-mode');

  // Default mode: compact mode is TRUE
  if (labelCompactMode) labelCompactMode.textContent = 'Detail';
  if (iconCompactMode) iconCompactMode.textContent = '📖';

  if (btnToggleCompact) {
    btnToggleCompact.addEventListener('click', () => {
      isCompactMode = !isCompactMode;
      expandedTicketIds.clear();
      collapsedTicketIds.clear();

      if (isCompactMode) {
        if (labelCompactMode) labelCompactMode.textContent = 'Detail';
        if (iconCompactMode) iconCompactMode.textContent = '📖';
        btnToggleCompact.classList.remove('active');
        showToast('📁 Tampilan diringkas (Compact mode)', 'info');
      } else {
        if (labelCompactMode) labelCompactMode.textContent = 'Ringkas';
        if (iconCompactMode) iconCompactMode.textContent = '📁';
        btnToggleCompact.classList.add('active');
        showToast('📖 Tampilan lengkap (Detail mode)', 'info');
      }
      renderCurrentView();
    });
  }

  // Batch Mode Toggle button di header
  const btnBatchMode = document.getElementById('btn-batch-mode');
  if (btnBatchMode) {
    btnBatchMode.addEventListener('click', () => {
      setBatchMode(!isBatchMode);
    });
  }

  // Batch Action Bar: Select All
  const btnBatchSelectAll = document.getElementById('btn-batch-select-all');
  if (btnBatchSelectAll) {
    btnBatchSelectAll.addEventListener('click', handleBatchSelectAll);
  }

  // Batch Action Bar: Cancel / Close
  const btnBatchCancel = document.getElementById('btn-batch-cancel');
  if (btnBatchCancel) {
    btnBatchCancel.addEventListener('click', () => setBatchMode(false));
  }

  // Batch Action Bar: Masukkan ke Grup
  const btnBatchGroup = document.getElementById('btn-batch-group');
  if (btnBatchGroup) {
    btnBatchGroup.addEventListener('click', handleBatchGroup);
  }

  // Batch Action Bar: Delete
  const btnBatchDelete = document.getElementById('btn-batch-delete');
  if (btnBatchDelete) {
    btnBatchDelete.addEventListener('click', handleBatchDelete);
  }

  // Batch Action Bar: Ukur
  const btnBatchUkur = document.getElementById('btn-batch-ukur');
  if (btnBatchUkur) {
    btnBatchUkur.addEventListener('click', handleBatchUkur);
  }

  // Group bar events
  const groupBar = document.getElementById('group-bar');
  if (groupBar) {
    groupBar.addEventListener('click', (e) => {
      const delBtn = e.target.closest('[data-action="delete-group"]');
      if (delBtn) {
        e.stopPropagation();
        handleDeleteGroup(delBtn.dataset.group);
        return;
      }

      const addBtn = e.target.closest('#btn-add-group');
      if (addBtn) {
        handleCreateNewGroup();
        return;
      }

      const tabBtn = e.target.closest('.btn-group-tab[data-group]');
      if (tabBtn) {
        activeFilter.group = tabBtn.dataset.group;
        renderGroupTabs(customGroups, activeFilter.group, tickets);
        renderCurrentView();
        updateStats(getGroupTickets());
        updateUkurAllButton();
      }
    });
  }

  // Filter buttons (Status)
  document.querySelectorAll('[data-filter-status]').forEach(btn => {
    btn.addEventListener('click', () => {
      activeFilter.status = btn.dataset.filterStatus;
      document.querySelectorAll('[data-filter-status]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderCurrentView();
    });
  });

  // Filter buttons (Tier)
  document.querySelectorAll('[data-filter-tier]').forEach(btn => {
    btn.addEventListener('click', () => {
      activeFilter.tier = btn.dataset.filterTier;
      document.querySelectorAll('[data-filter-tier]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderCurrentView();
    });
  });

  // Filter buttons (Optical Condition)
  document.querySelectorAll('[data-filter-optical]').forEach(btn => {
    btn.addEventListener('click', () => {
      activeFilter.optical = btn.dataset.filterOptical;
      document.querySelectorAll('[data-filter-optical]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderCurrentView();
    });
  });

  // Sort dropdown
  const sortSelect = document.getElementById('select-sort');
  if (sortSelect) {
    sortSelect.value = activeFilter.sort;
    sortSelect.addEventListener('change', (e) => {
      activeFilter.sort = e.target.value;
      renderCurrentView();
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
      mergeGroupsIntoTickets([newRow]);
      tickets.push(newRow);
      renderGroupTabs(customGroups, activeFilter.group, tickets);
      renderCurrentView();
      updateStats(getGroupTickets());
      updateBatchActionBar();
    }
  } else if (eventType === 'UPDATE') {
    const idx = tickets.findIndex(t => t.id === newRow.id);
    if (idx !== -1) {
      newRow.groups = newRow.groups || tickets[idx].groups;
      newRow.is_pinned = newRow.sort_order === 1 || tickets[idx].is_pinned;
      tickets[idx] = newRow;
    } else {
      mergeGroupsIntoTickets([newRow]);
      tickets.push(newRow);
    }
    updateCardInPlace(newRow, isCardCollapsed(newRow.id), isBatchMode, selectedBatchIds.has(newRow.id));
    renderGroupTabs(customGroups, activeFilter.group, tickets);
    updateStats(getGroupTickets());
    updateBatchActionBar();
    updateUkurAllButton();
  } else if (eventType === 'DELETE') {
    tickets = tickets.filter(t => t.id !== oldRow.id);
    selectedBatchIds.delete(oldRow.id);
    removeCard(oldRow.id);
    renderGroupTabs(customGroups, activeFilter.group, tickets);
    updateStats(getGroupTickets());
    updateBatchActionBar();
    updateUkurAllButton();
  }
}

// ─── Event delegation ─────────────────────────────────────────────────────────
async function handleClick(e) {
  // Toggle rincian kartu (collapse / expand per card)
  const expandBtn = e.target.closest('[data-action="toggle-card-collapse"]');
  if (expandBtn) {
    const id = expandBtn.dataset.id;
    const card = expandBtn.closest('.ticket-card');
    if (!id || !card) return;

    if (isCompactMode) {
      if (expandedTicketIds.has(id)) {
        expandedTicketIds.delete(id);
        card.classList.add('is-collapsed');
        expandBtn.textContent = '▼';
        expandBtn.title = 'Lihat rincian';
      } else {
        expandedTicketIds.add(id);
        card.classList.remove('is-collapsed');
        expandBtn.textContent = '▲';
        expandBtn.title = 'Sembunyikan rincian';
      }
    } else {
      if (collapsedTicketIds.has(id)) {
        collapsedTicketIds.delete(id);
        card.classList.remove('is-collapsed');
        expandBtn.textContent = '▲';
        expandBtn.title = 'Sembunyikan rincian';
      } else {
        collapsedTicketIds.add(id);
        card.classList.add('is-collapsed');
        expandBtn.textContent = '▼';
        expandBtn.title = 'Lihat rincian';
      }
    }
    return;
  }

  const btn = e.target.closest('[data-action]');
  if (!btn) return;

  const action = btn.dataset.action;
  const id     = btn.dataset.id;
  const ticket = tickets.find(t => t.id === id);

  switch (action) {
    case 'ukur':          return handleUkur(ticket);
    case 'done':          return handleDone(ticket);
    case 'kendala':       return handleKendala(ticket);
    case 'rekap':         return handleRekap(ticket);
    case 'delete':        return handleDelete(ticket);
    case 'add':           return handleAddTicket();
    case 'pin':           return handlePin(ticket);
    case 'manage-groups': return handleManageGroups(ticket);
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
  const result = await showInputModal(modalAddTicket(customGroups, activeFilter.group), {
    confirmLabel: '✅ Tambah Tiket',
    getValues: () => {
      const raw = document.getElementById('input-paste')?.value ?? '';
      const pending = document.getElementById('input-modal-add-group')?.value.trim();
      if (pending && !customGroups.includes(pending)) {
        customGroups.push(pending);
        saveCustomGroups();
        renderGroupTabs(customGroups, activeFilter.group, tickets);
      }

      const checked = Array.from(document.querySelectorAll('input[name="add-ticket-group-check"]:checked'))
        .map(el => el.value.trim())
        .filter(Boolean);

      if (pending && !checked.includes(pending)) {
        checked.push(pending);
      }

      return { raw, groups: checked };
    },
    onMount: () => {
      const groupList = document.getElementById('modal-add-group-list');
      const btnAddGroup = document.getElementById('btn-modal-add-group');
      const inputAddGroup = document.getElementById('input-modal-add-group');

      const setupToggle = (item) => {
        item.addEventListener('change', () => {
          const chk = item.querySelector('input[type="checkbox"]');
          if (chk) item.classList.toggle('checked', chk.checked);
        });
      };

      document.querySelectorAll('#modal-add-group-list .group-select-item').forEach(setupToggle);

      const addGroupItem = (name) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        if (!customGroups.includes(trimmed)) {
          customGroups.push(trimmed);
          saveCustomGroups();
          renderGroupTabs(customGroups, activeFilter.group, tickets);
        }

        const emptyMsg = document.getElementById('modal-add-group-empty');
        if (emptyMsg) emptyMsg.style.display = 'none';

        const existing = groupList?.querySelector(`.group-select-item[data-group-name="${trimmed}"]`);
        if (existing) {
          const chk = existing.querySelector('input[type="checkbox"]');
          if (chk) chk.checked = true;
          existing.classList.add('checked');
          existing.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else if (groupList) {
          const label = document.createElement('label');
          label.className = 'group-select-item checked';
          label.dataset.groupName = trimmed;
          label.innerHTML = `<span>📁 <b>${trimmed}</b></span><input type="checkbox" name="add-ticket-group-check" value="${trimmed}" checked>`;
          setupToggle(label);
          groupList.appendChild(label);
          label.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
        if (inputAddGroup) inputAddGroup.value = '';
      };

      if (btnAddGroup && inputAddGroup) {
        btnAddGroup.addEventListener('click', () => addGroupItem(inputAddGroup.value));
        inputAddGroup.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            addGroupItem(inputAddGroup.value);
          }
        });
      }
    }
  });

  if (!result || !result.raw.trim()) return;

  const parsed = parseTickets(result.raw);
  if (!parsed.length) {
    showToast('❌ Format tidak dikenali. Coba paste ulang teks WO atau format singkat.', 'error');
    return;
  }

  // Cek duplikasi terhadap tiket yang masih aktif (status 'open' atau 'kendala')
  const activeTickets = tickets.filter(t => t.status !== 'done');
  const validTickets = [];
  const duplicateTickets = [];
  const seenInInput = new Set();

  for (const t of parsed) {
    const incKey = t.inc ? t.inc.trim().toUpperCase() : null;
    const inetKey = t.inet ? t.inet.trim() : null;

    // Cek duplikat dalam batch input yang sama
    const inputKey = incKey || inetKey;
    if (inputKey && seenInInput.has(inputKey)) {
      duplicateTickets.push({ ticket: t, label: incKey || inetKey, status: 'input ganda' });
      continue;
    }
    if (inputKey) seenInInput.add(inputKey);

    // Cek duplikat terhadap tiket aktif di sistem
    const existing = activeTickets.find(x => {
      const matchInc = incKey && x.inc && x.inc.trim().toUpperCase() === incKey;
      const matchInet = inetKey && x.inet && x.inet.trim() === inetKey;
      return matchInc || matchInet;
    });

    if (existing) {
      const label = incKey || inetKey || 'Tiket';
      duplicateTickets.push({ ticket: t, label, status: existing.status });
    } else {
      validTickets.push(t);
    }
  }

  // Jika semua tiket yang dimasukkan sudah ada di sistem
  if (validTickets.length === 0) {
    if (duplicateTickets.length === 1) {
      const dupe = duplicateTickets[0];
      showToast(`⚠️ Tiket ${dupe.label} sudah ada di sistem (Status: ${dupe.status})!`, 'warning');
    } else {
      const labels = duplicateTickets.map(d => d.label).slice(0, 3).join(', ');
      showToast(`⚠️ Semua tiket (${duplicateTickets.length}) sudah ada di sistem (${labels})!`, 'warning');
    }
    return;
  }

  try {
    const inserted = await addTickets(validTickets);
    if (inserted) {
      const selectedGroups = result.groups || [];
      for (const t of inserted) {
        t.groups = [...selectedGroups];
        if (!tickets.find(x => x.id === t.id)) {
          tickets.push(t);
        }
        if (selectedGroups.length > 0) {
          await saveTicketGroups(t.id, selectedGroups);
        }
      }
      renderGroupTabs(customGroups, activeFilter.group, tickets);
      renderCurrentView();
      updateStats(getGroupTickets());
      updateUkurAllButton();
    }
    const groupNote = (result.groups && result.groups.length > 0)
      ? ` (ke grup: ${result.groups.join(', ')})`
      : '';

    if (duplicateTickets.length > 0) {
      const dupeLabels = duplicateTickets.map(d => d.label).join(', ');
      showToast(`✅ ${validTickets.length} tiket ditambahkan${groupNote}. ⚠️ ${duplicateTickets.length} tiket dilewati karena sudah ada: ${dupeLabels}`, 'warning');
    } else {
      showToast(`✅ ${validTickets.length} tiket berhasil ditambahkan${groupNote}!`, 'success');
    }
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

function isUserNotFoundMessage(msg) {
  if (!msg) return false;
  return /tidak menemukan posisi perangkat|belum terdaftar|posisi perangkat berada di server mana/i.test(String(msg));
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

    if (result && isUserNotFoundMessage(result.message || result.error || result.result_text || '')) {
      const changes = {
        onu_sn:        null,
        onu_status:    'User internet tidak ditemukan',
        onu_rx:        null,
        olt_rx:        null,
        onu_rx_status: 'warn',
        olt_rx_status: 'warn',
        acs_status:    null,
        pcrf:          null,
        gpon:          null,
        result_text:   `⚠️ <b>User internet tidak ditemukan</b><br><small style="color:#64748b;">${result.message || 'Perangkat tidak ditemukan di server iBooster'}</small>`,
        redaman_at:    new Date().toISOString(),
      };

      const updated = await updateTicket(ticket.id, changes);
      const idx = tickets.findIndex(t => t.id === ticket.id);
      if (idx !== -1) tickets[idx] = updated;
      updateCardInPlace(updated);
      setUkurLoading(ticket.id, false);
      renderCurrentView();
      showToast('⚠️ User internet tidak ditemukan di server iBooster.', 'warning');
      return;
    }

    if (!result || !result.success) {
      showToast(`⚠️ ${result?.message || 'LENSA tidak merespons. Coba lagi.'}`, 'warning');
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
    setUkurLoading(ticket.id, false);
    renderCurrentView();
    showToast('📡 Hasil ukur berhasil diperbarui!', 'success');
  } catch (err) {
    console.error(err);
    showToast(`❌ Gagal ukur redaman: ${err.message || 'Cek URL n8n di config.js.'}`, 'error');
    setUkurLoading(ticket.id, false);
  }
}

// ─── Batch Actions (Select All, Delete, Ukur) ─────────────────────────────────
function handleBatchSelectAll() {
  const visible = getFilteredTickets();
  if (visible.length === 0) return;

  const allSelected = visible.every(t => selectedBatchIds.has(t.id));
  if (allSelected) {
    visible.forEach(t => selectedBatchIds.delete(t.id));
  } else {
    visible.forEach(t => selectedBatchIds.add(t.id));
  }
  renderCurrentView();
  updateBatchActionBar();
}

async function handleBatchGroup() {
  if (selectedBatchIds.size === 0) return;
  const count = selectedBatchIds.size;
  const toAssignIds = [...selectedBatchIds];
  const targetTickets = tickets.filter(t => toAssignIds.includes(t.id));

  const itemsHtml = customGroups.length === 0
    ? `<div id="modal-batch-group-empty" style="color: #94a3b8; font-size: 0.82rem; padding: 10px; text-align: center;">Belum ada grup yang dibuat. Ketik nama grup baru di bawah.</div>`
    : customGroups.map(g => `
        <label class="group-select-item" data-group-name="${g}">
          <span>📁 <b>${g}</b></span>
          <input type="checkbox" name="batch-group-check" value="${g}">
        </label>
      `).join('');

  showModal(`
    <h3 class="modal-title">📁 Masukkan ke Grup / Folder</h3>
    <p class="modal-subtitle">Pilih grup tujuan untuk <b>${count} tiket</b> yang dipilih:</p>
    <div style="font-size:0.82rem; color:#64748b; margin-bottom:8px;">Pilih satu atau lebih grup:</div>
    <div class="group-select-list" id="modal-batch-group-list" style="max-height: 180px; margin: 8px 0 12px;">
      ${itemsHtml}
    </div>
    <div class="group-create-row" style="margin-top: 6px;">
      <input type="text" id="input-modal-batch-group" placeholder="+ Tambah grup baru..." maxlength="30">
      <button type="button" id="btn-modal-batch-group" class="btn btn-secondary btn-sm" style="white-space: nowrap; padding: 6px 12px; font-size: 0.82rem;">Tambah</button>
    </div>
  `, {
    confirmLabel: '💾 Masukkan ke Grup',
    cancelLabel: 'Batal',
    onConfirm: async () => {
      const checkedGroups = Array.from(document.querySelectorAll('input[name="batch-group-check"]:checked'))
        .map(el => el.value.trim())
        .filter(Boolean);

      const pending = document.getElementById('input-modal-batch-group')?.value.trim();
      if (pending) {
        if (!customGroups.includes(pending)) {
          customGroups.push(pending);
          saveCustomGroups();
        }
        if (!checkedGroups.includes(pending)) checkedGroups.push(pending);
      }

      if (checkedGroups.length === 0) {
        showToast('⚠️ Tidak ada grup yang dipilih.', 'warning');
        return;
      }

      showLoading(true);
      for (const t of targetTickets) {
        const cur = Array.isArray(t.groups) ? t.groups : (typeof t.groups === 'string' && t.groups ? t.groups.split(',').map(s=>s.trim()).filter(Boolean) : []);
        const updated = Array.from(new Set([...cur, ...checkedGroups]));
        await saveTicketGroups(t.id, updated);
        updateCardInPlace(t);
      }
      showLoading(false);

      selectedBatchIds.clear();
      renderGroupTabs(customGroups, activeFilter.group, tickets);
      updateStats(getGroupTickets());
      updateBatchActionBar();
      renderCurrentView();
      showToast(`📁 ${count} tiket berhasil dimasukkan ke grup: ${checkedGroups.join(', ')}`, 'success');
    }
  });

  // Interaksi checklist di dalam modal
  const groupList = document.getElementById('modal-batch-group-list');
  const btnQuickAdd = document.getElementById('btn-modal-batch-group');
  const inputNewGroup = document.getElementById('input-modal-batch-group');

  const setupToggle = (item) => {
    item.addEventListener('change', () => {
      const chk = item.querySelector('input[type="checkbox"]');
      if (chk) item.classList.toggle('checked', chk.checked);
    });
  };

  document.querySelectorAll('#modal-batch-group-list .group-select-item').forEach(setupToggle);

  const addGroupItem = (name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (!customGroups.includes(trimmed)) {
      customGroups.push(trimmed);
      saveCustomGroups();
      renderGroupTabs(customGroups, activeFilter.group, tickets);
    }

    const emptyMsg = document.getElementById('modal-batch-group-empty');
    if (emptyMsg) emptyMsg.style.display = 'none';

    const existing = groupList?.querySelector(`.group-select-item[data-group-name="${trimmed}"]`);
    if (existing) {
      const chk = existing.querySelector('input[type="checkbox"]');
      if (chk) chk.checked = true;
      existing.classList.add('checked');
    } else if (groupList) {
      const label = document.createElement('label');
      label.className = 'group-select-item checked';
      label.dataset.groupName = trimmed;
      label.innerHTML = `<span>📁 <b>${trimmed}</b></span><input type="checkbox" name="batch-group-check" value="${trimmed}" checked>`;
      setupToggle(label);
      groupList.appendChild(label);
    }
    if (inputNewGroup) inputNewGroup.value = '';
  };

  if (btnQuickAdd && inputNewGroup) {
    btnQuickAdd.addEventListener('click', () => addGroupItem(inputNewGroup.value));
    inputNewGroup.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addGroupItem(inputNewGroup.value);
      }
    });
  }
}

async function handleBatchDelete() {
  if (selectedBatchIds.size === 0) return;
  const count = selectedBatchIds.size;

  showModal(`
    <h3 class="modal-title">🗑️ Hapus ${count} Tiket Terpilih?</h3>
    <p>Tiket yang dipilih akan dihapus secara permanen dari sistem.</p>
  `, {
    confirmLabel: `🗑️ Hapus ${count} Tiket`,
    dangerous: true,
    onConfirm: async () => {
      showLoading(true);
      const toDelete = [...selectedBatchIds];
      let successCount = 0;

      for (const id of toDelete) {
        try {
          await deleteTicket(id);
          tickets = tickets.filter(t => t.id !== id);
          removeCard(id);
          successCount++;
        } catch (err) {
          console.error(`Gagal menghapus tiket ${id}:`, err);
        }
      }

      selectedBatchIds.clear();
      showLoading(false);
      renderGroupTabs(customGroups, activeFilter.group, tickets);
      updateStats(getGroupTickets());
      updateBatchActionBar();
      renderCurrentView();
      showToast(`🗑️ ${successCount} dari ${count} tiket berhasil dihapus.`, 'info');
    }
  });
}

async function handleBatchUkur() {
  if (selectedBatchIds.size === 0) return;

  const targetTickets = tickets.filter(t => selectedBatchIds.has(t.id) && t.inet);
  if (targetTickets.length === 0) {
    showToast('⚠️ Tidak ada tiket ber-iNetID dari yang dipilih.', 'warning');
    return;
  }

  if (isMeasuringBatch) {
    if (confirm('Hentikan proses ukur massal tiket terpilih?')) {
      abortMeasuringBatch = true;
    }
    return;
  }

  showModal(`
    <h3 class="modal-title">📡 Ukur ${targetTickets.length} Tiket Terpilih</h3>
    <p>Akan mengukur redaman untuk <b>${targetTickets.length} tiket</b> terpilih secara berurutan.</p>
    <div class="ukur-info-box">
      Estimasi waktu: ~${Math.ceil((targetTickets.length * 20) / 60)} menit. Server i-booster Telkom ~15-25 detik/tiket.
    </div>
  `, {
    confirmLabel: `📡 Mulai Ukur (${targetTickets.length})`,
    cancelLabel: 'Batal',
    onConfirm: async () => {
      isMeasuringBatch = true;
      abortMeasuringBatch = false;

      const btnBatchUkur = document.getElementById('btn-batch-ukur');
      let successCount = 0;

      for (let i = 0; i < targetTickets.length; i++) {
        if (abortMeasuringBatch) break;
        const t = targetTickets[i];

        if (btnBatchUkur) {
          btnBatchUkur.innerHTML = `<span>⏳</span> ${i + 1}/${targetTickets.length} (Batal)`;
        }
        setUkurLoading(t.id, true);

        try {
          const result = await ukurRedaman(t.inet);
          if (result && isUserNotFoundMessage(result.message || result.error || result.result_text || '')) {
            const changes = {
              onu_sn:        null,
              onu_status:    'User internet tidak ditemukan',
              onu_rx:        null,
              olt_rx:        null,
              onu_rx_status: 'warn',
              olt_rx_status: 'warn',
              acs_status:    null,
              pcrf:          null,
              gpon:          null,
              result_text:   `⚠️ <b>User internet tidak ditemukan</b><br><small style="color:#64748b;">${result.message || 'Perangkat tidak ditemukan di server iBooster'}</small>`,
              redaman_at:    new Date().toISOString(),
            };
            const updated = await updateTicket(t.id, changes);
            const idx = tickets.findIndex(x => x.id === t.id);
            if (idx !== -1) tickets[idx] = updated;
            updateCardInPlace(updated);
            successCount++;
          } else if (result && result.success) {
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

      isMeasuringBatch = false;
      if (btnBatchUkur) {
        btnBatchUkur.innerHTML = `<span>📡</span> Ukur (<span id="batch-count-ukur">${targetTickets.length}</span>)`;
      }
      updateBatchActionBar();

      if (abortMeasuringBatch) {
        showToast(`⏹️ Pengukuran dihentikan (${successCount}/${targetTickets.length} selesai).`, 'warning');
      } else {
        showToast(`✅ Selesai mengukur ${successCount} dari ${targetTickets.length} tiket terpilih!`, 'success');
      }
    }
  });
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
          if (result && isUserNotFoundMessage(result.message || result.error || result.result_text || '')) {
            const changes = {
              onu_sn:        null,
              onu_status:    'User internet tidak ditemukan',
              onu_rx:        null,
              olt_rx:        null,
              onu_rx_status: 'warn',
              olt_rx_status: 'warn',
              acs_status:    null,
              pcrf:          null,
              gpon:          null,
              result_text:   `⚠️ <b>User internet tidak ditemukan</b><br><small style="color:#64748b;">${result.message || 'Perangkat tidak ditemukan di server iBooster'}</small>`,
              redaman_at:    new Date().toISOString(),
            };
            const updated = await updateTicket(t.id, changes);
            const idx = tickets.findIndex(x => x.id === t.id);
            if (idx !== -1) tickets[idx] = updated;
            updateCardInPlace(updated);
            successCount++;
          } else if (result && result.success) {
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
        btn.innerHTML = `<span>📡</span><span class="btn-label">Ukur <span class="hide-mobile">Semua </span>(<span id="ukur-all-count">${baseTargets.length}</span>)</span>`;
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
        selectedBatchIds.delete(ticket.id);
        removeCard(ticket.id);
        renderGroupTabs(customGroups, activeFilter.group, tickets);
        updateStats(getGroupTickets());
        updateBatchActionBar();
        updateUkurAllButton();
        showToast('🗑️ Tiket dihapus', 'info');
      } catch (err) {
        showToast('❌ Gagal menghapus', 'error');
      }
    },
  });
}

// ─── Action: Pin / Unpin Tiket ────────────────────────────────────────────────
async function handlePin(ticket) {
  if (!ticket) return;
  const currentPin = ticket.is_pinned || ticket.sort_order === 1;
  const newPin = !currentPin;
  ticket.is_pinned = newPin;
  ticket.sort_order = newPin ? 1 : 0;

  // Re-render segera untuk respon instan
  renderCurrentView();
  showToast(newPin ? '📌 Tiket dipin ke paling atas!' : '📍 Pin tiket dilepas', 'success');

  try {
    await updateTicket(ticket.id, { sort_order: newPin ? 1 : 0 });
  } catch (err) {
    console.error('Gagal simpan status pin ke Supabase:', err);
  }
}

// ─── Action: Buat Grup Baru ───────────────────────────────────────────────────
function handleCreateNewGroup() {
  const name = prompt('Masukkan nama grup/folder baru:\n(contoh: Sektor Ubud, Tim 1, Prioritas Pagi)');
  if (!name || !name.trim()) return;
  const trimmed = name.trim();
  if (customGroups.includes(trimmed)) {
    showToast(`⚠️ Grup "${trimmed}" sudah ada.`, 'warning');
    return;
  }
  customGroups.push(trimmed);
  saveCustomGroups();
  renderGroupTabs(customGroups, activeFilter.group, tickets);
  showToast(`✅ Grup "${trimmed}" berhasil dibuat!`, 'success');
}

// ─── Action: Hapus Grup ───────────────────────────────────────────────────────
function handleDeleteGroup(groupName) {
  if (!groupName) return;
  if (!confirm(`Hapus grup "${groupName}"?\n(Tiket di dalamnya tidak akan terhapus, hanya tag grup yang dilepas)`)) {
    return;
  }
  customGroups = customGroups.filter(g => g !== groupName);
  saveCustomGroups();

  // Bersihkan tag grup ini dari tiket-tiket terkait
  tickets.forEach(t => {
    if (Array.isArray(t.groups) && t.groups.includes(groupName)) {
      t.groups = t.groups.filter(g => g !== groupName);
      saveTicketGroups(t.id, t.groups);
    }
  });

  if (activeFilter.group === groupName) {
    activeFilter.group = 'all';
  }

  renderGroupTabs(customGroups, activeFilter.group, tickets);
  renderCurrentView();
  updateStats(getGroupTickets());
  updateUkurAllButton();
  showToast(`🗑️ Grup "${groupName}" telah dihapus.`, 'success');
}

// ─── Action: Kelola Grup Tiket ────────────────────────────────────────────────
async function handleManageGroups(ticket) {
  if (!ticket) return;

  showModal(modalManageGroups(ticket, customGroups), {
    confirmLabel: '💾 Simpan Grup',
    cancelLabel: 'Batal',
    onConfirm: async () => {
      const checked = Array.from(document.querySelectorAll('input[name="ticket-group-check"]:checked'))
        .map(el => el.value.trim())
        .filter(Boolean);

      await saveTicketGroups(ticket.id, checked);
      updateCardInPlace(ticket);
      renderGroupTabs(customGroups, activeFilter.group, tickets);
      updateStats(getGroupTickets());
      updateUkurAllButton();
      showToast('📁 Grup tiket berhasil diperbarui!', 'success');
    }
  });

  // Interaksi checklist di dalam modal
  const setupToggle = (item) => {
    item.addEventListener('change', () => {
      const chk = item.querySelector('input[type="checkbox"]');
      if (chk) item.classList.toggle('checked', chk.checked);
    });
  };

  document.querySelectorAll('.group-select-item').forEach(setupToggle);

  // Tombol tambah grup cepat di dalam modal
  const btnQuickAdd = document.getElementById('btn-quick-create-group');
  const inputNewGroup = document.getElementById('input-new-group-name');
  const groupList = document.getElementById('group-select-list');

  const addGroupItem = (name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (!customGroups.includes(trimmed)) {
      customGroups.push(trimmed);
      saveCustomGroups();
      renderGroupTabs(customGroups, activeFilter.group, tickets);
    }

    const existing = document.querySelector(`.group-select-item[data-group-name="${trimmed}"]`);
    if (existing) {
      const chk = existing.querySelector('input[type="checkbox"]');
      if (chk) chk.checked = true;
      existing.classList.add('checked');
    } else if (groupList) {
      const label = document.createElement('label');
      label.className = 'group-select-item checked';
      label.dataset.groupName = trimmed;
      label.innerHTML = `<span>📁 <b>${trimmed}</b></span><input type="checkbox" name="ticket-group-check" value="${trimmed}" checked>`;
      setupToggle(label);
      groupList.appendChild(label);
    }
    inputNewGroup.value = '';
  };

  if (btnQuickAdd && inputNewGroup) {
    btnQuickAdd.addEventListener('click', () => addGroupItem(inputNewGroup.value));
    inputNewGroup.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addGroupItem(inputNewGroup.value);
      }
    });
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
