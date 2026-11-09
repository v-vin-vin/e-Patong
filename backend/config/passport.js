const passport      = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const db            = require('./db');
require('dotenv').config();

passport.use(new GoogleStrategy({
  clientID:     process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL:  process.env.GOOGLE_CALLBACK_URL,
}, async (accessToken, refreshToken, profile, done) => {
  try {
    const googleId = profile.id;
    const name     = profile.displayName;
    const email    = profile.emails[0].value;
    const avatar   = profile.photos[0]?.value || null;

    // Check if user exists
    const [rows] = await db.query('SELECT * FROM users WHERE google_id = ?', [googleId]);

    if (rows.length > 0) {
      // Update name/avatar in case they changed
      await db.query(
        'UPDATE users SET name = ?, avatar = ? WHERE google_id = ?',
        [name, avatar, googleId]
      );
      return done(null, rows[0]);
    }

    // Create new user
    const [result] = await db.query(
      'INSERT INTO users (google_id, name, email, avatar) VALUES (?, ?, ?, ?)',
      [googleId, name, email, avatar]
    );

    const [newUser] = await db.query('SELECT * FROM users WHERE id = ?', [result.insertId]);
    return done(null, newUser[0]);

  } catch (err) {
    return done(err, null);
  }
}));

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [id]);
    if (rows.length === 0) return done(null, false);
    done(null, rows[0]);
  } catch (err) {
    done(err, null);
  }
});

module.exports = passport;
