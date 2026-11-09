const express  = require('express');
const db       = require('../config/db');
const { requireAuth } = require('../middleware/authMiddleware');
const router   = express.Router();

// ── Generate unique voucher code ───────────────────────────────
function generateVoucherCode() {
  const chars  = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const prefix = 'EPAT';
  let code     = prefix + '-';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  code += '-';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code; // e.g. EPAT-X7K3-M2NP
}

// ── GET /api/rewards/catalog ───────────────────────────────────
router.get('/catalog', async (req, res) => {
  try {
    const [items] = await db.query(
      'SELECT * FROM catalog_items WHERE is_active = TRUE ORDER BY points_required ASC'
    );
    res.json({ items });
  } catch (err) {
    console.error('Catalog error:', err);
    res.status(500).json({ error: 'Failed to fetch catalog.' });
  }
});

// ── POST /api/rewards/redeem ───────────────────────────────────
router.post('/redeem', requireAuth, async (req, res) => {
  const { catalog_item_id } = req.body;
  const userId = req.user.id;

  if (!catalog_item_id) {
    return res.status(400).json({ error: 'Missing catalog_item_id.' });
  }

  try {
    // Get catalog item
    const [items] = await db.query(
      'SELECT * FROM catalog_items WHERE id = ? AND is_active = TRUE',
      [catalog_item_id]
    );
    if (items.length === 0) {
      return res.status(404).json({ error: 'Reward item not found.' });
    }
    const item = items[0];

    // Check user points
    const [users] = await db.query('SELECT points FROM users WHERE id = ?', [userId]);
    const userPoints = users[0].points;

    if (userPoints < item.points_required) {
      return res.status(400).json({
        error: `Not enough points. You need ${item.points_required} pts but have ${userPoints} pts.`
      });
    }

    // Check stock (if limited)
    if (item.stock !== -1 && item.stock <= 0) {
      return res.status(400).json({ error: 'This reward is out of stock.' });
    }

    // Generate unique voucher code
    let code;
    let isUnique = false;
    while (!isUnique) {
      code = generateVoucherCode();
      const [existing] = await db.query('SELECT id FROM vouchers WHERE code = ?', [code]);
      if (existing.length === 0) isUnique = true;
    }

    // Set expiry (30 days from now)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    // Insert voucher
    const [vResult] = await db.query(
      `INSERT INTO vouchers (user_id, catalog_item_id, code, expires_at)
       VALUES (?, ?, ?, ?)`,
      [userId, catalog_item_id, code, expiresAt]
    );

    // Deduct points
    await db.query('UPDATE users SET points = points - ? WHERE id = ?', [item.points_required, userId]);

    // Decrement stock if limited
    if (item.stock !== -1) {
      await db.query('UPDATE catalog_items SET stock = stock - 1 WHERE id = ?', [catalog_item_id]);
    }

    // Return the created voucher with item info
    const [voucher] = await db.query(
      `SELECT v.*, ci.name AS item_name, ci.reward_type, ci.reward_value, ci.emoji
       FROM vouchers v
       JOIN catalog_items ci ON v.catalog_item_id = ci.id
       WHERE v.id = ?`,
      [vResult.insertId]
    );

    const [updatedUser] = await db.query('SELECT points FROM users WHERE id = ?', [userId]);

    res.json({
      success:        true,
      voucher:        voucher[0],
      remaining_points: updatedUser[0].points,
    });

  } catch (err) {
    console.error('Redeem error:', err);
    res.status(500).json({ error: 'Redemption failed. Please try again.' });
  }
});

// ── GET /api/rewards/vouchers — user's redeemed vouchers ───────
router.get('/vouchers', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT v.*, ci.name AS item_name, ci.reward_type, ci.reward_value, ci.emoji
       FROM vouchers v
       JOIN catalog_items ci ON v.catalog_item_id = ci.id
       WHERE v.user_id = ?
       ORDER BY v.created_at DESC`,
      [req.user.id]
    );
    res.json({ vouchers: rows });
  } catch (err) {
    console.error('Vouchers error:', err);
    res.status(500).json({ error: 'Failed to fetch vouchers.' });
  }
});

// ── GET /api/rewards/points — current user's points balance ────
router.get('/points', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT points, total_scans FROM users WHERE id = ?',
      [req.user.id]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch points.' });
  }
});

module.exports = router;
