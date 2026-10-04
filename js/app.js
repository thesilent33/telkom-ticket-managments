/**
 * app.js — Main controller: init, event handling, realtime, ukur semua, grup & pin
 */

import { parseTickets } from './parser.js';
import {
  fetchTickets,
  fetchDoneTickets,
  addTickets,
  updateTicket,
  deleteTicket,
  subscribeToTickets,
  unsubscribeTickets,
  fetchRemoteGroups,
  addRemoteGroup,
  deleteRemoteGroup,
  subscribeToGroupBroadcast,
  broadcastGroupEvent,
  signIn,
  signOut,
  getAuthSession,
  onAuthStateChange
} from './supabase-client.js';
import { ukurRedaman } from './lensa.js';
import {
  renderAllTickets, updateCardInPlace, removeCard, insertCard,
  setUkurLoading, showToast, showModal, showInputModal,
  modalAddTicket, modalDone, modalKendala, modalRekap, modalOdpCoordinates,
  modalManageGroups, renderGroupTabs,
  updateAllTimers, updateStats, getSavedTechnicians, saveTechnicianName,
  getCompactRedamanStatus, getDateRangeBounds, isTicketInDateRange,
} from './ui.js';
import { cleanOdpName, fetchNearestOdp, getGoogleMapsUrl, getGoogleMapsDirUrl, getWazeDirUrl } from './odp.js';

// ─── Filter State Storage ─────────────────────────────────────────────────────
function loadStoredFilterState() {
  try {
    const saved = JSON.parse(localStorage.getItem('ticket_active_filter') || '{}');
    return {
      status:     saved.status     || 'all',
      tier:       saved.tier       || 'all',
      optical:    saved.optical    || 'all',
      sort:       saved.sort       || 'ttr_desc',
      group:      saved.group      || 'all',
      search:     saved.search     || '',
      dateRange:  saved.dateRange  || 'today',
      customDate: saved.customDate || '',
    };
  } catch {
    return { status: 'all', tier: 'all', optical: 'all', sort: 'ttr_desc', group: 'all', search: '', dateRange: 'today', customDate: '' };
  }
}

function saveFilterState() {
  try {
    localStorage.setItem('ticket_active_filter', JSON.stringify({
      status:     activeFilter.status,
      tier:       activeFilter.tier,
      optical:    activeFilter.optical,
      sort:       activeFilter.sort,
      group:      activeFilter.group,
      search:     activeFilter.search,
      dateRange:  activeFilter.dateRange,
      customDate: activeFilter.customDate,
    }));
  } catch (e) {
    console.error('Gagal menyimpan status filter:', e);
  }
}

// ─── State ────────────────────────────────────────────────────────────────────
let tickets           = [];   // array of ticket objects (local cache)
let activeFilter      = loadStoredFilterState();
let customGroups      = [];   // array nama grup kustom
let isMeasuringAll    = false;
let abortMeasuringAll = false;

// Mode Ringkas / Compact vs Detail (Default: Collapse / Compact)
let isCompactMode       = localStorage.getItem('ticket_compact_mode') !== 'false';
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

// ─── Clipboard Copy Helper with Visual Feedback ──────────────────────────────
async function copyTextToClipboard(text, targetEl = null) {
  if (!text) return false;
  let copied = false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      copied = true;
    }
  } catch (e) {
    // Fallback below
  }

  if (!copied) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '-9999px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      copied = document.execCommand('copy');
      document.body.removeChild(ta);
    } catch (err) {
      console.warn('Fallback copy failed', err);
    }
  }

  if (targetEl) {
    targetEl.classList.remove('copy-flash');
    void targetEl.offsetWidth; // Reflow to re-trigger animation
    targetEl.classList.add('copy-flash');
    setTimeout(() => targetEl.classList.remove('copy-flash'), 400);
  }

  showToast(`📋 ${text} disalin!`, 'info', 1600);
  return copied;
}

