const crypto   = require('crypto');
const express  = require('express');
const db       = require('../config/db');
const { optionalAuth, requireAuth } = require('../middleware/authMiddleware');
const { getCutoffs, decideLevel }   = require('../config/confidence');
const router   = express.Router();

// ============================================================
// HOW A SCAN WORKS NOW (3 levels) — read this first
//
//  The model runs in the browser and finds its top 2 guesses.
//  The browser sends ONLY: the 2 category names + 2 confidence numbers.
//  (No photo is ever sent or stored.)
//
//  1) POST /api/scan/evaluate   "server, what level is this?"
//        HIGH   -> { level:'high' }            nothing saved yet
//        MEDIUM -> saved (0 points), returns a claim ticket (scan_ref)
//        LOW    -> saved (0 points)
//  2) HIGH   : user clicks Save   -> POST /api/scan/save     (points)
//     MEDIUM : user picks a guess -> POST /api/scan/confirm  (points)
//     LOW    : nothing more. LOW never earns points.
//
//  The SERVER always decides the level, from the numbers + the cutoffs
//  in the `settings` table. A "level" sent by the browser is never read.
//
//  Also decided by the SERVER (never trusted from the browser):
//    - the usability label (from the user's 3 answers, using the shared
//      rule file frontend/js/condition-rules.js)
//    - the peso range for that condition
//
//  After a scan is finished the user may say "Was this right?"
//  -> POST /api/scan/feedback (uses the same claim ticket).
//
//  Demo mode (scan page opened with ?demo=1): the browser sends demo:true.
//  The server then only answers with the level. NOTHING is saved and no
//  points are given. (A request can only ask for LESS, never for more.)
// ============================================================

// ── BACKUP e-waste values (used only if the database has no row) ─
// The real, editable numbers live in the `ewaste_categories` table
// and are changed by the admin. This object is only a safety net, so
// scanning keeps working even if that table is missing or empty.
const EWASTE_DATA = {
  'Mobile Phone':      { points: 50,  scrapMin: 50,  scrapMax: 200 },
  'Laptop':            { points: 150, scrapMin: 200, scrapMax: 800 },
  'Tablet':            { points: 80,  scrapMin: 100, scrapMax: 400 },
  'Battery':           { points: 30,  scrapMin: 15,  scrapMax: 50  },
  'Charger/Adapter':   { points: 20,  scrapMin: 10,  scrapMax: 40  },
  'Circuit Board':     { points: 100, scrapMin: 100, scrapMax: 400 },
  'Monitor/Display':   { points: 120, scrapMin: 150, scrapMax: 500 },
  'Keyboard':          { points: 25,  scrapMin: 20,  scrapMax: 80  },
  'Mouse':             { points: 15,  scrapMin: 10,  scrapMax: 40  },
  'Television':        { points: 130, scrapMin: 200, scrapMax: 600 },
};

// The short code saved in scans.item_type (same codes the scan page always used).
// The server picks it itself, so the browser can't send a strange value.
const ITEM_TYPE_KEYS = {
  'Mobile Phone': 'mobile_phone', 'Laptop': 'laptop', 'Tablet': 'tablet',
  'Battery': 'battery', 'Charger/Adapter': 'charger', 'Circuit Board': 'pcb',
  'Monitor/Display': 'monitor', 'Keyboard': 'keyboard', 'Mouse': 'mouse',
  'Television': 'television',
};

// The usability rules live in ONE shared file, used by the browser AND this server.
const ConditionRules = require('../../frontend/js/condition-rules.js');

// What a user may say a scan really was, besides the 10 categories
const NOT_EWASTE = 'Not e-waste';

// ── Small helpers ──────────────────────────────────────────────
const isGuestRequest = (req) => !req.isAuthenticated || !req.isAuthenticated();

