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

// ─── Fetch all tickets (ordered by sort_order, created_at) ───────────────────
async function fetchTickets() {
  const { data, error } = await getClient()
    .from('tickets')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data ?? [];
}

// ─── Add one or more tickets ─────────────────────────────────────────────────
async function addTickets(ticketsArray) {
  const { data, error } = await getClient()
    .from('tickets')
    .insert(ticketsArray)
    .select();

  if (error) throw error;
  return data;
}

// ─── Update a ticket ─────────────────────────────────────────────────────────
async function updateTicket(id, changes) {
  const { data, error } = await getClient()
    .from('tickets')
    .update(changes)
    .eq('id', id)
    .select()
    .single();

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

// ─── Realtime subscription ────────────────────────────────────────────────────
// callback({ eventType: 'INSERT'|'UPDATE'|'DELETE', old, new })
function subscribeToTickets(callback) {
  return getClient()
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
}

export { fetchTickets, addTickets, updateTicket, deleteTicket, subscribeToTickets };