// ─── Group Synchronization Helper ────────────────────────────────────────────
function registerNewGroup(name) {
  if (!name) return false;
  const trimmed = name.trim();
  if (!trimmed) return false;
  if (!customGroups.includes(trimmed)) {
    customGroups.push(trimmed);
    saveCustomGroups();
    addRemoteGroup(trimmed);
    broadcastGroupEvent({ type: 'create', name: trimmed });
    renderGroupTabs(customGroups, activeFilter.group, tickets);
    return true;
  }
  return false;
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
      if (activeFilter.optical === 'not_found') return opt.type === 'not_found';
      if (activeFilter.optical === 'unmeasured') return opt.type === 'unmeasured';
      return true;
    });
  }

  // Filter Tanggal / Periode
  const bounds = getDateRangeBounds(activeFilter.dateRange, activeFilter.customDate);
  if (bounds) {
    list = list.filter(t => isTicketInDateRange(t, bounds));
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

  const btnCopy = document.getElementById('btn-batch-copy');
  const countCopyEl = document.getElementById('batch-count-copy');
  if (countCopyEl) countCopyEl.textContent = countSelected;
  if (btnCopy) btnCopy.disabled = countSelected === 0;

  const btnDone = document.getElementById('btn-batch-done');
  const countDoneEl = document.getElementById('batch-count-done');
  if (countDoneEl) countDoneEl.textContent = countSelected;
  if (btnDone) btnDone.disabled = countSelected === 0;

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

// ─── On-demand archive loader ─────────────────────────────────────────────────
async function ensureDoneTicketsLoaded(dateRange, customDate) {
  const bounds = getDateRangeBounds(dateRange, customDate);
  showLoading(true);
  try {
    let startIso = null;
    let endIso = null;
    if (bounds) {
      startIso = bounds.start.toISOString();
      endIso = bounds.end.toISOString();
    }
    const fetched = await fetchDoneTickets(startIso, endIso);
    if (fetched && fetched.length > 0) {
      mergeGroupsIntoTickets(fetched);
      for (const t of fetched) {
        const existingIdx = tickets.findIndex(x => x.id === t.id);
        if (existingIdx !== -1) {
          tickets[existingIdx] = t;
        } else {
          tickets.push(t);
        }
      }
    }
  } catch (err) {
    console.error('Gagal mengambil arsip tiket:', err);
    showToast('⚠️ Gagal mengambil arsip tiket dari server.', 'error');
  } finally {
    showLoading(false);
  }
}

// ─── Auth State & Helpers ───────────────────────────────────────────────────
let currentUser   = null;
let timerInterval = null;

function updateAuthUI(user) {
  currentUser = user;
  const overlay = document.getElementById('auth-overlay');
  const btnLogout = document.getElementById('btn-header-logout');

  if (user) {
    if (overlay) overlay.style.display = 'none';
    if (btnLogout) {
      btnLogout.style.display = 'inline-flex';
      btnLogout.title = `Akun: ${user.email} (Klik untuk keluar)`;
    }
  } else {
    if (overlay) overlay.style.display = 'flex';
    if (btnLogout) btnLogout.style.display = 'none';
    clearAppData();
  }
}

function clearAppData() {
  unsubscribeTickets();
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  tickets = [];
  customGroups = [];
  renderGroupTabs([], 'all', []);
  renderCurrentView();
}

async function loadInitialData() {
  showLoading(true);
  try {
    const bounds = getDateRangeBounds(activeFilter.dateRange, activeFilter.customDate);
    const since = bounds ? bounds.start.toISOString() : null;
    tickets = await fetchTickets(since ? { since } : {});
    customGroups = loadStoredCustomGroups();

    // 1. Ambil grup dari tabel remote Supabase (jika tabel tersedia)
    const remoteGroups = await fetchRemoteGroups();
    if (Array.isArray(remoteGroups)) {
      remoteGroups.forEach(g => {
        if (!customGroups.includes(g)) customGroups.push(g);
      });
    }

    // 2. Ekstrak semua nama grup dari tiket yang ada di Supabase
    tickets.forEach(t => {
      const gList = Array.isArray(t.groups)
        ? t.groups
        : (typeof t.groups === 'string' && t.groups ? t.groups.split(',').map(s => s.trim()).filter(Boolean) : []);
      gList.forEach(g => {
        if (!customGroups.includes(g)) customGroups.push(g);
      });
    });

    saveCustomGroups();
    mergeGroupsIntoTickets(tickets);

    // Pastikan grup aktif masih ada di customGroups
    if (activeFilter.group !== 'all' && !customGroups.includes(activeFilter.group)) {
      activeFilter.group = 'all';
      saveFilterState();
    }

    renderGroupTabs(customGroups, activeFilter.group, tickets);
    renderCurrentView();
    updateStats(getGroupTickets(), activeFilter);
    updateUkurAllButton();
  } catch (e) {
    showToast('❌ Gagal memuat tiket dari Supabase. Cek izin akun & koneksi!', 'error');
    console.error(e);
  } finally {
    showLoading(false);
  }

  // Realtime subscription data tiket
  subscribeToTickets(handleRealtimeChange);

  // Realtime subscription broadcast perubahan grup antar perangkat
  subscribeToGroupBroadcast((payload) => {
    if (!payload) return;
    if (payload.type === 'create' && payload.name) {
      if (!customGroups.includes(payload.name)) {
        customGroups.push(payload.name);
        saveCustomGroups();
        renderGroupTabs(customGroups, activeFilter.group, tickets);
      }
    } else if (payload.type === 'delete' && payload.name) {
      customGroups = customGroups.filter(g => g !== payload.name);
      saveCustomGroups();
      if (activeFilter.group === payload.name) {
        activeFilter.group = 'all';
        saveFilterState();
      }
      renderGroupTabs(customGroups, activeFilter.group, tickets);
      renderCurrentView();
      updateStats(getGroupTickets(), activeFilter);
    }
  });

  // Timer: update SLA & waktu ukur setiap 15 detik
  if (!timerInterval) {
    timerInterval = setInterval(() => updateAllTimers(tickets), 15000);
  }
}

// ─── Setup Event Listeners (Once on load) ────────────────────────────────────
function setupEventListeners() {
  // Auth Form Submit
  const authForm = document.getElementById('auth-form');
  const authEmail = document.getElementById('auth-email');
  const authPassword = document.getElementById('auth-password');
  const authErrorMsg = document.getElementById('auth-error-msg');
  const btnAuthSubmit = document.getElementById('btn-auth-submit');
  const authSubmitLabel = document.getElementById('auth-submit-label');
  const btnTogglePw = document.getElementById('btn-toggle-password');

  if (btnTogglePw && authPassword) {
    btnTogglePw.addEventListener('click', () => {
      const isPassword = authPassword.type === 'password';
      authPassword.type = isPassword ? 'text' : 'password';
      btnTogglePw.textContent = isPassword ? '🙈' : '👁️';
    });
  }

  if (authForm) {
    authForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = authEmail?.value.trim();
      const password = authPassword?.value;

      if (!email || !password) {
        if (authErrorMsg) {
          authErrorMsg.textContent = 'Email dan password wajib diisi.';
          authErrorMsg.style.display = 'block';
        }
        return;
      }

      if (authErrorMsg) authErrorMsg.style.display = 'none';
      if (btnAuthSubmit) btnAuthSubmit.disabled = true;
      if (authSubmitLabel) authSubmitLabel.textContent = 'Memverifikasi...';

      try {
        const data = await signIn(email, password);
        if (authPassword) authPassword.value = '';
        updateAuthUI(data.user);
        showToast(`👋 Selamat datang!`, 'success');
        await loadInitialData();
      } catch (err) {
        console.error('Login error:', err);
        let msg = err.message || 'Gagal masuk. Cek email dan password.';
        if (msg.includes('Invalid login credentials')) {
          msg = 'Email atau password salah.';
        } else if (msg.includes('Email not confirmed')) {
          msg = 'Email belum dikonfirmasi di Supabase.';
        }
        if (authErrorMsg) {
          authErrorMsg.textContent = `⚠️ ${msg}`;
          authErrorMsg.style.display = 'block';
        }
      } finally {
        if (btnAuthSubmit) btnAuthSubmit.disabled = false;
        if (authSubmitLabel) authSubmitLabel.textContent = 'Masuk';
      }
    });
  }

  // Header Logout button
  const btnHeaderLogout = document.getElementById('btn-header-logout');
  if (btnHeaderLogout) {
    btnHeaderLogout.addEventListener('click', async () => {
      const email = currentUser?.email || 'Akun Anda';
      if (!confirm(`Keluar dari Ticket Manager (${email})?`)) return;

      try {
        await signOut();
        updateAuthUI(null);
        showToast('🚪 Berhasil keluar.', 'info');
      } catch (err) {
        console.error('Logout error:', err);
        showToast('⚠️ Gagal keluar dari server.', 'error');
      }
    });
  }

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

  // Autohide Sticky Header & Floating Actions saat scroll
  let lastScrollY = window.scrollY;
  let scrollTicking = false;

  window.addEventListener('scroll', () => {
    if (!scrollTicking) {
      window.requestAnimationFrame(() => {
        const currentScrollY = window.scrollY;
        const stickyNav = document.getElementById('sticky-nav');
        const floatingActions = document.getElementById('floating-actions');
        const btnBackToTop = document.getElementById('btn-back-to-top');

        const delta = currentScrollY - lastScrollY;

        // Sticky Nav & Floating Actions autohide (scroll down = hide, scroll up = show)
        if (currentScrollY > 60 && delta > 8) {
          stickyNav?.classList.add('nav-hidden');
          floatingActions?.classList.add('floating-hidden');
        } else if (delta < -8 || currentScrollY <= 25) {
          stickyNav?.classList.remove('nav-hidden');
          floatingActions?.classList.remove('floating-hidden');
        }

        // Tombol Kembali ke Atas: Muncul jika scroll > 250px
        if (currentScrollY > 250) {
          btnBackToTop?.classList.add('visible');
        } else {
          btnBackToTop?.classList.remove('visible');
        }

        lastScrollY = Math.max(0, currentScrollY);
        scrollTicking = false;
      });
      scrollTicking = true;
    }
  }, { passive: true });

  // Floating Back to top button
  const btnBackToTop = document.getElementById('btn-back-to-top');
  if (btnBackToTop) {
    btnBackToTop.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // Search input & clear button
  const inputSearch = document.getElementById('input-search');
  const btnClearSearch = document.getElementById('btn-clear-search');
  const headerSearchWrap = document.getElementById('header-search-wrap');
  if (inputSearch) {
    if (activeFilter.search) {
      inputSearch.value = activeFilter.search;
      if (btnClearSearch) btnClearSearch.style.display = 'inline-flex';
      if (headerSearchWrap) headerSearchWrap.classList.add('has-value');
    }

    inputSearch.addEventListener('input', (e) => {
      activeFilter.search = e.target.value;
      saveFilterState();
      if (btnClearSearch) {
        btnClearSearch.style.display = activeFilter.search ? 'inline-flex' : 'none';
      }
      if (headerSearchWrap) {
        headerSearchWrap.classList.toggle('has-value', Boolean(activeFilter.search));
      }
      renderCurrentView();
    });
  }
  if (btnClearSearch) {
    btnClearSearch.addEventListener('click', () => {
      if (inputSearch) inputSearch.value = '';
      activeFilter.search = '';
      saveFilterState();
      btnClearSearch.style.display = 'none';
      if (headerSearchWrap) {
        headerSearchWrap.classList.remove('has-value');
      }
      renderCurrentView();
    });
  }
  if (headerSearchWrap && inputSearch) {
    headerSearchWrap.addEventListener('click', (e) => {
      if (e.target !== btnClearSearch) {
        inputSearch.focus();
      }
    });
  }

  // Toggle Collapse / Expand All (Floating Detail Button)
  const btnToggleCompact = document.getElementById('btn-floating-detail') || document.getElementById('btn-toggle-compact');
  const iconCompactMode = document.getElementById('icon-compact-mode');
  const labelCompactMode = document.getElementById('label-compact-mode');

  // Set initial labels & active class based on restored isCompactMode
  if (labelCompactMode) labelCompactMode.textContent = isCompactMode ? 'Detail' : 'Ringkas';
  if (iconCompactMode) iconCompactMode.textContent = isCompactMode ? '📖' : '📁';
  if (btnToggleCompact) btnToggleCompact.classList.toggle('active', !isCompactMode);

  if (btnToggleCompact) {
    btnToggleCompact.addEventListener('click', () => {
      isCompactMode = !isCompactMode;
      localStorage.setItem('ticket_compact_mode', isCompactMode ? 'true' : 'false');
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

  // Floating Tambah Tiket button
  const btnFloatingAdd = document.getElementById('btn-floating-add');
  if (btnFloatingAdd) {
    btnFloatingAdd.addEventListener('click', handleAddTicket);
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

  // Batch Action Bar: Copy Tiket
  const btnBatchCopy = document.getElementById('btn-batch-copy');
  if (btnBatchCopy) {
    btnBatchCopy.addEventListener('click', handleBatchCopy);
  }

  // Batch Action Bar: Tandai Selesai
  const btnBatchDone = document.getElementById('btn-batch-done');
  if (btnBatchDone) {
    btnBatchDone.addEventListener('click', handleBatchDone);
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
        saveFilterState();
        renderGroupTabs(customGroups, activeFilter.group, tickets);
        renderCurrentView();
        updateStats(getGroupTickets());
        updateUkurAllButton();
      }
    });
  }

  // Filter buttons (Status)
  document.querySelectorAll('[data-filter-status]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filterStatus === activeFilter.status);
    btn.addEventListener('click', () => {
      activeFilter.status = btn.dataset.filterStatus;
      saveFilterState();
      document.querySelectorAll('[data-filter-status]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderCurrentView();
    });
  });

  // Filter buttons (Tier)
  document.querySelectorAll('[data-filter-tier]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filterTier === activeFilter.tier);
    btn.addEventListener('click', () => {
      activeFilter.tier = btn.dataset.filterTier;
      saveFilterState();
      document.querySelectorAll('[data-filter-tier]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderCurrentView();
    });
  });

  // Filter buttons (Optical Condition)
  document.querySelectorAll('[data-filter-optical]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filterOptical === activeFilter.optical);
    btn.addEventListener('click', () => {
      activeFilter.optical = btn.dataset.filterOptical;
      saveFilterState();
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
      saveFilterState();
      renderCurrentView();
    });
  }

  // Filter Periode / Tanggal dropdown
  const selectDateRange = document.getElementById('select-date-range');
  const inputCustomDate = document.getElementById('input-custom-date');
  if (selectDateRange) {
    selectDateRange.value = activeFilter.dateRange || 'today';
    if (inputCustomDate) {
      inputCustomDate.style.display = activeFilter.dateRange === 'custom' ? 'inline-block' : 'none';
      if (activeFilter.customDate) {
        inputCustomDate.value = activeFilter.customDate;
      }
    }

    selectDateRange.addEventListener('change', async (e) => {
      activeFilter.dateRange = e.target.value;
      if (inputCustomDate) {
        inputCustomDate.style.display = activeFilter.dateRange === 'custom' ? 'inline-block' : 'none';
        if (activeFilter.dateRange === 'custom') {
          if (!inputCustomDate.value) {
            const todayStr = new Date().toISOString().slice(0, 10);
            inputCustomDate.value = todayStr;
            activeFilter.customDate = todayStr;
          }
          inputCustomDate.focus();
        }
      }
      saveFilterState();
      await ensureDoneTicketsLoaded(activeFilter.dateRange, activeFilter.customDate);
      renderCurrentView();
      updateStats(getGroupTickets(), activeFilter);
      updateUkurAllButton();
    });
  }

  if (inputCustomDate) {
    inputCustomDate.addEventListener('change', async (e) => {
      activeFilter.customDate = e.target.value;
      saveFilterState();
      await ensureDoneTicketsLoaded('custom', activeFilter.customDate);
      renderCurrentView();
      updateStats(getGroupTickets(), activeFilter);
      updateUkurAllButton();
    });
  }

  // Tombol Ukur Semua
  const btnUkurAll = document.getElementById('btn-ukur-all');
  if (btnUkurAll) {
    btnUkurAll.addEventListener('click', handleUkurSemua);
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  setupEventListeners();

  try {
    const session = await getAuthSession();
    if (session?.user) {
      updateAuthUI(session.user);
      await loadInitialData();
    } else {
      updateAuthUI(null);
    }
  } catch (err) {
    console.error('Session retrieval error:', err);
    updateAuthUI(null);
  }

  onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_OUT') {
      updateAuthUI(null);
    } else if (event === 'SIGNED_IN' && session?.user && !currentUser) {
      updateAuthUI(session.user);
      await loadInitialData();
    }
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
    if (!tickets.find(t => t.id === newRow.id)) {
      mergeGroupsIntoTickets([newRow]);
      tickets.push(newRow);
      renderGroupTabs(customGroups, activeFilter.group, tickets);
      renderCurrentView();
      updateStats(getGroupTickets(), activeFilter);
      updateBatchActionBar();
    }
  } else if (eventType === 'UPDATE') {
    const idx = tickets.findIndex(t => t.id === newRow.id);
    if (idx !== -1) {
      newRow.groups = newRow.groups !== undefined ? newRow.groups : tickets[idx].groups;
      newRow.is_pinned = newRow.sort_order === 1 || tickets[idx].is_pinned;
      mergeGroupsIntoTickets([newRow]);
      tickets[idx] = newRow;
    } else {
      mergeGroupsIntoTickets([newRow]);
      tickets.push(newRow);
    }
    updateCardInPlace(newRow, isCardCollapsed(newRow.id), isBatchMode, selectedBatchIds.has(newRow.id));
    renderGroupTabs(customGroups, activeFilter.group, tickets);
    updateStats(getGroupTickets(), activeFilter);
    updateBatchActionBar();
    updateUkurAllButton();
  } else if (eventType === 'DELETE') {
    tickets = tickets.filter(t => t.id !== oldRow.id);
    selectedBatchIds.delete(oldRow.id);
    removeCard(oldRow.id);
    renderGroupTabs(customGroups, activeFilter.group, tickets);
    updateStats(getGroupTickets(), activeFilter);
    updateBatchActionBar();
    updateUkurAllButton();
  }
}

