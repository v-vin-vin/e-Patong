// ============================================================
// e-Patong — Admin API
// Every URL here starts with /api/admin (see server.js).
//
// SAFETY RULES used in this file (good to remember for your defense):
//   1. LOCK      : router.use(requireAdmin) is the FIRST thing below,
//                  so no route in this file can be reached by a non-admin.
//   2. SAFE SQL  : user text is ONLY passed through "?" placeholders.
//                  The few ${...} pieces inside SQL are fixed strings
//                  written by us, never text from the user.
//   3. VALIDATION: every number and text is checked before it is saved.
//   4. NO DELETE : there is no DELETE route at all. Rewards are turned off.
//   5. LOG       : every change is saved in admin_logs in the SAME
//                  transaction as the change (both happen, or neither).
// ============================================================
const express = require('express');
const db      = require('../config/db');
const { requireAdmin } = require('../middleware/authMiddleware');
const { SETTING_KEYS, validateCutoffs, getCutoffs } = require('../config/confidence');
const { getOverviewStats } = require('../config/overviewStats');
const router  = express.Router();

// ── LOCK #1: everything below needs a signed-in ADMIN ──────────
router.use(requireAdmin);

// Never let the browser keep old admin answers.
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// ── LOCK #2: changes must be sent as JSON ──────────────────────
// A fake form on another website cannot send JSON with our cookie,
// so this blocks "CSRF" tricks.
router.use((req, res, next) => {
  const isChange = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
  if (isChange && !req.is('application/json')) {
    return res.status(415).json({ error: 'Requests must be sent as JSON.' });
  }
  next();
});

// ============================================================
// Small helpers
// ============================================================
const PAGE_SIZE    = 20;
const MAX_NUMBER   = 1000000;
const REWARD_TYPES = ['gcash', 'eload', 'voucher', 'discount'];  // same as catalog_items.reward_type