// Run several queries as ONE unit: all succeed, or all are undone.
async function inTransaction(work) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const result = await work(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// The list of allowed categories = the 10 rows of `ewaste_categories`.
async function getCategoryNames() {
  try {
    const [rows] = await db.query('SELECT item_name FROM ewaste_categories ORDER BY id');
    if (rows.length > 0) return rows.map((r) => r.item_name);
  } catch (err) {
    console.error('Category list failed, using backup list:', err.message);
  }
  return Object.keys(EWASTE_DATA);
}

// ── Look up the CURRENT points & peso values for one category ──
// Uses a safe query (the ? is filled in by mysql2, never by string joining).
async function getCategoryMeta(itemName) {
  try {
    const [rows] = await db.query(
      `SELECT points, scrap_value_min, scrap_value_max
         FROM ewaste_categories WHERE item_name = ?`,
      [itemName]
    );
    if (rows.length > 0) {
      return {
        points:   rows[0].points,
        scrapMin: Number(rows[0].scrap_value_min),
        scrapMax: Number(rows[0].scrap_value_max),
      };
    }
  } catch (err) {
    console.error('Category lookup failed, using backup values:', err.message);
  }
  // Same fallback behaviour as before the admin feature existed
  return EWASTE_DATA[itemName] || { points: 10, scrapMin: 5, scrapMax: 30 };
}

// ── Check what the browser sent: 2 categories + 2 confidence numbers ──
// Returns { error } or { top1: {category, confidence}, top2: {...} }.
function readGuesses(body, categories) {
  const b = body || {};

  // Category must be EXACTLY one of our 10 (compared as plain text).
  const cat1 = categories.find((c) => c === b.top1_category);
  const cat2 = categories.find((c) => c === b.top2_category);
  if (!cat1 || !cat2)  return { error: 'Unknown category. It must be one of the 10 e-waste categories.' };
  if (cat1 === cat2)   return { error: 'The two guesses must be different categories.' };

  // Confidence must be a real number from 0 to 1. Keep 4 decimals (same as the database).
  const toConfidence = (v) =>
    (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1)
      ? Math.round(v * 10000) / 10000 : null;
  const c1 = toConfidence(b.top1_confidence);
  const c2 = toConfidence(b.top2_confidence);
  if (c1 === null || c2 === null) return { error: 'Confidence must be a number from 0 to 1.' };

  // Sanity checks: guess #1 is the stronger one, and two probabilities
  // from the same photo can never add up to more than 100%.
  if (c1 < c2)          return { error: 'The first guess must have the higher confidence.' };
  if (c1 + c2 > 1.001)  return { error: 'The two confidence numbers add up to more than 100%.' };

  return { top1: { category: cat1, confidence: c1 }, top2: { category: cat2, confidence: c2 } };
}

// ── "Claim ticket" for a MEDIUM scan ───────────────────────────
// After the server saves a MEDIUM scan it hands the browser a ticket:
//     <scan id>.<stamp>
// The stamp can only be made by the server (it uses the server secret) and it
// is tied to the signed-in user (or to "guest"). So a person can only confirm
// the scan THEY just made — guessing another scan's id does not work.
const TICKET_SECRET = process.env.SESSION_SECRET || 'epatong_secret';

function stampFor(scanId, userId) {
  return crypto.createHmac('sha256', TICKET_SECRET)
    .update(`scan:${scanId}:${userId || 0}`).digest('hex');
}
function makeScanRef(scanId, userId) {
  return `${scanId}.${stampFor(scanId, userId)}`;
}
// Returns the scan id if the ticket is genuine for this user, otherwise null.
function readScanRef(ref, userId) {
  if (typeof ref !== 'string' || !/^\d{1,10}\.[0-9a-f]{64}$/.test(ref)) return null;
  const [idText, stamp] = ref.split('.');
  const a = Buffer.from(stamp, 'hex');
  const b = Buffer.from(stampFor(idText, userId), 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return Number(idText);
}

// ── GET /api/scan/categories — current values (public) ─────────
// The scan page uses this to show the same numbers the server will save.
// These numbers were already shown to everyone on the scan result screen.
router.get('/categories', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const [rows] = await db.query(
      `SELECT item_name, scrap_value_min, scrap_value_max, points
         FROM ewaste_categories ORDER BY id`
    );
    res.json({ categories: rows });
  } catch (err) {
    // Table missing? Send an empty list; the scan page keeps its built-in numbers.
    res.json({ categories: [] });
  }
});

// ── POST /api/scan/evaluate — the SERVER decides the level ─────
router.post('/evaluate', optionalAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const guesses = readGuesses(req.body, await getCategoryNames());
    if (guesses.error) return res.status(400).json({ error: guesses.error });

    const level = decideLevel(guesses.top1.confidence, await getCutoffs());

    // Demo mode: answer with the level only. Nothing is saved, no ticket, no points.
    if ((req.body || {}).demo === true) return res.json({ level, demo: true });

    // HIGH: nothing is saved yet. The user clicks "Save Scan" like before.
    if (level === 'high') return res.json({ level });

    // MEDIUM or LOW: save it now (0 points) so the admin can review it later.
    // item_name, item_type, condition_* stay empty (NULL) on purpose.
    const guest  = isGuestRequest(req);
    const userId = guest ? null : req.user.id;

    const [result] = await db.query(
      `INSERT INTO scans
         (user_id, points_earned, confidence, is_guest, confidence_level,
          top1_category, top1_confidence, top2_category, top2_confidence, user_confirmed)
       VALUES (?, 0, ?, ?, ?, ?, ?, ?, ?, FALSE)`,
      [userId, guesses.top1.confidence, guest, level,
       guesses.top1.category, guesses.top1.confidence,
       guesses.top2.category, guesses.top2.confidence]
    );

    // MEDIUM: ticket to pick a guess. LOW: ticket so the user can say what it really was.
    res.json({ level, scan_ref: makeScanRef(result.insertId, userId) });

  } catch (err) {
    console.error('Evaluate scan error:', err);
    res.status(500).json({ error: 'Could not check this scan.' });
  }
});

