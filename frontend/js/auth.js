// ── e-Patong Auth Manager ──────────────────────────────────────
// Loaded on every page. Manages user state, navbar rendering,
// nav-link visibility, page gating for logged-in-only pages,
// and login-CTA swapping.
console.log('[e-Patong] auth.js loaded — build 2026-10-18-v4 (admin link)');

let currentUser = null;

async function initAuth() {
  try {
    const data = await api.getMe();
    currentUser = data && data.user ? data.user : null;
    window.__epatongConnectionOK = true;
  } catch (e) {
    console.error('[e-Patong] Auth check failed — is the Node/Express server running on this URL?', e);
    currentUser = null;
    window.__epatongConnectionOK = false;
  }
  renderNavAuth();
  updateNavLinkVisibility();
  replaceLoginCTAs();
  return currentUser;
}

function renderNavAuth() {
  const authContainer = document.getElementById('nav-auth');
  if (!authContainer) return;

  if (currentUser) {
    authContainer.innerHTML = `
      <div class="user-pill">
        ${currentUser.avatar
          ? `<img src="${currentUser.avatar}" alt="${currentUser.name}">`
          : `<div style="width:28px;height:28px;border-radius:50%;background:var(--accent);color:var(--bg);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:0.8rem">${currentUser.name[0]}</div>`
        }
        <span>${currentUser.name.split(' ')[0]}</span>
        <span class="points-badge">⭐ ${(currentUser.points || 0).toLocaleString()} pts</span>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="handleLogout()">Logout</button>
    `;
  } else {
    authContainer.innerHTML = `
      <a href="/api/auth/google" class="btn btn-google btn-sm">
        <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
        Sign in with Google
      </a>
    `;
  }
}

// ── Show/hide nav links that require login (Dashboard, Rewards) ─
// Any nav link tagged class="nav-auth-only" is hidden by default
// (see style.css) and only gets .is-visible once we've confirmed
// the person is actually signed in — so guests never see it flash.
function updateNavLinkVisibility() {
  document.querySelectorAll('.nav-auth-only').forEach(link => {
    link.classList.toggle('is-visible', !!currentUser);
  });

  // ── Admin link ───────────────────────────────────────────────
  // This link is CREATED here only when the signed-in user is an admin.
  // For guests and normal users it does not exist in the page at all.
  // (Hiding a link is only for looks — the server still checks the role.)
  const navLinks  = document.getElementById('nav-links');
  const adminLink = document.getElementById('nav-admin-link');
  const isAdmin   = !!(currentUser && currentUser.role === 'admin');

  if (isAdmin && navLinks && !adminLink) {
    const a = document.createElement('a');
    a.id          = 'nav-admin-link';
    a.href        = '/admin/';
    a.textContent = '🛠️ Admin';
    if (window.location.pathname.startsWith('/admin')) a.classList.add('active');
    navLinks.appendChild(a);
  } else if (!isAdmin && adminLink) {
    adminLink.remove();
  }
}

async function handleLogout() {
  try {
    const result = await api.logout();
    if (!result || !result.success) throw new Error('Server did not confirm logout');
    currentUser = null;
    showToast('Logged out successfully.', 'info');
    // replace() (not href) so the Back button can't return to a
    // logged-in page that is still sitting in the browser cache.
    setTimeout(() => { window.location.replace('/'); }, 800);
  } catch (e) {
    showToast('Logout failed. Please try again.', 'error');
  }
}

// ── Gate a page so its content only shows when logged in ───────
// Looks for #page-content (the real content) and #login-gate
// (the "please log in" panel). Shows exactly one of the two.
// Defensive by design: if anything above throws unexpectedly,
// we still fall back to showing the login gate rather than
// leaving the page blank.
async function gatePage() {
  const content = document.getElementById('page-content');
  const gate    = document.getElementById('login-gate');
  const loading = document.getElementById('auth-loading');
  let user = null;

  try {
    user = await initAuth();
  } catch (e) {
    console.error('[e-Patong] gatePage() failed, defaulting to login gate:', e);
    user = null;
  }

  // The auth check has now settled one way or another — the loading
  // spinner's job is done, regardless of outcome.
  if (loading) loading.classList.add('hidden');

  if (user) {
    if (gate)    gate.classList.add('hidden');
    if (content) content.classList.remove('hidden');
  } else {
    if (content) content.classList.add('hidden');
    if (gate) {
      gate.classList.remove('hidden');
      // If we couldn't even reach the server, say so plainly instead
      // of implying the person just needs to log in.
      if (window.__epatongConnectionOK === false) {
        const msgEl = gate.querySelector('[data-gate-message]');
        if (msgEl) {
          msgEl.innerHTML = `⚠️ Couldn't reach the e-Patong server. Make sure you're viewing this
            page through <code>http://localhost:3000</code> (started via <code>npm run dev</code>
            in the backend folder) — not by opening the file directly or through XAMPP's Apache.`;
          msgEl.closest('.container')?.querySelector('.btn-google')?.classList.add('hidden');
        }
      }
    }
  }
  return user;
}

// ── Replace any "please log in" CTAs with a logged-in notice ───
// Any element with class="login-cta" gets swapped out once we know
// the person is already signed in, so they never see a stale
// "Sign in with Google" prompt while already authenticated.
function replaceLoginCTAs() {
  const ctas = document.querySelectorAll('.login-cta');
  if (!ctas.length) return;

  ctas.forEach(el => {
    if (currentUser) {
      const label = el.dataset.loggedInText || "You're already logged in ✅";
      const href  = el.dataset.loggedInHref;
      el.outerHTML = href
        ? `<a href="${href}" class="btn btn-primary login-cta-done">${label}</a>`
        : `<div class="alert alert-success" style="display:inline-flex">${label}</div>`;
    }
  });
}

// Navbar hamburger toggle + active link highlighting
document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('nav-toggle');
  const links  = document.getElementById('nav-links');
  if (toggle && links) {
    toggle.addEventListener('click', () => links.classList.toggle('open'));
  }

  const currentPath = window.location.pathname;
  document.querySelectorAll('.navbar-links a').forEach(link => {
    if (link.getAttribute('href') === currentPath) {
      link.classList.add('active');
    }
  });
});
