// ============================================================
// e-Patong — Confidence levels (HIGH / MEDIUM / LOW)
//
// ONE place that knows the rule. Used by routes/scan.js (to decide
// what a scan is worth) and routes/admin.js (to change the cutoffs).
//
// The rule:
//     confidence >= HIGH cutoff                  -> 'high'
//     LOW cutoff <= confidence < HIGH cutoff     -> 'medium'
//     confidence <  LOW cutoff                   -> 'low'
//
// The two cutoffs live in the `settings` table (NOT in the code), so the
// admin can change them from the admin page.
// ============================================================
const db = require('./db');

const SETTING_KEYS = {
  low:  'confidence_low_cutoff',
  high: 'confidence_high_cutoff',
};

// LAST-RESORT numbers. They are used ONLY if the two rows in the `settings`
// table are missing or broken, so the server never has to guess. A warning
// is printed in the server window whenever this happens.
const SAFETY_NET_CUTOFFS = { low: 0.60, high: 0.85 };

// Turn "0.6" / 0.6 into a number rounded to 4 decimals. Anything else -> null.
function readCutoff(value) {
  let n = null;
  if (typeof value === 'number') n = value;
  else if (typeof value === 'string' && value.trim() !== '') n = Number(value);
  if (n === null || !Number.isFinite(n)) return null;
  // At most 4 decimals (the database column keeps 4)
  if (Math.abs(n * 10000 - Math.round(n * 10000)) > 1e-6) return null;
  return Math.round(n * 10000) / 10000;
}

// Check a pair of cutoffs. Returns { errors: [...], low, high }.
//   - both must be numbers between 0 and 1  (0 is not allowed, 1 is)
//   - LOW must be smaller than HIGH
function validateCutoffs(lowRaw, highRaw) {
  const errors = [];
  const low  = readCutoff(lowRaw);
  const high = readCutoff(highRaw);

  if (low === null || low <= 0 || low > 1) {
    errors.push('LOW cutoff must be a number above 0 and up to 1 (for example 0.60 for 60%).');
  }
  if (high === null || high <= 0 || high > 1) {
    errors.push('HIGH cutoff must be a number above 0 and up to 1 (for example 0.85 for 85%).');
  }
  if (errors.length === 0 && low >= high) {
    errors.push('LOW cutoff must be smaller than HIGH cutoff.');
  }
  return { errors, low, high };
}

// Read the cutoffs from the database (safe query, no user text inside).
async function getCutoffs() {
  try {
    const [rows] = await db.query(
      'SELECT setting_key, setting_value FROM settings WHERE setting_key IN (?, ?)',
      [SETTING_KEYS.low, SETTING_KEYS.high]
    );
    const found = {};
    rows.forEach((r) => { found[r.setting_key] = r.setting_value; });

    const check = validateCutoffs(found[SETTING_KEYS.low], found[SETTING_KEYS.high]);
    if (check.errors.length === 0) return { low: check.low, high: check.high };

    console.warn('⚠ Confidence cutoffs in `settings` are missing or invalid — using safety-net values.');
  } catch (err) {
    console.error('⚠ Could not read confidence cutoffs — using safety-net values:', err.message);
  }
  return { ...SAFETY_NET_CUTOFFS };
}

// The rule itself. `confidence` is a number from 0 to 1.
function decideLevel(confidence, cutoffs) {
  if (confidence >= cutoffs.high) return 'high';
  if (confidence >= cutoffs.low)  return 'medium';
  return 'low';
}

module.exports = { SETTING_KEYS, SAFETY_NET_CUTOFFS, readCutoff, validateCutoffs, getCutoffs, decideLevel };
