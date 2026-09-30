const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('./db');
const { signToken, requireAuth, requireAdmin } = require('./auth');
const { sendMail } = require('./mailer');

const router = express.Router();
const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

function publicUser(u) {
  return {
    id: u.id,
    email: u.email,
    role: u.role,
    phoneNumber: u.phone_number,
    vehicleType: u.vehicle_type,
    profilePictureUrl: u.profile_picture_url,
  };
}

async function createUser({ email, password, role = 'driver' }) {
  if (!email || !password) {
    const err = new Error('Email and password are required'); err.status = 400; throw err;
  }
  if (password.length < 8) {
    const err = new Error('Password must be at least 8 characters'); err.status = 400; throw err;
  }
  const hash = await bcrypt.hash(password, 10);
  try {
    const { rows } = await db.query(
      'INSERT INTO users (email, password_hash, role) VALUES (lower($1), $2, $3) RETURNING *',
      [email.trim(), hash, role]
    );
    return rows[0];
  } catch (e) {
    if (e.code === '23505') { const err = new Error('An account with that email already exists'); err.status = 409; throw err; }
    throw e;
  }
}

router.post('/login', asyncH(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ message: 'Email and password are required' });
  const { rows } = await db.query('SELECT * FROM users WHERE email = lower($1)', [email.trim()]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ message: 'Invalid email or password' });
  }
  res.json({ token: signToken(user), user: publicUser(user) });
}));

router.get('/me', requireAuth, asyncH(async (req, res) => {
  const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  if (!rows[0]) return res.status(401).json({ message: 'Account no longer exists' });
  res.json({ user: publicUser(rows[0]) });
}));

// Creates an account. The very first account may be created without auth (and becomes admin);
// after that only admins can add users. Drivers do not self-register.
router.post('/register', asyncH(async (req, res, next) => {
  const { rows } = await db.query('SELECT count(*)::int AS n FROM users');
  if (rows[0].n === 0) {
    const user = await createUser({ ...req.body, role: 'admin' });
    return res.status(201).json({ token: signToken(user), user: publicUser(user) });
  }
  requireAuth(req, res, () => requireAdmin(req, res, async () => {
    try {
      const role = req.body?.role === 'admin' ? 'admin' : 'driver';
      const user = await createUser({ ...req.body, role });
      res.status(201).json({ user: publicUser(user) });
    } catch (e) { next(e); }
  }));
}));

router.post('/forgot-password', asyncH(async (req, res) => {
  const email = (req.body?.email || '').trim();
  // Always respond the same way so this can't be used to discover accounts.
  const ok = { message: 'If that email has an account, a reset link has been sent.' };
  if (!email) return res.json(ok);
  const { rows } = await db.query('SELECT id, email FROM users WHERE email = lower($1)', [email]);
  if (!rows[0]) return res.json(ok);

  const token = crypto.randomBytes(32).toString('hex');
  await db.query(
    "UPDATE users SET reset_token_hash = $1, reset_token_expires = now() + interval '1 hour' WHERE id = $2",
    [hashToken(token), rows[0].id]
  );
  const base = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  const link = `${base}/reset-password?token=${token}`;
  await sendMail({
    to: rows[0].email,
    subject: 'Reset your Choice Delivery password',
    html: `<p>Click the link below to choose a new password. It expires in 1 hour.</p><p><a href="${link}">${link}</a></p>`,
  });
  res.json(ok);
}));

router.post('/reset-password', asyncH(async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password || password.length < 8) {
    return res.status(400).json({ message: 'A valid token and a password of at least 8 characters are required' });
  }
  const hash = await bcrypt.hash(password, 10);
  const { rowCount } = await db.query(
    `UPDATE users SET password_hash = $1, reset_token_hash = NULL, reset_token_expires = NULL, updated_at = now()
     WHERE reset_token_hash = $2 AND reset_token_expires > now()`,
    [hash, hashToken(token)]
  );
  if (!rowCount) return res.status(400).json({ message: 'This reset link is invalid or has expired' });
  res.json({ message: 'Password updated. You can now log in from the app.' });
}));

module.exports = { router, publicUser, createUser };
