// ── e-Patong API Helper ─────────────────────────────────────
// All backend requests go through this file.
// Base URL automatically uses same host as frontend (served by Express).

const API_BASE = '';  // same origin — Express serves both

// ── Timeout-protected fetch ──────────────────────────────────
// A plain fetch() can hang forever if the server never responds
// (e.g. a stuck DB query on the backend). That would leave pages
// stuck showing neither their content nor a login prompt. This
// wrapper guarantees every request either resolves or rejects
// within TIMEOUT_MS, so the UI can never get stuck blank.
const TIMEOUT_MS = 8000;

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Request to ${url} timed out after ${TIMEOUT_MS / 1000}s — is the server hanging?`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const api = {

  // ── Auth ──────────────────────────────────────────────────
  async getMe() {
    const res = await fetchWithTimeout(`${API_BASE}/api/auth/me`, { credentials: 'include' });
    return res.json();
  },

  async logout() {
    const res = await fetchWithTimeout(`${API_BASE}/api/auth/logout`, {
      method: 'POST', credentials: 'include'
    });
    return res.json();
  },

  // ── Scans ─────────────────────────────────────────────────
  async saveScan(payload) {
    const res = await fetchWithTimeout(`${API_BASE}/api/scan/save`, {
      method:      'POST',
      credentials: 'include',
      headers:     { 'Content-Type': 'application/json' },
      body:        JSON.stringify(payload),
    });
    return res.json();
  },

  // Ask the SERVER which level a scan is (high / medium / low).
  // We send only the model's top 2 guesses and their numbers — never the photo.
  async evaluateScan(payload) {
    const res = await fetchWithTimeout(`${API_BASE}/api/scan/evaluate`, {
      method:      'POST',
      credentials: 'include',
      headers:     { 'Content-Type': 'application/json' },
      body:        JSON.stringify(payload),
    });
    return res.json();
  },

  // MEDIUM scan: the user picked one of the two guesses.
  async confirmScan(payload) {
    const res = await fetchWithTimeout(`${API_BASE}/api/scan/confirm`, {
      method:      'POST',
      credentials: 'include',
      headers:     { 'Content-Type': 'application/json' },
      body:        JSON.stringify(payload),
    });
    return res.json();
  },

  // "Was this right?" — the user's answer about a finished scan.
  async sendScanFeedback(payload) {
    const res = await fetchWithTimeout(`${API_BASE}/api/scan/feedback`, {
      method:      'POST',
      credentials: 'include',
      headers:     { 'Content-Type': 'application/json' },
      body:        JSON.stringify(payload),
    });
    return res.json();
  },

  async getScanHistory() {
    const res = await fetchWithTimeout(`${API_BASE}/api/scan/history`, { credentials: 'include' });
    return res.json();
  },

  // ── Rewards ───────────────────────────────────────────────
  async getCatalog() {
    const res = await fetchWithTimeout(`${API_BASE}/api/rewards/catalog`, { credentials: 'include' });
    return res.json();
  },

  async redeemReward(catalogItemId) {
    const res = await fetchWithTimeout(`${API_BASE}/api/rewards/redeem`, {
      method:      'POST',
      credentials: 'include',
      headers:     { 'Content-Type': 'application/json' },
      body:        JSON.stringify({ catalog_item_id: catalogItemId }),
    });
    return res.json();
  },

  async getVouchers() {
    const res = await fetchWithTimeout(`${API_BASE}/api/rewards/vouchers`, { credentials: 'include' });
    return res.json();
  },

  async getPoints() {
    const res = await fetchWithTimeout(`${API_BASE}/api/rewards/points`, { credentials: 'include' });
    return res.json();
  },
};

// ── Toast notifications (global) ──────────────────────────────
function showToast(message, type = 'info', duration = 4000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  toast.textContent = `${icons[type] || ''} ${message}`;
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; }, duration - 300);
  setTimeout(() => toast.remove(), duration);
}

// ── Format date helper ─────────────────────────────────────────
function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}
function formatDateTime(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
