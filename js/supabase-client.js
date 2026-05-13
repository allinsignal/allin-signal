// =====================================================================
// Allin Signal · Supabase client
// =====================================================================

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.0/+esm';

const SUPABASE_URL  = 'https://ojmbqmbiyjpokhspcjbs.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9qbWJxbWJpeWpwb2toc3BjamJzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwODg2MzEsImV4cCI6MjA5MzY2NDYzMX0._09_Y3dx5L1e85HR5jDI8y6bDY9hhBh2PgrjUOT1Phk';

const isConfigured =
  SUPABASE_URL && !SUPABASE_URL.includes('YOUR-PROJECT-REF') &&
  SUPABASE_ANON && !SUPABASE_ANON.includes('YOUR-ANON');

const supabase = isConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null;

// ----- Auth ----------------------------------------------------------
async function signUp(email, password) {
  return supabase.auth.signUp({ email, password });
}
async function signIn(email, password) {
  return supabase.auth.signInWithPassword({ email, password });
}
async function signOut() {
  return supabase.auth.signOut();
}
async function currentUser() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data?.user || null;
}
async function currentProfile() {
  const u = await currentUser();
  if (!u) return null;
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', u.id)
    .single();
  return data;
}

// ----- Signals -------------------------------------------------------
async function topSignals(limit = 10) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('signals')
    .select('*')
    .eq('is_top10', true)
    .order('rating', { ascending: true })
    .order('confidence', { ascending: false })
    .limit(limit);
  if (error) { console.warn('topSignals:', error); return []; }
  return data || [];
}

// Free preview: top 2 BEST picks + ranks #11–#15 (skips the subscriber-only #3–#10).
async function freeSignals() {
  if (!supabase) return [];
  const [top2res, mid5res] = await Promise.all([
    supabase.from('signals').select('*').eq('rating', 'BUY')
      .order('confidence', { ascending: false }).limit(2),
    supabase.from('signals').select('*').eq('rating', 'BUY')
      .order('confidence', { ascending: false }).range(10, 14),
  ]);
  const top2 = (top2res.data || []).map(r => ({ ...r, isBest: true }));
  const mid5 = (mid5res.data || []).map(r => ({ ...r, isBest: false }));
  return [...top2, ...mid5];
}

async function allSignals(limit = 500) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('signals')
    .select('*')
    .order('confidence', { ascending: false })
    .limit(limit);
  if (error) { console.warn('allSignals:', error); return []; }
  return data || [];
}

async function searchSignal(ticker) {
  if (!supabase) return null;
  const { data } = await supabase
    .from('signals')
    .select('*')
    .eq('ticker', ticker.toUpperCase())
    .maybeSingle();
  return data;
}

// ----- Watchlists ----------------------------------------------------
async function getWatchlists() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('watchlists')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) { console.warn('getWatchlists:', error); return []; }
  return data || [];
}

async function createWatchlist(name) {
  const u = await currentUser();
  if (!u) throw new Error('Not signed in');
  const { data, error } = await supabase
    .from('watchlists')
    .insert({ user_id: u.id, name })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function deleteWatchlist(id) {
  return supabase.from('watchlists').delete().eq('id', id);
}

async function renameWatchlist(id, name) {
  return supabase.from('watchlists').update({ name }).eq('id', id);
}

// ----- Watchlist items -----------------------------------------------
async function getWatchlistItems(watchlistId = null) {
  if (!supabase) return [];

  let query = supabase
    .from('watchlist_items')
    .select('*')
    .order('added_at', { ascending: false });
  if (watchlistId) query = query.eq('watchlist_id', watchlistId);

  const { data: items, error } = await query;
  if (error) { console.warn('getWatchlistItems:', error); return []; }
  if (!items?.length) return [];

  // Fetch signal data separately to avoid FK dependency
  const tickers = [...new Set(items.map(i => i.ticker))];
  const { data: signals } = await supabase
    .from('signals')
    .select('*')
    .in('ticker', tickers);

  const sigMap = Object.fromEntries((signals || []).map(s => [s.ticker, s]));
  return items.map(item => ({ ...item, signal: sigMap[item.ticker] || null }));
}

async function addToWatchlist(ticker, watchlistId = null) {
  const u = await currentUser();
  if (!u) throw new Error('Not signed in');
  ticker = ticker.toUpperCase();
  const sig = await searchSignal(ticker);
  return supabase.from('watchlist_items').insert({
    user_id:      u.id,
    ticker,
    watchlist_id: watchlistId,
    added_price:  sig?.price ?? null,
  });
}

async function removeFromWatchlist(id) {
  return supabase.from('watchlist_items').delete().eq('id', id);
}

async function toggleAlerts(id, enabled) {
  return supabase.from('watchlist_items').update({ alerts_enabled: enabled }).eq('id', id);
}

// ----- Rating changes feed -------------------------------------------
async function recentChanges(limit = 20) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('rating_changes')
    .select('*')
    .order('changed_at', { ascending: false })
    .limit(limit);
  if (error) { console.warn('recentChanges:', error); return []; }
  return data || [];
}

// ----- Expose globally -----------------------------------------------
window.allin = {
  supabase,
  isConfigured,
  signUp, signIn, signOut, currentUser, currentProfile,
  topSignals, freeSignals, allSignals, searchSignal,
  getWatchlists, createWatchlist, deleteWatchlist, renameWatchlist,
  getWatchlistItems, addToWatchlist, removeFromWatchlist, toggleAlerts,
  recentChanges,
};

window.dispatchEvent(new Event('allin:ready'));
