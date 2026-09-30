const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signToken, requireAuth, isStaff } = require('../auth');
const { publicUser, getUser, createUser } = require('../users');
const { sendMail } = require('../mailer');
const { asyncH, HttpError, str } = require('../util');

const router = express.Router();
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

router.post('/login', asyncH(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) throw new HttpError(400, 'Email and password are required');
  const { rows } = await db.query('SELECT id, password_hash, is_active FROM users WHERE email = lower($1)', [str(email)]);
  const row = rows[0];
  if (!row || !(await bcrypt.compare(String(password), row.password_hash))) {
    throw new HttpError(401, 'Invalid email or password');
  }
  if (!row.is_active) throw new HttpError(403, 'This account has been disabled');
  const user = await getUser(row.id);
  res.json({ token: signToken(user), user: publicUser(user) });
}));

router.get('/me', requireAuth, asyncH(async (req, res) => {
  if (!req.user.id) throw new HttpError(400, 'Integration keys have no user profile');
  res.json({ user: publicUser(await getUser(req.user.id)) });
}));

// Self-serve signup for shipping customers: creates their company and their first user.
router.post('/signup', asyncH(async (req, res) => {
  const { companyName, name, email, password, phoneNumber } = req.body || {};
  if (!str(companyName)) throw new HttpError(400, 'companyName is required');
  const user = await db.withTx(async (client) => {
    const { rows } = await client.query(
      'INSERT INTO organizations (name, phone, billing_email) VALUES ($1, $2, lower($3)) RETURNING id',
      [str(companyName), str(phoneNumber), str(email)]
    );
    return createUser({ email, password, name, phoneNumber, role: 'shipper', organizationId: rows[0].id }, client);
  });
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
}));

// Creates any kind of account. The very first account may be created without auth and
// becomes an admin; after that, admins create any role and dispatchers create drivers/shippers.
router.post('/register', asyncH(async (req, res, next) => {
  const { rows } = await db.query('SELECT count(*)::int AS n FROM users');
  if (rows[0].n === 0) {
    const user = await createUser({ ...req.body, role: 'admin', organizationId: null });
    return res.status(201).json({ token: signToken(user), user: publicUser(user) });
  }
  await requireAuth(req, res, async () => {
    try {
      if (!isStaff(req.user)) throw new HttpError(403, 'Only admins and dispatchers can create accounts');
      const role = req.body?.role || 'driver';
      if (req.user.role !== 'admin' && ['admin', 'dispatcher'].includes(role)) {
        throw new HttpError(403, 'Only admins can create admin or dispatcher accounts');
      }
      const user = await createUser({ ...req.body, role, organizationId: req.body?.organizationId || null });
      res.status(201).json({ user: publicUser(user) });
    } catch (e) { next(e); }
  });
}));

router.post('/change-password', requireAuth, asyncH(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!req.user.id) throw new HttpError(400, 'Integration keys have no password');
  if (!newPassword || String(newPassword).length < 8) throw new HttpError(400, 'New password must be at least 8 characters');
  const { rows } = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (!rows[0] || !(await bcrypt.compare(String(currentPassword || ''), rows[0].password_hash))) {
    throw new HttpError(400, 'Current password is incorrect');
  }
  await db.query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2',
    [await bcrypt.hash(String(newPassword), 10), req.user.id]);
  res.json({ message: 'Password changed.' });
}));

router.post('/forgot-password', asyncH(async (req, res) => {
  const email = str(req.body?.email);
  // Always respond the same way so this can't be used to discover accounts.
  const ok = { message: 'If that email has an account, a reset link has been sent.' };
  if (!email) return res.json(ok);
  const { rows } = await db.query('SELECT id, email FROM users WHERE email = lower($1) AND is_active', [email]);
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
  if (!token || !password || String(password).length < 8) {
    throw new HttpError(400, 'A valid token and a password of at least 8 characters are required');
  }
  const hash = await bcrypt.hash(String(password), 10);
  const { rowCount } = await db.query(
    `UPDATE users SET password_hash = $1, reset_token_hash = NULL, reset_token_expires = NULL, updated_at = now()
     WHERE reset_token_hash = $2 AND reset_token_expires > now()`,
    [hash, hashToken(String(token))]
  );
  if (!rowCount) throw new HttpError(400, 'This reset link is invalid or has expired');
  res.json({ message: 'Password updated. You can now log in.' });
}));

module.exports = router;