// Characters we do not allow in reward text. The public catalog page
// puts reward text straight into HTML, so < > " \ and control
// characters could break it (or be used for tricks).
const BAD_TEXT = /[<>"\\\u0000-\u001F\u007F]/;

// A "known" problem (wrong input, not found...). Sent back to the browser as-is.
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Wraps a route so errors are handled in ONE place.
const route = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('Admin route error:', req.method, req.originalUrl, err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
};

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

// Save one line in the admin log.
async function writeLog(conn, adminId, action, targetType, targetId, details) {
  await conn.query(
    `INSERT INTO admin_logs (admin_id, action, target_type, target_id, details)
     VALUES (?, ?, ?, ?, ?)`,
    [adminId, action, targetType, targetId, String(details || '').slice(0, 1000)]
  );
}

// "points: 150 → 160; stock: 5 → 4"  (only the fields that changed)
function describeChanges(before, after, fields) {
  const parts = [];
  for (const f of fields) {
    if (String(before[f] ?? '') !== String(after[f] ?? '')) {
      parts.push(`${f}: ${before[f] === '' || before[f] == null ? '(empty)' : before[f]} → ${after[f] === '' || after[f] == null ? '(empty)' : after[f]}`);
    }
  }
  return parts.join('; ');
}

// Read a whole number from a number or a string like "25". Anything else -> null.
function readInteger(value) {
  if (typeof value === 'number') return Number.isInteger(value) ? value : null;
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return parseInt(value.trim(), 10);
  return null;
}

// Read a peso amount: 0 or more, at most 2 decimals. Anything else -> null.
function readMoney(value) {
  const text = typeof value === 'number' ? String(value)
             : typeof value === 'string' ? value.trim() : '';
  return /^\d+(\.\d{1,2})?$/.test(text) ? Number(text) : null;
}

// Read the :id from the URL (must be a positive whole number).
function readId(raw) {
  const id = readInteger(raw);
  if (id === null || id < 1) throw new HttpError(400, 'Invalid id.');
  return id;
}

// Search + paging for the list pages.
function listParams(req) {
  const page = Math.min(Math.max(readInteger(req.query.page) || 1, 1), 100000);
  const q    = String(req.query.q || '').trim().slice(0, 100);
  // Escape % and _ so the person's text is searched as plain text, not as wildcards.
  const like = '%' + q.replace(/[\\%_]/g, '\\$&') + '%';
  return { page, offset: (page - 1) * PAGE_SIZE, q, like };
}

// ============================================================
// Validation
// ============================================================
function validateReward(body) {
  const b = body || {};
  const errors = [];

  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!name)                    errors.push('Name is required.');
  else if (name.length > 255)   errors.push('Name is too long (max 255 characters).');
  else if (BAD_TEXT.test(name)) errors.push('Name cannot contain < > " or \\ characters.');

  const description = b.description == null ? '' : (typeof b.description === 'string' ? b.description.trim() : null);
  if (description === null)                errors.push('Description must be text.');
  else if (description.length > 1000)      errors.push('Description is too long (max 1000 characters).');
  else if (BAD_TEXT.test(description))     errors.push('Description cannot contain < > " or \\ characters.');

  let emoji = b.emoji == null ? '' : (typeof b.emoji === 'string' ? b.emoji.trim() : null);
  if (emoji === null)                      errors.push('Emoji must be text.');
  else if ([...emoji].length > 8)          errors.push('Emoji is too long (use 1 emoji).');
  else if (BAD_TEXT.test(emoji))           errors.push('Emoji cannot contain < > " or \\ characters.');
  if (emoji === '') emoji = '🎁';          // same default as the database

  if (!REWARD_TYPES.includes(b.reward_type)) {
    errors.push(`Type must be one of: ${REWARD_TYPES.join(', ')}.`);
  }

  const rewardValue = b.reward_value == null ? '' : (typeof b.reward_value === 'string' ? b.reward_value.trim() : null);
  if (rewardValue === null)                errors.push('Reward value must be text.');
  else if (rewardValue.length > 100)       errors.push('Reward value is too long (max 100 characters).');
  else if (BAD_TEXT.test(rewardValue))     errors.push('Reward value cannot contain < > " or \\ characters.');

  const points = readInteger(b.points_required);
  if (points === null || points < 1 || points > MAX_NUMBER) {
    errors.push('Points required must be a whole number from 1 to 1,000,000.');
  }

  // stock: 0 or more, or -1 which already means "unlimited" in your database.
  const stock = readInteger(b.stock);
  if (stock === null || !(stock === -1 || (stock >= 0 && stock <= MAX_NUMBER))) {
    errors.push('Stock must be 0 or more (use "Unlimited" for no limit).');
  }

  return {
    errors,
    data: {
      name, description, emoji,
      reward_type: b.reward_type, reward_value: rewardValue,
      points_required: points, stock,
    },
  };
}

function validateCategory(body) {
  const b = body || {};
  const errors = [];

  const min    = readMoney(b.scrap_value_min);
  const max    = readMoney(b.scrap_value_max);
  const points = readInteger(b.points);

  if (min === null || min > MAX_NUMBER) errors.push('Lowest peso value must be 0 or more (max 2 decimals, up to 1,000,000).');
  if (max === null || max > MAX_NUMBER) errors.push('Highest peso value must be 0 or more (max 2 decimals, up to 1,000,000).');
  if (min !== null && max !== null && min > max) errors.push('Lowest peso value cannot be higher than the highest.');
  if (points === null || points < 0 || points > MAX_NUMBER) errors.push('Points must be a whole number from 0 to 1,000,000.');

  return { errors, data: { scrap_value_min: min, scrap_value_max: max, points } };
}

// ============================================================
// 1) TOTALS
// GET /api/admin/stats
// ============================================================
router.get('/stats', route(async (req, res) => {
  res.json(await getOverviewStats());   // same numbers the homepage shows (config/overviewStats.js)
}));


