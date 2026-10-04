/**
 * supabase-client.js — Supabase CRUD + Realtime subscription
 */

import CONFIG from './config.js';

let _supabase = null;

// ─── Init ─────────────────────────────────────────────────────────────────────
function getClient() {
  if (!_supabase) {
    _supabase = window.supabase.createClient(
      CONFIG.SUPABASE_URL,
      CONFIG.SUPABASE_ANON_KEY
    );
  }
  return _supabase;
}

// ─── Fetch tickets (ordered by sort_order, created_at) ───────────────────
async function fetchTickets(options = {}) {
  let query = getClient()
    .from('tickets')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (options.since) {
    query = query.or(`status.neq.done,updated_at.gte.${options.since},created_at.gte.${options.since}`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

// ─── Fetch done tickets by date range on-demand ──────────────────────────────
async function fetchDoneTickets(startDateIso, endDateIso) {
  let query = getClient()
    .from('tickets')
    .select('*')
    .eq('status', 'done')
    .order('updated_at', { ascending: false });

  if (startDateIso) {
    query = query.gte('updated_at', startDateIso);
  }
  if (endDateIso) {
    query = query.lte('updated_at', endDateIso);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

// ─── Add one or more tickets ─────────────────────────────────────────────────
async function addTickets(ticketsArray) {
  let { data, error } = await getClient()
    .from('tickets')
    .insert(ticketsArray)
    .select();

  // Fallback: Jika tabel di Supabase belum memiliki kolom nama
  if (error && (error.message?.includes('nama') || error.code === 'PGRST204')) {
    const sanitized = ticketsArray.map(t => {
      const copy = { ...t };
      delete copy.nama;
      return copy;
    });
    const retry = await getClient().from('tickets').insert(sanitized).select();
    if (retry.error) throw retry.error;
    return retry.data;
  }

  if (error) throw error;
  return data;
}

// ─── Update a ticket ─────────────────────────────────────────────────────────
async function updateTicket(id, changes) {
  let { data, error } = await getClient()
    .from('tickets')
    .update(changes)
    .eq('id', id)
    .select()
    .single();

  // Fallback: Jika update gagal karena kolom nama belum ada
  if (error && changes.nama && (error.message?.includes('nama') || error.code === 'PGRST204')) {
    const copy = { ...changes };
    delete copy.nama;
    const retry = await getClient().from('tickets').update(copy).eq('id', id).select().single();
    if (retry.error) throw retry.error;
    return retry.data;
  }

  if (error) throw error;
  return data;
}

// ─── Delete a ticket ─────────────────────────────────────────────────────────
async function deleteTicket(id) {
  const { error } = await getClient()
    .from('tickets')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

let _realtimeChannel = null;

// ─── Realtime subscription ────────────────────────────────────────────────────
// callback({ eventType: 'INSERT'|'UPDATE'|'DELETE', old, new })
function subscribeToTickets(callback) {
  if (_realtimeChannel) {
    getClient().removeChannel(_realtimeChannel);
  }
  _realtimeChannel = getClient()
    .channel('tickets-realtime')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'tickets' },
      (payload) => {
        callback({
          eventType: payload.eventType,
          old: payload.old,
          new: payload.new,
        });
      }
    )
    .subscribe();
  return _realtimeChannel;
}

function unsubscribeTickets() {
  if (_realtimeChannel) {
    getClient().removeChannel(_realtimeChannel);
    _realtimeChannel = null;
  }
}

// ─── Supabase Authentication ──────────────────────────────────────────────────
async function signIn(email, password) {
  const { data, error } = await getClient().auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw error;
  return data;
}

async function signOut() {
  unsubscribeTickets();
  const { error } = await getClient().auth.signOut();
  if (error) throw error;
}

async function getAuthSession() {
  const { data, error } = await getClient().auth.getSession();
  if (error) {
    console.warn('Error fetching session:', error);
    return null;
  }
  return data.session;
}

function onAuthStateChange(callback) {
  return getClient().auth.onAuthStateChange((event, session) => {
    callback(event, session);
  });
}

export {
  fetchTickets,
  fetchDoneTickets,
  addTickets,
  updateTicket,
  deleteTicket,
  subscribeToTickets,
  unsubscribeTickets,
  signIn,
  signOut,
  getAuthSession,
  onAuthStateChange,
};
