// ============================================================
// e-Patong — Homepage numbers
// Shows the same four numbers as Admin → Overview:
//   Users, Scans, Vouchers, Points given.
// They come from the public endpoint GET /api/stats (counts only).
//
// Needs api.js loaded first (for fetchWithTimeout and API_BASE).
// If the numbers can't be loaded, the page keeps showing "–".
// ============================================================

// 999 -> "999", 1234 -> "1.2K", 12500 -> "12.5K", 1500000 -> "1.5M"
// (the exact number is kept in the tooltip, so nothing is hidden)
const compactNumber = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const fullNumber    = new Intl.NumberFormat('en-PH');
const shortNumber   = (n) => (n < 1000 ? String(n) : compactNumber.format(n));

// What each box shows. `label` is the same wording as the Admin → Overview cards.
const HOME_STATS = {
  users:    { value: (s) => s.users,       label: ()  => 'Users · registered accounts' },
  scans:    { value: (s) => s.scans,       label: (s) => `Scans · ${fullNumber.format(s.guestScans)} by guests` },
  vouchers: { value: (s) => s.vouchers,    label: (s) => `Vouchers · ${fullNumber.format(s.vouchersUsed)} used` },
  points:   { value: (s) => s.pointsGiven, label: ()  => 'Points given · earned from scans' },
};

async function loadHomeStats() {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/stats`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const stats = await res.json();

    Object.entries(HOME_STATS).forEach(([name, item]) => {
      const box = document.querySelector(`[data-stat="${name}"]`);
      if (!box) return;
      const value = Number(item.value(stats));
      if (!Number.isFinite(value)) return;

      const num = box.querySelector('.hero-stat-num');
      num.textContent = shortNumber(value);          // textContent = safe
      num.title       = fullNumber.format(value);    // exact number on hover / long-press
      box.querySelector('.hero-stat-label').textContent = item.label(stats);
    });
  } catch (err) {
    // Leave the "–" placeholders. The rest of the homepage is not affected.
    console.warn('[e-Patong] Could not load the homepage numbers:', err.message);
  }
}

document.addEventListener('DOMContentLoaded', loadHomeStats);