// ============================================================
// 2) REWARDS (catalog_items) — add, edit, turn on/off. NO delete.
// ============================================================
// GET /api/admin/rewards  (active AND turned-off ones)
router.get('/rewards', route(async (req, res) => {
  const [rows] = await db.query(
    'SELECT * FROM catalog_items ORDER BY is_active DESC, points_required ASC, id ASC'
  );
  res.json({ rewards: rows });
}));

// POST /api/admin/rewards
router.post('/rewards', route(async (req, res) => {
  const { errors, data } = validateReward(req.body);
  if (errors.length) throw new HttpError(400, errors.join(' '));

  const newId = await inTransaction(async (conn) => {
    const [result] = await conn.query(
      `INSERT INTO catalog_items
         (name, description, points_required, reward_type, reward_value, emoji, stock, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, TRUE)`,
      [data.name, data.description, data.points_required, data.reward_type,
       data.reward_value, data.emoji, data.stock]
    );
    await writeLog(conn, req.user.id, 'reward_created', 'reward', result.insertId,
      `Added reward "${data.name}" (${data.points_required} pts, ${data.reward_type}, ` +
      `stock ${data.stock === -1 ? 'unlimited' : data.stock})`);
    return result.insertId;
  });

  const [rows] = await db.query('SELECT * FROM catalog_items WHERE id = ?', [newId]);
  res.status(201).json({ reward: rows[0] });
}));

// PUT /api/admin/rewards/:id
router.put('/rewards/:id', route(async (req, res) => {
  const id = readId(req.params.id);
  const { errors, data } = validateReward(req.body);
  if (errors.length) throw new HttpError(400, errors.join(' '));

  await inTransaction(async (conn) => {
    const [found] = await conn.query('SELECT * FROM catalog_items WHERE id = ? FOR UPDATE', [id]);
    if (found.length === 0) throw new HttpError(404, 'Reward not found.');

    await conn.query(
      `UPDATE catalog_items
          SET name = ?, description = ?, points_required = ?, reward_type = ?,
              reward_value = ?, emoji = ?, stock = ?
        WHERE id = ?`,
      [data.name, data.description, data.points_required, data.reward_type,
       data.reward_value, data.emoji, data.stock, id]
    );

    const changes = describeChanges(found[0], data,
      ['name', 'description', 'points_required', 'reward_type', 'reward_value', 'emoji', 'stock']);
    if (changes) {
      await writeLog(conn, req.user.id, 'reward_edited', 'reward', id,
        `Edited reward #${id} "${found[0].name}": ${changes}`);
    }
  });

  const [rows] = await db.query('SELECT * FROM catalog_items WHERE id = ?', [id]);
  res.json({ reward: rows[0] });
}));

// PATCH /api/admin/rewards/:id/active   body: { "is_active": true | false }
// "Turn off" hides the reward from users. Old vouchers are not touched.
router.patch('/rewards/:id/active', route(async (req, res) => {
  const id = readId(req.params.id);
  if (typeof (req.body || {}).is_active !== 'boolean') {
    throw new HttpError(400, 'is_active must be true or false.');
  }
  const turnOn = req.body.is_active;

  await inTransaction(async (conn) => {
    const [found] = await conn.query('SELECT id, name FROM catalog_items WHERE id = ? FOR UPDATE', [id]);
    if (found.length === 0) throw new HttpError(404, 'Reward not found.');

    await conn.query('UPDATE catalog_items SET is_active = ? WHERE id = ?', [turnOn, id]);
    await writeLog(conn, req.user.id, turnOn ? 'reward_turned_on' : 'reward_turned_off', 'reward', id,
      `${turnOn ? 'Turned ON' : 'Turned OFF'} reward #${id} "${found[0].name}"`);
  });

  const [rows] = await db.query('SELECT * FROM catalog_items WHERE id = ?', [id]);
  res.json({ reward: rows[0] });
}));

// ============================================================
// 3) E-WASTE CATEGORIES — change peso value + points (no add/delete)
// ============================================================
// GET /api/admin/categories
router.get('/categories', route(async (req, res) => {
  const [rows] = await db.query(
    `SELECT id, item_name, scrap_value_min, scrap_value_max, points, updated_at
       FROM ewaste_categories ORDER BY id`
  );
  res.json({ categories: rows });
}));