// ─── Action: Cek Koordinat ODP & ODP Terdekat ─────────────────────────────────
async function handleOdpCoordinates(ticket, rawOdp = '') {
  const odpTarget = rawOdp || ticket?.odp || '';
  const clean = cleanOdpName(odpTarget);
  if (!clean) {
    showToast('⚠️ Nama ODP kosong atau tidak valid', 'warning');
    return;
  }

  // Tampilkan modal awal dengan status loading
  showModal(modalOdpCoordinates({ odpName: odpTarget, cleanName: clean, isLoading: true }), {
    confirmLabel: 'Tutup',
    cancelLabel: null
  });

  try {
    const result = await fetchNearestOdp(clean);
    const modalBody = document.querySelector('#modal-box .modal-body');
    if (modalBody) {
      modalBody.innerHTML = modalOdpCoordinates({
        odpName: odpTarget,
        cleanName: clean,
        result,
        isLoading: false
      });
    }
  } catch (err) {
    console.error('Error fetching ODP coordinates:', err);
    const modalBody = document.querySelector('#modal-box .modal-body');
    if (modalBody) {
      modalBody.innerHTML = modalOdpCoordinates({
        odpName: odpTarget,
        cleanName: clean,
        isLoading: false,
        error: 'Gagal memuat koordinat: ' + err.message
      });
    }
  }
}

