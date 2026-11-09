// ============================================================
// e-Patong — Public numbers for the homepage
// GET /api/stats        (no login needed)
//
// Returns the same four numbers as Admin → Overview:
//   users, scans, vouchers, points given
// (plus "guest scans" and "vouchers used", which the Overview also shows)
//
// Safe to make public: these are only counts. Nothing personal.
//
// Because ANYONE can call this, the answer is kept for 30 seconds,
// so a crowd of visitors can't make the database count again and again.
// ============================================================
const express = require('express');
const { getOverviewStats } = require('../config/overviewStats');
const router = express.Router();

const CACHE_SECONDS = 30;
let cached = { at: 0, data: null };

router.get('/', async (req, res) => {
  try {
    const now = Date.now();
    if (!cached.data || now - cached.at > CACHE_SECONDS * 1000) {
      cached = { data: await getOverviewStats(), at: now };
    }
    res.set('Cache-Control', `public, max-age=${CACHE_SECONDS}`);
    res.json(cached.data);
  } catch (err) {
    console.error('Public stats error:', err);
    res.status(500).json({ error: 'Could not load the numbers.' });
  }
});

module.exports = router;