// PUT /api/admin/categories/:id   body: { scrap_value_min, scrap_value_max, points }
router.put('/categories/:id', route(async (req, res) => {
  const id = readId(req.params.id);
  const { errors, data } = validateCategory(req.body);
  if (errors.length) throw new HttpError(400, errors.join(' '));

  await inTransaction(async (conn) => {
    const [found] = await conn.query('SELECT * FROM ewaste_categories WHERE id = ? FOR UPDATE', [id]);
    if (found.length === 0) throw new HttpError(404, 'Category not found.');

    // DECIMAL columns come back as text like "200.00" — turn into numbers to compare fairly.
    const before = {
      scrap_value_min: Number(found[0].scrap_value_min),
      scrap_value_max: Number(found[0].scrap_value_max),
      points:          found[0].points,
    };

    await conn.query(
      `UPDATE ewaste_categories
          SET scrap_value_min = ?, scrap_value_max = ?, points = ?
        WHERE id = ?`,
      [data.scrap_value_min, data.scrap_value_max, data.points, id]
    );

    const changes = describeChanges(before, data, ['scrap_value_min', 'scrap_value_max', 'points']);
    if (changes) {
      await writeLog(conn, req.user.id, 'category_edited', 'category', id,
        `Edited ${found[0].item_name}: ${changes}`);
    }
  });

  const [rows] = await db.query(
    `SELECT id, item_name, scrap_value_min, scrap_value_max, points, updated_at
       FROM ewaste_categories WHERE id = ?`, [id]
  );
  res.json({ category: rows[0] });
}));

// ============================================================
// 4) VOUCHERS — check a code, mark it as used
// ============================================================
// One SELECT used by both "check" and "mark as used".
// effective_status: used  >  expired  >  unused
//   (the `status` column never says 'expired' by itself, so we also look at expires_at)
const VOUCHER_SELECT = `
  SELECT v.id, v.code, v.status, v.created_at, v.redeemed_at, v.expires_at,
         CASE
           WHEN v.status = 'used' THEN 'used'
           WHEN v.status = 'expired'
             OR (v.expires_at IS NOT NULL AND v.expires_at < NOW()) THEN 'expired'
           ELSE 'unused'
         END AS effective_status,
         ci.name AS item_name, ci.reward_type, ci.reward_value, ci.emoji,
         u.name  AS user_name, u.email AS user_email
    FROM vouchers v
    JOIN catalog_items ci ON ci.id = v.catalog_item_id
    JOIN users u          ON u.id  = v.user_id`;

// GET /api/admin/vouchers/lookup?code=EPAT-XXXX-XXXX
router.get('/vouchers/lookup', route(async (req, res) => {
  const code = String(req.query.code || '').trim().toUpperCase();
  if (!/^[A-Z0-9-]{4,50}$/.test(code)) {
    throw new HttpError(400, 'Enter a voucher code like EPAT-X7K3-M2NP.');
  }
  const [rows] = await db.query(`${VOUCHER_SELECT} WHERE v.code = ?`, [code]);
  if (rows.length === 0) throw new HttpError(404, 'No voucher found with that code.');
  res.json({ voucher: rows[0] });
}));

