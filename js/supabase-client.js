// =====================================================================
// Allin Signal · Supabase client
// ---------------------------------------------------------------------
// 1. Paste your project's URL + anon key below.
// 2. Include this file on any page that needs auth or data:
//    <script type="module" src="js/supabase-client.js"></script>
// 3. Then access `window.allin` from your page scripts.
// =====================================================================

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.0/+esm';

// ---------- CONFIG — paste your values here -------------------------
const SUPABASE_URL  = 'https://ojmbqmbiyjpokhspcjbs.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9qbWJxbWJpeWpwb2toc3BjamJzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwODg2MzEsImV4cCI6MjA5MzY2NDYzMX0._09_Y3dx5L1e85HR5jDI8y6bDY9hhBh2PgrjUOT1Phk';
// --------------------------------------------------------------------

const isConfigured =
  SUPABASE_URL && !SUPABASE_URL.includes('YOUR-PROJECT-REF') &&
  SUPABASE_ANON && !SUPABASE_ANON.includes('YOUR-ANON');

const supabase = isConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null;

// ----- Auth helpers --------------------------------------------------
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

// ----- Watchlist -----------------------------------------------------
async function getWatchlist() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('watchlist_items')
    .select('*, signal:signals(*)')
    .order('added_at', { ascending: false });
  if (error) { console.warn('getWatchlist:', error); return []; }
  return data || [];
}

async function addToWatchlist(ticker) {
  const u = await currentUser();
  if (!u) throw new Error('Not signed in');
  ticker = ticker.toUpperCase();
  const sig = await searchSignal(ticker);
  return supabase.from('watchlist_items').insert({
    user_id: u.id,
    ticker,
    added_price: sig?.price ?? null,
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
    .select('*, signal:signals(company_name)')
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
  topSignals, allSignals, searchSignal,
  getWatchlist, addToWatchlist, removeFromWatchlist, toggleAlerts,
  recentChanges,
};

// Tell other scripts the client is ready.
window.dispatchEvent(new Event('allin:ready'));