// ── POST /api/scan/save — save a HIGH scan (earns points) ──────
router.post('/save', optionalAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const guesses = readGuesses(req.body, await getCategoryNames());
    if (guesses.error) return res.status(400).json({ error: guesses.error });

    // The 3 condition answers. The SERVER turns them into the label (shared rule file).
    const condition = ConditionRules.decideCondition((req.body || {}).condition);
    if (!condition) {
      return res.status(400).json({ error: 'Please answer the 3 condition questions.' });
    }

    // Decide the level AGAIN here. This endpoint never trusts the earlier answer.
    const level = decideLevel(guesses.top1.confidence, await getCutoffs());
    if (level !== 'high') {
      return res.status(409).json({ error: 'The scan rules just changed. Please check this photo again.', level });
    }

    const category = guesses.top1.category;
    const meta     = await getCategoryMeta(category);
    const guest    = isGuestRequest(req);
    const userId   = guest ? null : req.user.id;

    // The peso range depends on the condition (always inside the range the admin set)
    const band = ConditionRules.bandFor(condition.status, meta.scrapMin, meta.scrapMax);

    // Guests earn 0 points; logged-in users earn full points
    const pointsEarned = guest ? 0 : meta.points;

    const scanId = await inTransaction(async (conn) => {
      const [result] = await conn.query(
        `INSERT INTO scans
           (user_id, item_type, item_name, condition_status, condition_label,
            scrap_value_min, scrap_value_max, points_earned, confidence, is_guest,
            confidence_level, top1_category, top1_confidence, top2_category, top2_confidence,
            user_confirmed, final_category)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'high', ?, ?, ?, ?, FALSE, ?)`,
        [userId, ITEM_TYPE_KEYS[category] || 'unknown', category,
         condition.status, condition.label,
         band.min, band.max, pointsEarned, guesses.top1.confidence, guest,
         category, guesses.top1.confidence, guesses.top2.category, guesses.top2.confidence,
         category]
      );

      // Award points and increment scan count for logged-in users
      if (!guest) {
        await conn.query(
          'UPDATE users SET points = points + ?, total_scans = total_scans + 1 WHERE id = ?',
          [pointsEarned, userId]
        );
      }
      return result.insertId;
    });

    const [saved] = await db.query('SELECT * FROM scans WHERE id = ?', [scanId]);
    res.json({ success: true, level: 'high', scan: saved[0], pointsEarned, isGuest: guest,
               scan_ref: makeScanRef(scanId, userId) });   // ticket for "Was this right?"

  } catch (err) {
    console.error('Save scan error:', err);
    res.status(500).json({ error: 'Failed to save scan.' });
  }
});

// ── POST /api/scan/confirm — user picked one of the 2 guesses (MEDIUM) ──
router.post('/confirm', optionalAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const guest  = isGuestRequest(req);
    const userId = guest ? null : req.user.id;

    // 1) The ticket must be genuine and belong to THIS person.
    const scanId = readScanRef((req.body || {}).scan_ref, userId);
    if (!scanId) return res.status(403).json({ error: 'This scan could not be verified. Please scan again.' });

    const chosen = (req.body || {}).chosen_category;
    if (typeof chosen !== 'string') return res.status(400).json({ error: 'Please pick one of the two guesses.' });

    const result = await inTransaction(async (conn) => {
      const [found] = await conn.query('SELECT * FROM scans WHERE id = ? FOR UPDATE', [scanId]);
      const scan = found[0];

      if (!scan || scan.confidence_level !== 'medium') {
        return { status: 404, error: 'Scan not found.' };
      }
      if (scan.user_confirmed) {
        return { status: 409, error: 'You already picked an answer for this scan.' };
      }
      // 2) The pick must be one of the two guesses the SERVER saved (not whatever the browser says).
      if (chosen !== scan.top1_category && chosen !== scan.top2_category) {
        return { status: 400, error: 'Please pick one of the two guesses.' };
      }

      const meta         = await getCategoryMeta(chosen);
      const pointsEarned = guest ? 0 : meta.points;

      // 3) One atomic UPDATE: only a MEDIUM scan that is still unconfirmed can change,
      //    so points can never be given twice for the same scan.
      const [upd] = await conn.query(
        `UPDATE scans
            SET item_type = ?, item_name = ?, final_category = ?, user_confirmed = TRUE,
                scrap_value_min = ?, scrap_value_max = ?, points_earned = ?
          WHERE id = ? AND confidence_level = 'medium' AND user_confirmed = FALSE`,
        [ITEM_TYPE_KEYS[chosen] || 'unknown', chosen, chosen,
         meta.scrapMin, meta.scrapMax, pointsEarned, scanId]
      );
      if (upd.affectedRows !== 1) return { status: 409, error: 'You already picked an answer for this scan.' };

      if (!guest) {
        await conn.query(
          'UPDATE users SET points = points + ?, total_scans = total_scans + 1 WHERE id = ?',
          [pointsEarned, userId]
        );
      }
      return { ok: true, pointsEarned };
    });

    if (!result.ok) return res.status(result.status).json({ error: result.error });

    const [saved] = await db.query('SELECT * FROM scans WHERE id = ?', [scanId]);
    res.json({ success: true, level: 'medium', scan: saved[0], pointsEarned: result.pointsEarned, isGuest: guest });

  } catch (err) {
    console.error('Confirm scan error:', err);
    res.status(500).json({ error: 'Failed to save your answer.' });
  }
});

