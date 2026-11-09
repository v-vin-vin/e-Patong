require('dotenv').config();
const express        = require('express');
const session        = require('express-session');
const cors           = require('cors');
const path           = require('path');
const passport       = require('./config/passport');

const authRoutes     = require('./routes/auth');
const scanRoutes     = require('./routes/scan');
const rewardsRoutes  = require('./routes/rewards');
const adminRoutes    = require('./routes/admin');
const statsRoutes    = require('./routes/stats');
const { requireAdminPage } = require('./middleware/authMiddleware');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ─────────────────────────────────────────────────
app.use(cors({
  origin:      process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Sessions ───────────────────────────────────────────────────
app.use(session({
  secret:            process.env.SESSION_SECRET || 'epatong_secret',
  resave:            false,
  saveUninitialized: false,
  cookie: {
    secure:   false,   // set true if using HTTPS
    httpOnly: true,
    sameSite: 'lax',   // browser won't send the login cookie on cross-site POSTs
    maxAge:   7 * 24 * 60 * 60 * 1000,  // 7 days
  },
}));

// ── Passport ───────────────────────────────────────────────────
app.use(passport.initialize());
app.use(passport.session());

// ── Admin PAGES (locked) ───────────────────────────────────────
// The admin files live in backend/admin — OUTSIDE the public frontend
// folder — so the ONLY way to reach them is through this guard:
//   not signed in -> sent to Google login, not admin -> "Access denied".
app.use('/admin', requireAdminPage, express.static(path.join(__dirname, 'admin')));

// ── Serve Frontend Static Files ────────────────────────────────
const FRONTEND_PATH = path.join(__dirname, '..', 'frontend');
app.use(express.static(FRONTEND_PATH));

// ── API Routes ─────────────────────────────────────────────────
app.use('/api/auth',    authRoutes);
app.use('/api/scan',    scanRoutes);
app.use('/api/rewards', rewardsRoutes);
app.use('/api/admin',   adminRoutes);   // every route inside is admin-only
app.use('/api/stats',   statsRoutes);   // public: only the 4 overview numbers (counts)

// ── Root → index.html ──────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(FRONTEND_PATH, 'index.html'));
});

// ── 404 fallback ───────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found.' });
});

// ── Start Server ───────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🌿 e-Patong server running at http://localhost:${PORT}`);
  console.log(`   Press Ctrl+C to stop.\n`);
});
