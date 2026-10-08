const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signToken, requireAuth, isStaff } = require('../auth');
const { publicUser, getUser, createUser, setVehicle, mergeDriverProfile } = require('../users');
const driverEmails = require('../driver-emails');
const { rateLimit } = require('../rate-limit');
const { sendMail } = require('../mailer');
const { asyncH, HttpError, str } = require('../util');
const { cleanAttribution, logEvent } = require('../attribution');

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
  const attribution = cleanAttribution(req.body?.attribution);
  const user = await db.withTx(async (client) => {
    const { rows } = await client.query(
      'INSERT INTO organizations (name, phone, billing_email) VALUES ($1, $2, lower($3)) RETURNING id',
      [str(companyName), str(phoneNumber), str(email)]
    );
    const u = await createUser({ email, password, name, phoneNumber, role: 'shipper', organizationId: rows[0].id }, client);
    if (attribution) await client.query('UPDATE users SET attribution = $2 WHERE id = $1', [u.id, attribution]);
    return u;
  });
  logEvent('signup', attribution, { userId: user.id, organizationId: user.organization_id });
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
}));

// "Apply to drive": creates a driver account waiting for review. The driver can sign in right away to
// finish their profile (photo, license, insurance), but sees no jobs until staff approve them.
router.post('/driver-signup', rateLimit({ windowMs: 10 * 60 * 1000, max: 6 }), asyncH(async (req, res) => {
  const b = req.body || {};
  if (!str(b.name)) throw new HttpError(400, 'Please enter your name');
  if (!str(b.phoneNumber)) throw new HttpError(400, 'Please enter your phone number');
  if (!str(b.vehicle?.type)) throw new HttpError(400, 'Please choose your vehicle type');
  if (b.agreed !== true) {
    throw new HttpError(400, 'Please confirm you have a valid license and insurance and agree to the driver terms');
  }
  const attribution = cleanAttribution(b.attribution);
  const user = await db.withTx(async (client) => {
    const u = await createUser({ email: b.email, password: b.password, name: b.name, phoneNumber: b.phoneNumber,
      role: 'driver', driverStatus: 'applied' }, client);
    await setVehicle(u.id, b.vehicle, client);
    const profile = { ...mergeDriverProfile({}, { city: b.city, zip: b.zip }), agreedAt: new Date().toISOString() };
    await client.query('UPDATE users SET driver_profile = $2, attribution = $3 WHERE id = $1',
      [u.id, JSON.stringify(profile), attribution]);
    return getUser(u.id, client);
  });
  logEvent('driver_signup', attribution, { userId: user.id });
  driverEmails.applicationReceived(user);
  driverEmails.newApplication(user);
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
}));

// Creates any kind of account. The very first account may be created without auth and
// becomes an admin; after that, admins create any role and dispatchers create drivers/shippers.
// Tells the web app whether the one-time owner setup screen should be shown.
router.get('/setup-status', asyncH(async (req, res) => {
  const { rows } = await db.query('SELECT EXISTS (SELECT 1 FROM users) AS has_users');
  res.json({ needsSetup: !rows[0].has_users });
}));

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
  const link = `${base}/#/reset/${token}`;
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
