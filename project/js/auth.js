// =====================================================================
// Allin Signal · Shared auth modal + sign-in button wiring
// Include AFTER supabase-client.js on any page with a "Sign in" button.
// =====================================================================

(function() {
  const css = `
    .auth-overlay {
      position: fixed; inset: 0; z-index: 200;
      background: oklch(0 0 0 / 0.6);
      backdrop-filter: blur(8px);
      display: none;
      align-items: center; justify-content: center;
      padding: 20px;
    }
    .auth-overlay.open { display: flex; }
    .auth-modal {
      width: 100%; max-width: 400px;
      background: var(--bg-1, #1f2126);
      border: 1px solid var(--line, #3a3d44);
      border-radius: 14px;
      padding: 28px;
      box-shadow: 0 30px 60px -10px oklch(0 0 0 / 0.5);
      color: var(--fg-0, #f5f5f5);
      font-family: 'Inter', system-ui, sans-serif;
    }
    .auth-modal h3 {
      margin: 0 0 6px;
      font-size: 22px; font-weight: 700; letter-spacing: -0.01em;
    }
    .auth-modal .sub { font-size: 13.5px; color: var(--fg-2, #999); margin-bottom: 20px; }
    .auth-tabs { display: flex; background: var(--bg-2, #2a2d33); border-radius: 8px; padding: 3px; margin-bottom: 18px; }
    .auth-tabs button { flex: 1; padding: 8px; border-radius: 6px; font-size: 13px; color: var(--fg-1, #bbb); border: 0; background: transparent; cursor: pointer; font-family: inherit; }
    .auth-tabs button.active { background: var(--bg-0, #14161a); color: var(--fg-0); }
    .auth-field { margin-bottom: 12px; }
    .auth-field label { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--fg-2); margin-bottom: 6px; font-weight: 600; }
    .auth-field input {
      width: 100%; padding: 10px 12px;
      background: var(--bg-2); border: 1px solid var(--line-soft, #2e3138);
      border-radius: 7px; color: var(--fg-0);
      font-family: inherit; font-size: 14px; outline: none;
    }
    .auth-field input:focus { border-color: var(--accent, #4aa0e6); }
    .auth-submit { width: 100%; padding: 11px; margin-top: 6px; border-radius: 8px; border: 0; background: var(--buy, #5cd690); color: var(--logo-fg, #14161a); font-weight: 600; font-size: 14px; cursor: pointer; font-family: inherit; }
    .auth-submit:disabled { opacity: 0.6; cursor: wait; }
    .auth-msg { font-size: 12px; margin-top: 12px; min-height: 16px; }
    .auth-msg.err { color: var(--sell, #f06a5e); }
    .auth-msg.ok { color: var(--buy, #5cd690); }
    .auth-foot { display: flex; justify-content: space-between; margin-top: 18px; font-size: 12px; color: var(--fg-2); }
    .auth-close { position: absolute; top: 14px; right: 14px; background: transparent; border: 0; color: var(--fg-2); width: 28px; height: 28px; border-radius: 6px; display: grid; place-items: center; cursor: pointer; }
    .auth-close:hover { background: var(--bg-2); color: var(--fg-0); }
    .auth-modal { position: relative; }
    .auth-not-configured {
      padding: 10px 12px; border-radius: 7px;
      background: oklch(0.55 0.18 75 / 0.15);
      border: 1px solid oklch(0.55 0.18 75 / 0.4);
      color: oklch(0.85 0.15 85);
      font-size: 12px; margin-bottom: 14px; line-height: 1.5;
    }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  const html = `
    <div class="auth-overlay" id="authOverlay" role="dialog" aria-modal="true">
      <div class="auth-modal">
        <button class="auth-close" id="authClose" aria-label="Close">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
        <h3 id="authTitle">Sign in to Allin Signal</h3>
        <div class="sub" id="authSub">Access your watchlist and member signals.</div>
        <div id="authNotConfigured" class="auth-not-configured" style="display:none">
          Supabase isn't configured yet. Edit <code>js/supabase-client.js</code> with your project URL + anon key, then reload.
        </div>
        <div class="auth-tabs">
          <button id="tabSignin" class="active" type="button">Sign in</button>
          <button id="tabSignup" type="button">Create account</button>
        </div>
        <form id="authForm">
          <div class="auth-field">
            <label for="authEmail">Email</label>
            <input id="authEmail" type="email" autocomplete="email" required />
          </div>
          <div class="auth-field">
            <label for="authPw">Password</label>
            <input id="authPw" type="password" autocomplete="current-password" minlength="6" required />
          </div>
          <button type="submit" class="auth-submit" id="authSubmit">Sign in</button>
          <div class="auth-msg" id="authMsg"></div>
        </form>
      </div>
    </div>
  `;
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  document.body.appendChild(wrap.firstElementChild);

  const $ = (id) => document.getElementById(id);
  const overlay = $('authOverlay');
  let mode = 'signin';

  function open() {
    overlay.classList.add('open');
    $('authNotConfigured').style.display = window.allin?.isConfigured ? 'none' : 'block';
    setTimeout(() => $('authEmail').focus(), 50);
  }
  function close() {
    overlay.classList.remove('open');
    $('authMsg').textContent = '';
  }
  function setMode(m) {
    mode = m;
    $('tabSignin').classList.toggle('active', m === 'signin');
    $('tabSignup').classList.toggle('active', m === 'signup');
    $('authTitle').textContent = m === 'signup' ? 'Create your account' : 'Sign in to Allin Signal';
    $('authSub').textContent = m === 'signup'
      ? 'Free to create. Subscribe later for full access.'
      : 'Access your watchlist and member signals.';
    $('authSubmit').textContent = m === 'signup' ? 'Create account' : 'Sign in';
    $('authPw').autocomplete = m === 'signup' ? 'new-password' : 'current-password';
  }

  $('authClose').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  $('tabSignin').addEventListener('click', () => setMode('signin'));
  $('tabSignup').addEventListener('click', () => setMode('signup'));

  $('authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('authEmail').value.trim();
    const pw = $('authPw').value;
    const msg = $('authMsg');
    const btn = $('authSubmit');
    msg.className = 'auth-msg';
    msg.textContent = '';
    if (!window.allin?.isConfigured) {
      msg.className = 'auth-msg err';
      msg.textContent = 'Supabase not configured.';
      return;
    }
    btn.disabled = true;
    btn.textContent = mode === 'signup' ? 'Creating…' : 'Signing in…';
    try {
      const fn = mode === 'signup' ? window.allin.signUp : window.allin.signIn;
      const { data, error } = await fn(email, pw);
      if (error) throw error;
      msg.className = 'auth-msg ok';
      msg.textContent = mode === 'signup'
        ? 'Check your email to confirm, then sign in.'
        : 'Signed in — refreshing…';
      if (mode === 'signin') setTimeout(() => location.reload(), 600);
    } catch (err) {
      msg.className = 'auth-msg err';
      msg.textContent = err.message || 'Something went wrong.';
    } finally {
      btn.disabled = false;
      btn.textContent = mode === 'signup' ? 'Create account' : 'Sign in';
    }
  });

  // Expose to global
  window.allinAuth = { open, close, setMode };

  // Auto-wire any element with [data-auth-trigger] or matching "Sign in" buttons
  function wireButtons() {
    document.querySelectorAll('[data-auth-trigger], .btn-ghost').forEach(b => {
      const t = (b.textContent || '').trim().toLowerCase();
      if (b.dataset.authTrigger !== undefined || t === 'sign in' || t === 'log in') {
        b.addEventListener('click', (e) => { e.preventDefault(); open(); });
      }
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireButtons);
  } else {
    wireButtons();
  }

  // Update "Sign in" → user email pill once signed in.
  async function reflectAuthState() {
    if (!window.allin?.isConfigured) return;
    const u = await window.allin.currentUser();
    if (!u) return;
    document.querySelectorAll('.btn-ghost').forEach(b => {
      const t = (b.textContent || '').trim().toLowerCase();
      if (t === 'sign in' || t === 'log in') {
        b.innerHTML = `<span style="opacity:0.7">●</span> ${u.email.split('@')[0]}`;
        b.onclick = async (e) => {
          e.preventDefault();
          if (confirm('Sign out?')) { await window.allin.signOut(); location.reload(); }
        };
      }
    });
  }
  window.addEventListener('allin:ready', reflectAuthState);
  if (window.allin) reflectAuthState();
})();
