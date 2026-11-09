const express  = require('express');
const passport = require('../config/passport');
const router   = express.Router();
require('dotenv').config();

const FRONTEND = process.env.FRONTEND_URL || 'http://localhost:3000';

// ── Initiate Google Login ──────────────────────────────────────
// prompt: 'select_account' makes Google show its account chooser every
// time, so after logging out the user must pick (or type, via
// "Use another account") their Google account again instead of being
// signed straight back in by the browser's remembered Google session.
router.get('/google', passport.authenticate('google', {
  scope:  ['profile', 'email'],
  prompt: 'select_account',
}));

// ── Google OAuth Callback ──────────────────────────────────────
router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: `${FRONTEND}/pages/scan.html?auth=failed` }),
  (req, res) => {
    res.redirect(`${FRONTEND}/pages/dashboard.html`);
  }
);

// ── Logout ─────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  res.set('Cache-Control', 'no-store');
  req.logout((err) => {
    if (err) return res.status(500).json({ error: 'Logout failed' });
    const finish = () => {
      res.clearCookie('connect.sid', { path: '/', httpOnly: true });
      res.json({ success: true });
    };
    if (req.session) {
      req.session.destroy(finish);
    } else {
      finish();
    }
  });
});

// ── Get Current User ───────────────────────────────────────────
router.get('/me', (req, res) => {
  // Never let the browser reuse an old "logged in" answer after logout.
  res.set('Cache-Control', 'no-store');
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.json({ user: null });
  }
  const { id, name, email, avatar, role, points, total_scans, created_at } = req.user;
  res.json({ user: { id, name, email, avatar, role, points, total_scans, created_at } });
});

module.exports = router;
