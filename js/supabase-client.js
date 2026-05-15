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

// Free preview: 5 random BUY picks, seeded by the most recent Monday's date.
// The same 5 stocks show all week; a new set rotates in each Monday.
async function freeSignals() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('signals').select('*').eq('rating', 'BUY')
    .order('confidence', { ascending: false });
  if (error || !data?.length) return [];

  // Seed = YYYYMMDD of the most recent Monday (stable Mon–Sun, new set each week)
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun … 6=Sat
  const monday = new Date(now);
  monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
  const seed = parseInt(monday.toISOString().slice(0, 10).replace(/-/g, ''), 10);

  // LCG seeded Fisher-Yates shuffle — deterministic for a given seed
  let s = seed >>> 0;
  const rng = () => { s = Math.imul(s, 1664525) + 1013904223 >>> 0; return s / 0x100000000; };
  const shuffled = [...data];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled.slice(0, 5);
}

async function allSignals(limit = 2000) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('signals')
    .select('*')
    .order('rating', { ascending: true })        // BUY before SELL
    .order('confidence', { ascending: false })
    .order('volatility', { ascending: true, nullsFirst: false }) // low vol wins ties
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
async function recentChanges(limit = 200) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('rating_changes')
    .select('*')
    .order('changed_at', { ascending: false })
    .limit(limit);
  if (error) { console.warn('recentChanges:', error); return []; }
  if (!data?.length) return [];
  // Enrich with company name + confidence from signals
  const tickers = [...new Set(data.map(r => r.ticker))];
  const { data: sigs } = await supabase
    .from('signals').select('ticker, company_name, confidence')
    .in('ticker', tickers);
  const sigMap = {};
  if (sigs) sigs.forEach(s => { sigMap[s.ticker] = s; });
  return data.map(r => ({ ...r, company_name: sigMap[r.ticker]?.company_name || r.ticker, confidence: sigMap[r.ticker]?.confidence ?? null }));
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