// POST /api/admin/vouchers/:id/use
// ONE atomic UPDATE: it only changes a voucher that is still 'unused' AND not expired.
// So a used code can never be used again — even if two admins click at the same moment,
// only one of them gets affectedRows = 1.
router.post('/vouchers/:id/use', route(async (req, res) => {
  const id = readId(req.params.id);

  await inTransaction(async (conn) => {
    const [result] = await conn.query(
      `UPDATE vouchers
          SET status = 'used', redeemed_at = NOW()
        WHERE id = ? AND status = 'unused'
          AND (expires_at IS NULL OR expires_at > NOW())`,
      [id]
    );

    if (result.affectedRows !== 1) {
      const [rows] = await conn.query(`${VOUCHER_SELECT} WHERE v.id = ?`, [id]);
      if (rows.length === 0) throw new HttpError(404, 'Voucher not found.');
      throw new HttpError(409, rows[0].effective_status === 'used'
        ? 'This voucher was already used. It cannot be used again.'
        : 'This voucher is expired. It cannot be used.');
    }

    const [rows] = await conn.query('SELECT code FROM vouchers WHERE id = ?', [id]);
    await writeLog(conn, req.user.id, 'voucher_marked_used', 'voucher', id,
      `Marked voucher ${rows[0].code} as used`);
  });

  const [rows] = await db.query(`${VOUCHER_SELECT} WHERE v.id = ?`, [id]);
  res.json({ voucher: rows[0] });
}));

// ============================================================
// 5) VIEW-ONLY LISTS (with search + paging)
//    Emails are only sent from here, behind requireAdmin.
// ============================================================
// GET /api/admin/users?q=...&page=1
router.get('/users', route(async (req, res) => {
  const { page, offset, q, like } = listParams(req);
  const where = q ? 'WHERE name LIKE ? OR email LIKE ?' : '';   // fixed text, not user text
  const args  = q ? [like, like] : [];

  const [[count]] = await db.query(`SELECT COUNT(*) AS total FROM users ${where}`, args);
  const [rows] = await db.query(
    `SELECT id, name, email, role, points, total_scans, created_at
       FROM users ${where}
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?`,
    [...args, PAGE_SIZE, offset]
  );
  res.json({ rows, page, pageSize: PAGE_SIZE, total: Number(count.total) });
}));

// GET /api/admin/scans?q=...&page=1
router.get('/scans', route(async (req, res) => {
  const { page, offset, q, like } = listParams(req);
  // Finished scans only. LOW / unfinished MEDIUM scans are listed in /scan-reviews.
  const where = q
    ? `WHERE s.item_name IS NOT NULL
         AND (s.item_name LIKE ? OR s.condition_label LIKE ? OR u.name LIKE ? OR u.email LIKE ?)`
    : 'WHERE s.item_name IS NOT NULL';                            // fixed text, not user text
  const args = q ? [like, like, like, like] : [];

  const [[count]] = await db.query(
    `SELECT COUNT(*) AS total
       FROM scans s LEFT JOIN users u ON u.id = s.user_id ${where}`, args
  );
  const [rows] = await db.query(
    `SELECT s.id, s.item_name, s.condition_status, s.condition_label,
            s.scrap_value_min, s.scrap_value_max, s.points_earned,
            s.is_guest, s.created_at,
            u.name AS user_name, u.email AS user_email
       FROM scans s LEFT JOIN users u ON u.id = s.user_id
       ${where}
      ORDER BY s.created_at DESC, s.id DESC
      LIMIT ? OFFSET ?`,
    [...args, PAGE_SIZE, offset]
  );
  res.json({ rows, page, pageSize: PAGE_SIZE, total: Number(count.total) });
}));

// GET /api/admin/logs?page=1
router.get('/logs', route(async (req, res) => {
  const { page, offset } = listParams(req);
  const [[count]] = await db.query('SELECT COUNT(*) AS total FROM admin_logs');
  const [rows] = await db.query(
    `SELECT l.id, l.action, l.target_type, l.target_id, l.details, l.created_at,
            u.name AS admin_name
       FROM admin_logs l LEFT JOIN users u ON u.id = l.admin_id
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT ? OFFSET ?`,
    [PAGE_SIZE, offset]
  );
  res.json({ rows, page, pageSize: PAGE_SIZE, total: Number(count.total) });
}));

