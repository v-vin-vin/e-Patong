// ============================================================
// e-Patong — Overview numbers
//
// ONE function that counts the four overview numbers:
//   users, scans, vouchers, points given
//
// It is used by BOTH:
//   - Admin panel → Overview   (routes/admin.js,  admin only)
//   - Homepage numbers         (routes/stats.js,  public)
// so the two places can never show different numbers.
//
// Only COUNTS and SUMS are returned. No names, no emails, nothing personal.
// ============================================================
const db = require('./db');

async function getOverviewStats() {
  const [[users]] = await db.query('SELECT COUNT(*) AS total FROM users');

  // Finished scans only (a LOW scan, or a MEDIUM scan nobody picked, is not a finished scan)
  const [[scans]] = await db.query(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(points_earned), 0) AS points_given,
            COALESCE(SUM(is_guest), 0)      AS guest_scans
       FROM scans
      WHERE item_name IS NOT NULL`
  );

  const [[vouchers]] = await db.query(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(status = 'used'), 0) AS used
       FROM vouchers`
  );

  return {
    users:        Number(users.total),
    scans:        Number(scans.total),
    guestScans:   Number(scans.guest_scans),
    vouchers:     Number(vouchers.total),
    vouchersUsed: Number(vouchers.used),
    pointsGiven:  Number(scans.points_given),
  };
}

module.exports = { getOverviewStats };
