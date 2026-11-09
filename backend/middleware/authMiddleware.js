// Blocks unauthenticated users — use on protected routes
const requireAuth = (req, res, next) => {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }
  return res.status(401).json({ error: 'Unauthorized. Please log in with Google.' });
};

// Attaches user if logged in, but allows guests — use on scan save
const optionalAuth = (req, res, next) => {
  next();
};

// ── ADMIN LOCKS ────────────────────────────────────────────────
// Passport loads the user from the database on EVERY request
// (see deserializeUser in config/passport.js), so req.user.role is
// always the current value in the database. If you change someone's
// role in the database, it takes effect on their very next click.
const isSignedIn = (req) => !!(req.isAuthenticated && req.isAuthenticated());
const isAdmin    = (req) => isSignedIn(req) && !!req.user && req.user.role === 'admin';

// For admin API routes (/api/admin/...). Answers with JSON.
//   not signed in     -> 401
//   signed in, no admin -> 403
const requireAdmin = (req, res, next) => {
  if (!isSignedIn(req)) {
    return res.status(401).json({ error: 'Unauthorized. Please log in with Google.' });
  }
  if (!isAdmin(req)) {
    return res.status(403).json({ error: 'Access denied. Admins only.' });
  }
  return next();
};

// For admin PAGES (/admin/...). Answers with a page.
//   not signed in     -> send to the login (Google sign-in)
//   signed in, no admin -> "Access denied" page
const ACCESS_DENIED_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Access denied — e-Patong</title>
  <link rel="stylesheet" href="/css/style.css">
</head>
<body>
  <div class="container section" style="padding-top:5rem;text-align:center">
    <div style="font-size:3.5rem;margin-bottom:1rem">🚫</div>
    <h1 style="color:var(--white)">Access denied</h1>
    <p class="mt-2">This area is for e-Patong admins only.</p>
    <div class="mt-4"><a href="/" class="btn btn-primary">← Back to Home</a></div>
  </div>
</body>
</html>`;

const requireAdminPage = (req, res, next) => {
  // Stop the browser from keeping admin pages (e.g. Back button after logout).
  res.set('Cache-Control', 'no-store');

  if (!isSignedIn(req)) {
    return res.redirect('/api/auth/google');
  }
  if (!isAdmin(req)) {
    return res.status(403).type('html').send(ACCESS_DENIED_HTML);
  }
  return next();
};

module.exports = { requireAuth, optionalAuth, requireAdmin, requireAdminPage };