// ── POST /api/scan/feedback — "Was this result right?" ─────────
// Body: { scan_ref, correct: true|false, actual_category?: one of the 10 | 'Not e-waste' }
//   HIGH scan : correct = true  -> saved as "right"
//               correct = false -> saved as "wrong" (+ what it really was, if the user knows)
//   LOW scan  : the model had no answer, so the user can only tell us what it really was.
// Feedback NEVER changes points. It can only be given once per scan.
router.post('/feedback', optionalAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const guest  = isGuestRequest(req);
    const userId = guest ? null : req.user.id;

    // 1) The ticket must be genuine and belong to THIS person.
    const body   = req.body || {};
    const scanId = readScanRef(body.scan_ref, userId);
    if (!scanId) return res.status(403).json({ error: 'This scan could not be verified.' });

    // 2) What the user told us. Anything outside our list is refused.
    if (typeof body.correct !== 'boolean') return res.status(400).json({ error: 'Please answer right or wrong.' });
    const allowed = [...(await getCategoryNames()), NOT_EWASTE];
    let actual = null;
    if (body.actual_category !== undefined && body.actual_category !== null && body.actual_category !== '') {
      actual = allowed.find((c) => c === body.actual_category) || null;
      if (!actual) return res.status(400).json({ error: 'Unknown category.' });
    }

    const [found] = await db.query('SELECT id, confidence_level, final_category, user_feedback FROM scans WHERE id = ?', [scanId]);
    const scan = found[0];
    if (!scan || !['high', 'low'].includes(scan.confidence_level)) {
      return res.status(404).json({ error: 'Scan not found.' });
    }

    let feedback;
    if (scan.confidence_level === 'high') {
      if (body.correct) { feedback = 'right'; actual = null; }
      else {
        feedback = 'wrong';
        if (actual && actual === scan.final_category) {
          return res.status(400).json({ error: 'That is the same as our answer. Pick a different one.' });
        }
      }
    } else {                                   // LOW: only "what was it?" makes sense
      if (body.correct || !actual) return res.status(400).json({ error: 'Please tell us what it was.' });
      feedback = 'wrong';
    }

    // 3) One atomic UPDATE: only a scan with no feedback yet can change.
    const [upd] = await db.query(
      `UPDATE scans SET user_feedback = ?, actual_category = ?, feedback_at = NOW()
        WHERE id = ? AND user_feedback IS NULL`,
      [feedback, actual, scanId]
    );
    if (upd.affectedRows !== 1) return res.status(409).json({ error: 'You already answered for this scan.' });

    res.json({ success: true, feedback });

  } catch (err) {
    console.error('Scan feedback error:', err);
    res.status(500).json({ error: 'Could not save your answer.' });
  }
});

// ── GET /api/scan/history — get logged-in user's scan history ──
// Only FINISHED scans are listed (item_name is filled). Unfinished MEDIUM
// scans and LOW scans are kept for the admin only.
// A MEDIUM scan has no condition, so we label it here — that way the
// dashboard page does not show the word "null".
router.get('/history', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, user_id, item_type, item_name, condition_status,
              COALESCE(condition_label, 'Condition not checked') AS condition_label,
              scrap_value_min, scrap_value_max, points_earned, confidence,
              is_guest, created_at
         FROM scans
        WHERE user_id = ? AND item_name IS NOT NULL
        ORDER BY created_at DESC LIMIT 50`,
      [req.user.id]
    );
    res.json({ scans: rows });
  } catch (err) {
    console.error('Scan history error:', err);
    res.status(500).json({ error: 'Failed to fetch scan history.' });
  }
});

module.exports = router;