// ============================================================
// 6) CONFIDENCE SETTINGS — the two cutoffs (LOW and HIGH)
// ============================================================
// GET /api/admin/settings
router.get('/settings', route(async (req, res) => {
  const cutoffs = await getCutoffs();
  let updatedAt = null;
  try {
    const [rows] = await db.query(
      'SELECT MAX(updated_at) AS updated_at FROM settings WHERE setting_key IN (?, ?)',
      [SETTING_KEYS.low, SETTING_KEYS.high]
    );
    updatedAt = rows[0].updated_at;
  } catch (err) { /* table missing -> just no date */ }
  res.json({ low_cutoff: cutoffs.low, high_cutoff: cutoffs.high, updated_at: updatedAt });
}));

// PUT /api/admin/settings   body: { low_cutoff: 0.6, high_cutoff: 0.85 }
// Rules: both between 0 and 1, and LOW must be smaller than HIGH.
router.put('/settings', route(async (req, res) => {
  const body = req.body || {};
  const { errors, low, high } = validateCutoffs(body.low_cutoff, body.high_cutoff);
  if (errors.length) throw new HttpError(400, errors.join(' '));

  const percent = (n) => `${Number((n * 100).toFixed(2))}%`;

  await inTransaction(async (conn) => {
    const before = await (async () => {
      const [rows] = await conn.query(
        'SELECT setting_key, setting_value FROM settings WHERE setting_key IN (?, ?) FOR UPDATE',
        [SETTING_KEYS.low, SETTING_KEYS.high]
      );
      const found = {};
      rows.forEach((r) => { found[r.setting_key] = Number(r.setting_value); });
      return { low: found[SETTING_KEYS.low], high: found[SETTING_KEYS.high] };
    })();

    // Insert the row if it is missing, otherwise update it.
    await conn.query(
      `INSERT INTO settings (setting_key, setting_value) VALUES (?, ?), (?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
      [SETTING_KEYS.low, low.toFixed(4), SETTING_KEYS.high, high.toFixed(4)]
    );

    // Write to the admin log only if something really changed.
    const parts = [];
    if (before.low  !== low)  parts.push(`LOW cutoff: ${before.low  == null ? '(none)' : percent(before.low)} → ${percent(low)}`);
    if (before.high !== high) parts.push(`HIGH cutoff: ${before.high == null ? '(none)' : percent(before.high)} → ${percent(high)}`);
    if (parts.length) {
      await writeLog(conn, req.user.id, 'settings_changed', 'settings', null,
        `Changed confidence cutoffs — ${parts.join('; ')}`);
    }
  });

  res.json({ low_cutoff: low, high_cutoff: high });
}));

// ============================================================
// 7) REVIEW SCANS — the MEDIUM and LOW scans (to improve the model later)
// GET /api/admin/scan-reviews?level=medium|low&page=1
// ============================================================
router.get('/scan-reviews', route(async (req, res) => {
  const { page, offset } = listParams(req);
  const level = ['medium', 'low'].includes(req.query.level) ? req.query.level : null;

  // Both pieces of SQL text below are fixed strings written by us.
  const where = level ? 'WHERE confidence_level = ?' : "WHERE confidence_level IN ('medium', 'low')";
  const args  = level ? [level] : [];

  const [[count]] = await db.query(`SELECT COUNT(*) AS total FROM scans ${where}`, args);
  const [rows] = await db.query(
    `SELECT id, confidence_level, top1_category, top1_confidence,
            top2_category, top2_confidence, user_confirmed, final_category,
            user_feedback, actual_category, is_guest, created_at
       FROM scans ${where}
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?`,
    [...args, PAGE_SIZE, offset]
  );

  // Small summary for the top of the page
  const [[sum]] = await db.query(
    `SELECT COALESCE(SUM(confidence_level = 'medium'), 0)                          AS medium,
            COALESCE(SUM(confidence_level = 'low'), 0)                             AS low,
            COALESCE(SUM(confidence_level = 'medium' AND user_confirmed = TRUE), 0) AS medium_picked,
            COALESCE(SUM(confidence_level = 'medium' AND user_confirmed = TRUE
                         AND final_category <> top1_category), 0)                  AS picked_second
       FROM scans WHERE confidence_level IN ('medium', 'low')`
  );

  res.json({
    rows, page, pageSize: PAGE_SIZE, total: Number(count.total),
    summary: {
      medium: Number(sum.medium), low: Number(sum.low),
      mediumPicked: Number(sum.medium_picked), pickedSecond: Number(sum.picked_second),
    },
  });
}));

// ============================================================
// 8) ACCURACY — what users told us ("Was this right?" + their MEDIUM picks)
// GET /api/admin/accuracy
// These are the users' own answers, not a lab test: people who answer
// are not a random sample, and small counts are unreliable.
// ============================================================
router.get('/accuracy', route(async (req, res) => {
  // HIGH scans (they only exist once saved) and how many were rated
  const [[hi]] = await db.query(
    `SELECT COUNT(*) AS saved,
            COALESCE(SUM(user_feedback = 'right'), 0) AS right_n,
            COALESCE(SUM(user_feedback = 'wrong'), 0) AS wrong_n,
            COALESCE(SUM(user_feedback = 'wrong' AND actual_category = 'Not e-waste'), 0) AS not_ewaste_n
       FROM scans WHERE confidence_level = 'high'`
  );

  // Per category (what the model said), HIGH scans that were rated
  const [byCategory] = await db.query(
    `SELECT final_category AS category,
            SUM(user_feedback = 'right') AS right_n,
            SUM(user_feedback = 'wrong') AS wrong_n
       FROM scans
      WHERE confidence_level = 'high' AND user_feedback IS NOT NULL
      GROUP BY final_category
      ORDER BY (SUM(user_feedback = 'right') + SUM(user_feedback = 'wrong')) DESC, final_category`
  );

  // Most common mix-ups: the model said X, the user says it was Y
  const [confusions] = await db.query(
    `SELECT final_category AS said, actual_category AS actually, COUNT(*) AS n
       FROM scans
      WHERE confidence_level = 'high' AND user_feedback = 'wrong' AND actual_category IS NOT NULL
      GROUP BY final_category, actual_category
      ORDER BY n DESC, said, actually LIMIT 10`
  );

  // MEDIUM scans where the user picked: was the model's 1st guess the right one?
  const [[med]] = await db.query(
    `SELECT COUNT(*) AS picked,
            COALESCE(SUM(final_category = top1_category), 0) AS first_n
       FROM scans WHERE confidence_level = 'medium' AND user_confirmed = TRUE`
  );

  // LOW scans: how many, and what users said they really were
  const [[lowTotal]] = await db.query(`SELECT COUNT(*) AS total FROM scans WHERE confidence_level = 'low'`);
  const [lowNamed] = await db.query(
    `SELECT actual_category AS actually, COUNT(*) AS n
       FROM scans
      WHERE confidence_level = 'low' AND user_feedback = 'wrong' AND actual_category IS NOT NULL
      GROUP BY actual_category ORDER BY n DESC, actually LIMIT 10`
  );

  const rated = Number(hi.right_n) + Number(hi.wrong_n);
  res.json({
    high: {
      saved: Number(hi.saved), rated, right: Number(hi.right_n), wrong: Number(hi.wrong_n),
      notEwaste: Number(hi.not_ewaste_n),
      accuracy: rated > 0 ? Number(hi.right_n) / rated : null,
    },
    byCategory: byCategory.map((r) => {
      const right = Number(r.right_n), wrong = Number(r.wrong_n);
      return { category: r.category, right, wrong, accuracy: right + wrong > 0 ? right / (right + wrong) : null };
    }),
    confusions: confusions.map((r) => ({ said: r.said, actually: r.actually, n: Number(r.n) })),
    medium: {
      picked: Number(med.picked), first: Number(med.first_n),
      firstRate: Number(med.picked) > 0 ? Number(med.first_n) / Number(med.picked) : null,
    },
    low: { total: Number(lowTotal.total), named: lowNamed.reduce((a, r) => a + Number(r.n), 0),
           list: lowNamed.map((r) => ({ actually: r.actually, n: Number(r.n) })) },
  });
}));

module.exports = router;