// ─── Event delegation ─────────────────────────────────────────────────────────
async function handleClick(e) {
  // Click-to-copy handler langsung saat disentuh/diklik
  const copyTarget = e.target.closest('.clickable-copy');
  if (copyTarget) {
    e.stopPropagation();
    const text = copyTarget.dataset.copy || copyTarget.textContent.replace(/^[👤📍📁🌐\s]+/, '').trim();
    if (text) {
      copyTextToClipboard(text, copyTarget);
    }
    return;
  }

  // Toggle rincian kartu (collapse / expand per card)
  const expandTarget = e.target.closest('[data-action="toggle-card-collapse"]');
  if (expandTarget) {
    const id = expandTarget.dataset.id;
    const card = expandTarget.closest('.ticket-card');
    if (!id || !card) return;

    const btnEl = card.querySelector('.btn-card-expand');

    if (isCompactMode) {
      if (expandedTicketIds.has(id)) {
        expandedTicketIds.delete(id);
        card.classList.add('is-collapsed');
        if (btnEl) {
          btnEl.textContent = '▼';
          btnEl.title = 'Lihat rincian';
        }
      } else {
        expandedTicketIds.add(id);
        card.classList.remove('is-collapsed');
        if (btnEl) {
          btnEl.textContent = '▲';
          btnEl.title = 'Sembunyikan rincian';
        }
      }
    } else {
      if (collapsedTicketIds.has(id)) {
        collapsedTicketIds.delete(id);
        card.classList.remove('is-collapsed');
        if (btnEl) {
          btnEl.textContent = '▲';
          btnEl.title = 'Sembunyikan rincian';
        }
      } else {
        collapsedTicketIds.add(id);
        card.classList.add('is-collapsed');
        if (btnEl) {
          btnEl.textContent = '▼';
          btnEl.title = 'Lihat rincian';
        }
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
    case 'odp-coords':    return handleOdpCoordinates(ticket, btn.dataset.odp);
  }
}

function handleInput(e) {
  // Live parse preview di modal tambah tiket
  if (e.target.id === 'input-paste') {
    updateParsePreview(e.target.value);
  }
}

// ─── Helper: Perbarui tiket lama jika tiket duplikat membawa info baru ────────
async function enrichExistingTicketIfPossible(existingTicket, newParsedTicket) {
  if (!existingTicket || !newParsedTicket) return false;
  const changes = {};

  if (!existingTicket.inet && newParsedTicket.inet) {
    changes.inet = newParsedTicket.inet;
  }
  if (!existingTicket.odp && newParsedTicket.odp) {
    changes.odp = newParsedTicket.odp;
  }
  if (!existingTicket.inc && newParsedTicket.inc) {
    changes.inc = newParsedTicket.inc;
  }
  if (!existingTicket.nama && newParsedTicket.nama) {
    changes.nama = newParsedTicket.nama;
  }
  if (!existingTicket.telp && newParsedTicket.telp) {
    changes.telp = newParsedTicket.telp;
  }
  if (!existingTicket.alamat && newParsedTicket.alamat) {
    changes.alamat = newParsedTicket.alamat;
  }
  if (!existingTicket.gangguan && newParsedTicket.gangguan) {
    changes.gangguan = newParsedTicket.gangguan;
  }
  if ((!existingTicket.tier || existingTicket.tier === 'REGULER') && newParsedTicket.tier && newParsedTicket.tier !== 'REGULER') {
    changes.tier = newParsedTicket.tier;
  }
  if (!existingTicket.reported_at && newParsedTicket.reported_at) {
    changes.reported_at = newParsedTicket.reported_at;
  }
  if (!existingTicket.sla_deadline && newParsedTicket.sla_deadline) {
    changes.sla_deadline = newParsedTicket.sla_deadline;
  }
  if (newParsedTicket.rest && (!existingTicket.rest || newParsedTicket.rest.length > existingTicket.rest.length)) {
    changes.rest = newParsedTicket.rest;
  }
  if (newParsedTicket.raw_input && (!existingTicket.raw_input || newParsedTicket.raw_input.length > existingTicket.raw_input.length)) {
    changes.raw_input = newParsedTicket.raw_input;
  }

  if (Object.keys(changes).length > 0) {
    try {
      const updated = await updateTicket(existingTicket.id, changes);
      Object.assign(existingTicket, updated || changes);
      updateCardInPlace(existingTicket);
      return true;
    } catch (err) {
      console.error('Gagal memperbarui data baru pada tiket lama:', err);
    }
  }
  return false;
}

// ─── Action: Tambah Tiket ─────────────────────────────────────────────────────
async function handleAddTicket() {
  const result = await showInputModal(modalAddTicket(customGroups, activeFilter.group), {
    confirmLabel: '✅ Tambah Tiket',
    getValues: () => {
      const raw = document.getElementById('input-paste')?.value ?? '';
      const pending = document.getElementById('input-modal-add-group')?.value.trim();
      if (pending) {
        registerNewGroup(pending);
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
        registerNewGroup(trimmed);

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
      duplicateTickets.push({ ticket: t, existingTicket: existing, label, status: existing.status });
    } else {
      validTickets.push(t);
    }
  }

  const selectedGroups = result.groups || [];

  // Jika semua tiket yang dimasukkan sudah ada di sistem
  if (validTickets.length === 0) {
    let updatedDupeGroupCount = 0;
    let enrichedCount = 0;

    // 1. Perbarui data tiket lama jika input duplikat membawa info baru (misal: nomor inet, ODP, dll)
    for (const dupe of duplicateTickets) {
      if (!dupe.existingTicket) continue;
      const enriched = await enrichExistingTicketIfPossible(dupe.existingTicket, dupe.ticket);
      if (enriched) enrichedCount++;
    }

    // 2. Masukkan ke grup jika grup dipilih
    if (selectedGroups.length > 0) {
      for (const dupe of duplicateTickets) {
        if (!dupe.existingTicket) continue;
        const currentGroups = Array.isArray(dupe.existingTicket.groups)
          ? [...dupe.existingTicket.groups]
          : (typeof dupe.existingTicket.groups === 'string' && dupe.existingTicket.groups
              ? dupe.existingTicket.groups.split(',').map(s => s.trim()).filter(Boolean)
              : []);

        let changed = false;
        for (const g of selectedGroups) {
          if (!currentGroups.includes(g)) {
            currentGroups.push(g);
            changed = true;
          }
        }
        if (changed) {
          await saveTicketGroups(dupe.existingTicket.id, currentGroups);
          updatedDupeGroupCount++;
        }
      }
    }

    if (enrichedCount > 0 || updatedDupeGroupCount > 0) {
      renderGroupTabs(customGroups, activeFilter.group, tickets);
      renderCurrentView();
      updateStats(getGroupTickets(), activeFilter);
      updateUkurAllButton();

      const msgs = [];
      if (enrichedCount > 0) msgs.push(`🔄 ${enrichedCount} tiket lama diperbarui (inet/ODP/info baru)`);
      if (updatedDupeGroupCount > 0) msgs.push(`📁 ${updatedDupeGroupCount} tiket masuk ke grup: ${selectedGroups.join(', ')}`);
      showToast(msgs.join('. ') + '.', 'success');
    } else if (selectedGroups.length > 0) {
      showToast(`⚠️ Tiket sudah ada di sistem dan sudah terdaftar di grup ${selectedGroups.join(', ')}.`, 'info');
    } else if (duplicateTickets.length === 1) {
      const dupe = duplicateTickets[0];
      showToast(`⚠️ Tiket ${dupe.label} sudah ada di sistem (Status: ${dupe.status})!`, 'warning');
    } else {
      const labels = duplicateTickets.map(d => d.label).slice(0, 3).join(', ');
      showToast(`⚠️ Semua tiket (${duplicateTickets.length}) sudah ada di sistem (${labels})!`, 'warning');
    }
    return;
  }

  try {
    if (selectedGroups.length > 0) {
      const groupStr = selectedGroups.join(',');
      validTickets.forEach(t => {
        t.groups = groupStr;
      });
    }

    const inserted = await addTickets(validTickets);
    if (inserted) {
      for (const t of inserted) {
        t.groups = [...selectedGroups];
        if (!tickets.find(x => x.id === t.id)) {
          tickets.push(t);
        }
        if (selectedGroups.length > 0) {
          await saveTicketGroups(t.id, selectedGroups);
        }
      }
    }

    // 1. Auto-enrich tiket lama yang duplikat dengan info baru
    let enrichedCount = 0;
    if (duplicateTickets.length > 0) {
      for (const dupe of duplicateTickets) {
        if (!dupe.existingTicket) continue;
        const enriched = await enrichExistingTicketIfPossible(dupe.existingTicket, dupe.ticket);
        if (enriched) enrichedCount++;
      }
    }

    // 2. Auto-merge grup ke tiket yang duplikat jika grup dipilih
    let updatedDupeGroupCount = 0;
    if (selectedGroups.length > 0 && duplicateTickets.length > 0) {
      for (const dupe of duplicateTickets) {
        if (!dupe.existingTicket) continue;
        const currentGroups = Array.isArray(dupe.existingTicket.groups)
          ? [...dupe.existingTicket.groups]
          : (typeof dupe.existingTicket.groups === 'string' && dupe.existingTicket.groups
              ? dupe.existingTicket.groups.split(',').map(s => s.trim()).filter(Boolean)
              : []);

        let changed = false;
        for (const g of selectedGroups) {
          if (!currentGroups.includes(g)) {
            currentGroups.push(g);
            changed = true;
          }
        }
        if (changed) {
          await saveTicketGroups(dupe.existingTicket.id, currentGroups);
          updatedDupeGroupCount++;
        }
      }
    }

    renderGroupTabs(customGroups, activeFilter.group, tickets);
    renderCurrentView();
    updateStats(getGroupTickets(), activeFilter);
    updateUkurAllButton();

    const groupNote = (selectedGroups.length > 0)
      ? ` (ke grup: ${selectedGroups.join(', ')})`
      : '';

    if (duplicateTickets.length > 0) {
      const notes = [`✅ ${validTickets.length} tiket baru ditambahkan${groupNote}`];
      if (enrichedCount > 0) notes.push(`🔄 ${enrichedCount} tiket lama diperbarui (inet/ODP/info baru)`);
      if (updatedDupeGroupCount > 0) notes.push(`📁 ${updatedDupeGroupCount} tiket lama otomatis masuk ke grup`);
      if (enrichedCount === 0 && updatedDupeGroupCount === 0) {
        const dupeLabels = duplicateTickets.map(d => d.label).join(', ');
        notes.push(`⚠️ ${duplicateTickets.length} tiket dilewati karena sudah ada: ${dupeLabels}`);
      }
      showToast(notes.join('. ') + '.', 'success');
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
      ${t.nama ? `<div class="preview-row"><span>Nama</span><span>${t.nama}</span></div>` : ''}
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

async function handleBatchCopy() {
  if (selectedBatchIds.size === 0) return;

  const selectedTickets = tickets.filter(t => selectedBatchIds.has(t.id));
  const count = selectedTickets.length;

  const FIELD_DEFS = [
    { key: 'inc',       label: '🎫 No. Tiket (INC)',    get: t => (t.inc || '').trim() },
    { key: 'inet',      label: '🌐 No. Internet/User',  get: t => (t.inet || '').trim() },
    { key: 'odp',       label: '📦 ODP',                get: t => (t.odp || '').trim() },
    { key: 'nama',      label: '👤 Nama Pelanggan',     get: t => (t.nama || '').trim() },
    { key: 'telp',      label: '📞 No. Telepon',        get: t => (t.telp || '').trim() },
    { key: 'alamat',    label: '🏠 Alamat',             get: t => (t.alamat || '').trim() },
    { key: 'optik',     label: '📡 Status Optik/Rx',    get: t => (t.onu_rx ? `${t.onu_status || 'ONLINE'} (${t.onu_rx} dBm)` : t.onu_status || '').trim() },
    { key: 'teknisi',   label: '👷 Teknisi',            get: t => (t.teknisi || '').trim() },
    { key: 'perbaikan', label: '🔧 Perbaikan/Kendala',  get: t => (t.perbaikan || t.kendala_text || '').trim() },
    { key: 'tier',      label: '💎 Tier',               get: t => (t.tier || 'REGULER').trim() },
  ];

  const SEPARATOR_MAP = {
    comma:   ',',
    tab:     '\t',
    pipe:    ' | ',
    space:   ' ',
    colon:   ':',
    newline: '\n',
  };

  let activeKeys = ['inc', 'inet', 'odp'];
  try {
    const stored = JSON.parse(localStorage.getItem('ticket_copy_fields'));
    if (Array.isArray(stored) && stored.length > 0) activeKeys = stored;
  } catch {}

  let activeSep = localStorage.getItem('ticket_copy_sep') || 'comma';

  const generateText = (keys, sepKey) => {
    if (!keys || keys.length === 0) return '(Pilih minimal satu kolom data di atas)';
    const sep = SEPARATOR_MAP[sepKey] ?? ',';

    return selectedTickets.map(t => {
      const rowVals = keys.map(k => {
        const def = FIELD_DEFS.find(d => d.key === k);
        return def ? def.get(t) : '';
      });
      return rowVals.join(sep);
    }).join('\n');
  };

  const fieldsHtml = FIELD_DEFS.map(d => {
    const isChecked = activeKeys.includes(d.key);
    return `
      <label class="copy-field-chip ${isChecked ? 'active' : ''}" data-field="${d.key}">
        <input type="checkbox" name="copy-field-opt" value="${d.key}" ${isChecked ? 'checked' : ''}>
        <span>${d.label}</span>
      </label>
    `;
  }).join('');

  showModal(`
    <h3 class="modal-title">📋 Salin Data Tiket (${count} Tiket)</h3>
    <p class="modal-subtitle">Bebas pilih kombinasi kolom data dan pemisah sesuai kebutuhan:</p>

    <!-- Preset Cepat -->
    <div class="copy-preset-row">
      <span class="copy-preset-label">⚡ Preset:</span>
      <button type="button" class="btn-copy-preset" data-preset="inc,inet,odp">Tiket, User, ODP</button>
      <button type="button" class="btn-copy-preset" data-preset="inc">Hanya Tiket</button>
      <button type="button" class="btn-copy-preset" data-preset="inc,inet">Tiket + User</button>
      <button type="button" class="btn-copy-preset" data-preset="inet,odp">User + ODP</button>
      <button type="button" class="btn-copy-preset" data-preset="inc,odp">Tiket + ODP</button>
      <button type="button" class="btn-copy-preset" data-preset="inc,inet,odp,nama,telp,alamat">Lengkap</button>
    </div>

    <!-- Pilihan Kolom Data -->
    <div class="copy-section-title">1. Centang Kolom Data yang Ingin Disalin:</div>
    <div class="copy-fields-grid" id="copy-fields-grid">
      ${fieldsHtml}
    </div>

    <!-- Pilihan Pemisah -->
    <div class="copy-section-title">2. Pilih Pemisah Antar Kolom:</div>
    <div class="copy-separators-row" id="copy-separators-row">
      <label class="copy-sep-chip ${activeSep === 'comma' ? 'active' : ''}">
        <input type="radio" name="copy-sep-opt" value="comma" ${activeSep === 'comma' ? 'checked' : ''}>
        <span>Koma ( <code>,</code> )</span>
      </label>
      <label class="copy-sep-chip ${activeSep === 'tab' ? 'active' : ''}">
        <input type="radio" name="copy-sep-opt" value="tab" ${activeSep === 'tab' ? 'checked' : ''}>
        <span>Tabulasi / Excel ( <code>⇥</code> )</span>
      </label>
      <label class="copy-sep-chip ${activeSep === 'pipe' ? 'active' : ''}">
        <input type="radio" name="copy-sep-opt" value="pipe" ${activeSep === 'pipe' ? 'checked' : ''}>
        <span>Garis Tegak ( <code>|</code> )</span>
      </label>
      <label class="copy-sep-chip ${activeSep === 'space' ? 'active' : ''}">
        <input type="radio" name="copy-sep-opt" value="space" ${activeSep === 'space' ? 'checked' : ''}>
        <span>Spasi ( <code> </code> )</span>
      </label>
      <label class="copy-sep-chip ${activeSep === 'colon' ? 'active' : ''}">
        <input type="radio" name="copy-sep-opt" value="colon" ${activeSep === 'colon' ? 'checked' : ''}>
        <span>Titik Dua ( <code>:</code> )</span>
      </label>
      <label class="copy-sep-chip ${activeSep === 'newline' ? 'active' : ''}">
        <input type="radio" name="copy-sep-opt" value="newline" ${activeSep === 'newline' ? 'checked' : ''}>
        <span>Baris Baru</span>
      </label>
    </div>

    <!-- Live Preview -->
    <div class="modal-section" style="margin-top: 10px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
        <label class="modal-label" style="margin:0; font-weight:600;">3. Preview Hasil Salin:</label>
        <span id="copy-preview-counter" style="font-size:0.72rem; color:#64748b;">${count} tiket</span>
      </div>
      <textarea id="copy-preview-text" class="modal-input" rows="4" readonly style="font-family:monospace; font-size:0.76rem; background:#f8fafc; color:#334155; resize:none; white-space:pre; word-break:break-all;"></textarea>
    </div>
  `, {
    confirmLabel: '📋 Salin ke Clipboard',
    cancelLabel: 'Batal',
    onConfirm: async () => {
      const textToCopy = generateText(activeKeys, activeSep);
      if (!textToCopy.trim() || activeKeys.length === 0) {
        showToast('⚠️ Pilih minimal satu kolom data untuk disalin.', 'warning');
        return;
      }
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(textToCopy);
        } else {
          const textArea = document.createElement('textarea');
          textArea.value = textToCopy;
          textArea.style.position = 'fixed';
          textArea.style.opacity = '0';
          document.body.appendChild(textArea);
          textArea.focus();
          textArea.select();
          document.execCommand('copy');
          document.body.removeChild(textArea);
        }
        showToast(`📋 Berhasil menyalin data ${count} tiket!`, 'success');
      } catch (err) {
        console.error('Gagal copy tiket:', err);
        showToast('❌ Gagal menyalin ke clipboard. Izin browser ditolak.', 'error');
      }
    }
  });

  setTimeout(() => {
    const previewEl = document.getElementById('copy-preview-text');
    const updatePreview = () => {
      if (previewEl) previewEl.value = generateText(activeKeys, activeSep);
      try {
        localStorage.setItem('ticket_copy_fields', JSON.stringify(activeKeys));
        localStorage.setItem('ticket_copy_sep', activeSep);
      } catch {}
    };

    updatePreview();

    // Checkbox toggles
    const fieldChips = document.querySelectorAll('#copy-fields-grid .copy-field-chip');
    fieldChips.forEach(chip => {
      const chk = chip.querySelector('input[type="checkbox"]');
      chip.addEventListener('click', (e) => {
        if (e.target !== chk) {
          chk.checked = !chk.checked;
        }
        chip.classList.toggle('active', chk.checked);

        activeKeys = Array.from(document.querySelectorAll('#copy-fields-grid input[name="copy-field-opt"]:checked'))
          .map(el => el.value);

        updatePreview();
      });
    });

    // Separator radio toggles
    const sepChips = document.querySelectorAll('#copy-separators-row .copy-sep-chip');
    sepChips.forEach(chip => {
      const rad = chip.querySelector('input[type="radio"]');
      chip.addEventListener('click', () => {
        rad.checked = true;
        sepChips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        activeSep = rad.value;
        updatePreview();
      });
    });

    // Preset buttons
    const presetBtns = document.querySelectorAll('.btn-copy-preset');
    presetBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const presetKeys = btn.dataset.preset.split(',');
        activeKeys = [...presetKeys];

        fieldChips.forEach(chip => {
          const chk = chip.querySelector('input[type="checkbox"]');
          const isMatched = activeKeys.includes(chk.value);
          chk.checked = isMatched;
          chip.classList.toggle('active', isMatched);
        });

        updatePreview();
      });
    });
  }, 50);
}

async function handleBatchDone() {
  if (selectedBatchIds.size === 0) return;
  const targetTickets = tickets.filter(t => selectedBatchIds.has(t.id));
  const count = targetTickets.length;
  const savedTechs = getSavedTechnicians();

  const sampleLabels = targetTickets.slice(0, 5).map(t => t.inc || t.inet || 'Tiket').join(', ') + (count > 5 ? ` +${count - 5} lainnya` : '');

  const result = await showInputModal(`
    <h3 class="modal-title">✅ Tandai ${count} Tiket Selesai</h3>
    <p class="modal-subtitle">Tiket terpilih: <b>${sampleLabels}</b></p>
    <div class="modal-section">
      <label class="modal-label">Perbaikan <span class="required">*</span></label>
      <input id="input-batch-perbaikan" class="modal-input" type="text"
        placeholder="cth: Ganti ONT / Perbaikan Dropcore / Selesai Massal" value="">
    </div>
    <div class="modal-section">
      <label class="modal-label">Penyebab <span class="optional">(opsional)</span></label>
      <input id="input-batch-penyebab" class="modal-input" type="text"
        placeholder="cth: Gangguan massal pulih / Redaman tinggi" value="">
    </div>
    <div class="modal-section">
      <label class="modal-label">Teknisi (Pilih atau Ketik Baru)</label>
      <input id="input-batch-teknisi" class="modal-input" type="text"
        list="teknisi-list-batch-done"
        placeholder="Pilih atau ketik nama teknisi"
        value="">
      <datalist id="teknisi-list-batch-done">
        ${savedTechs.map(t => `<option value="${t}">`).join('')}
      </datalist>
    </div>
  `, {
    confirmLabel: `✅ Selesaikan ${count} Tiket`,
    cancelLabel: 'Batal',
    getValues: () => ({
      perbaikan: document.getElementById('input-batch-perbaikan')?.value.trim() ?? '',
      penyebab:  document.getElementById('input-batch-penyebab')?.value.trim() ?? '',
      teknisi:   document.getElementById('input-batch-teknisi')?.value.trim() ?? '',
    }),
  });

  if (!result) return;
  if (!result.perbaikan) {
    showToast('⚠️ Isi dulu kolom Perbaikan!', 'warning');
    return;
  }

  if (result.teknisi) {
    saveTechnicianName(result.teknisi);
  }

  showLoading(true);
  let successCount = 0;
  for (const t of targetTickets) {
    try {
      const updated = await updateTicket(t.id, {
        status:       'done',
        perbaikan:    result.perbaikan,
        penyebab:     result.penyebab || null,
        teknisi:      result.teknisi || t.teknisi || null,
        kendala_text: null,
      });
      const idx = tickets.findIndex(x => x.id === t.id);
      if (idx !== -1) tickets[idx] = updated;
      updateCardInPlace(updated);
      successCount++;
    } catch (err) {
      console.error(`Gagal menyelesaikan tiket ${t.inc}:`, err);
    }
  }

  selectedBatchIds.clear();
  showLoading(false);
  setBatchMode(false);
  renderGroupTabs(customGroups, activeFilter.group, tickets);
  updateStats(getGroupTickets(), activeFilter);
  showToast(`✅ ${successCount} dari ${count} tiket berhasil ditandai Selesai!`, 'success');
}

async function handleBatchGroup() {
  if (selectedBatchIds.size === 0) return;
  const count = selectedBatchIds.size;
  const toAssignIds = [...selectedBatchIds];
  const targetTickets = tickets.filter(t => toAssignIds.includes(t.id));

  const getTicketGroups = (t) => Array.isArray(t.groups)
    ? t.groups
    : (typeof t.groups === 'string' && t.groups ? t.groups.split(',').map(s=>s.trim()).filter(Boolean) : []);

  const itemsHtml = customGroups.length === 0
    ? `<div id="modal-batch-group-empty" style="color: #94a3b8; font-size: 0.82rem; padding: 10px; text-align: center;">Belum ada grup yang dibuat. Ketik nama grup baru di bawah.</div>`
    : customGroups.map(g => {
        const countWithGroup = targetTickets.filter(t => getTicketGroups(t).includes(g)).length;
        const isChecked = countWithGroup > 0;
        let badge = '';
        if (countWithGroup === targetTickets.length && targetTickets.length > 1) {
          badge = `<small style="color: #10b981; font-weight: 600; font-size: 0.74rem; margin-left: 6px;">(Semua tiket)</small>`;
        } else if (countWithGroup > 0 && targetTickets.length > 1) {
          badge = `<small style="color: #f59e0b; font-weight: 600; font-size: 0.74rem; margin-left: 6px;">(${countWithGroup}/${targetTickets.length} tiket)</small>`;
        }

        return `
          <label class="group-select-item ${isChecked ? 'checked' : ''}" data-group-name="${g}">
            <span>📁 <b>${g}</b>${badge}</span>
            <input type="checkbox" name="batch-group-check" value="${g}" ${isChecked ? 'checked' : ''}>
          </label>
        `;
      }).join('');

  showModal(`
    <h3 class="modal-title">📁 Masukkan ke Grup / Folder</h3>
    <p class="modal-subtitle">Kelola grup untuk <b>${count} tiket</b> yang dipilih:</p>
    <div style="font-size:0.82rem; color:#64748b; margin-bottom:8px;">Pilih satu atau lebih grup:</div>
    <div class="group-select-list" id="modal-batch-group-list" style="max-height: 200px; margin: 8px 0 12px;">
      ${itemsHtml}
    </div>
    <div class="group-create-row" style="margin-top: 6px;">
      <input type="text" id="input-modal-batch-group" placeholder="+ Tambah grup baru..." maxlength="30">
      <button type="button" id="btn-modal-batch-group" class="btn btn-secondary btn-sm" style="white-space: nowrap; padding: 6px 12px; font-size: 0.82rem;">Tambah</button>
    </div>
  `, {
    confirmLabel: '💾 Simpan Grup',
    cancelLabel: 'Batal',
    onConfirm: async () => {
      const checkedGroups = Array.from(document.querySelectorAll('input[name="batch-group-check"]:checked'))
        .map(el => el.value.trim())
        .filter(Boolean);

      const pending = document.getElementById('input-modal-batch-group')?.value.trim();
      if (pending) {
        registerNewGroup(pending);
        if (!checkedGroups.includes(pending)) checkedGroups.push(pending);
      }

      showLoading(true);
      for (const t of targetTickets) {
        const cur = getTicketGroups(t);
        // Pertahankan tag non-custom (jika ada), sinkronkan customGroups dengan yang dicentang
        const updated = cur.filter(g => !customGroups.includes(g) || checkedGroups.includes(g));
        checkedGroups.forEach(g => {
          if (!updated.includes(g)) updated.push(g);
        });

        await saveTicketGroups(t.id, updated);
        updateCardInPlace(t);
      }
      showLoading(false);

      selectedBatchIds.clear();
      renderGroupTabs(customGroups, activeFilter.group, tickets);
      updateStats(getGroupTickets(), activeFilter);
      updateBatchActionBar();
      renderCurrentView();
      if (checkedGroups.length > 0) {
        showToast(`📁 Grup untuk ${count} tiket berhasil disimpan: ${checkedGroups.join(', ')}`, 'success');
      } else {
        showToast(`📁 Grup untuk ${count} tiket telah dikosongkan.`, 'info');
      }
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
    registerNewGroup(trimmed);

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
      updateStats(getGroupTickets(), activeFilter);
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
        updateStats(getGroupTickets(), activeFilter);
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
  registerNewGroup(trimmed);
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
  deleteRemoteGroup(groupName);
  broadcastGroupEvent({ type: 'delete', name: groupName });

  // Bersihkan tag grup ini dari tiket-tiket terkait
  tickets.forEach(t => {
    if (Array.isArray(t.groups) && t.groups.includes(groupName)) {
      t.groups = t.groups.filter(g => g !== groupName);
      saveTicketGroups(t.id, t.groups);
    }
  });

  if (activeFilter.group === groupName) {
    activeFilter.group = 'all';
    saveFilterState();
  }

  renderGroupTabs(customGroups, activeFilter.group, tickets);
  renderCurrentView();
  updateStats(getGroupTickets(), activeFilter);
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
      updateStats(getGroupTickets(), activeFilter);
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
    registerNewGroup(trimmed);

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
