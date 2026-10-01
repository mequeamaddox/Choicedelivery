const express = require('express');
const db = require('../db');
const { requireAuth, requireRole, ROLES } = require('../auth');
const crypto = require('crypto');
const {
  USER_SELECT, publicUser, getUser, createUser, setVehicleType, setVehicle, mergeDriverProfile, driverWorkBlocker, DOC_KINDS,
} = require('../users');
const driverEmails = require('../driver-emails');
const { refreshDriverPay } = require('../orders');

const isImageDataUrl = (v) => typeof v === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v);
const MAX_DOC_BYTES = 4 * 1024 * 1024;

// Drivers (and staff for them) can edit profile fields and vehicle details.
async function saveDriverDetails(client, target, { driverProfile, vehicle }) {
  if (target.role !== 'driver') return;
  if (driverProfile && typeof driverProfile === 'object') {
    await client.query('UPDATE users SET driver_profile = $2, updated_at = now() WHERE id = $1',
      [target.id, JSON.stringify(mergeDriverProfile(target.driver_profile || {}, driverProfile))]);
  }
  if (vehicle && typeof vehicle === 'object') await setVehicle(target.id, vehicle, client);
}
const { asyncH, HttpError, parseLocation, str } = require('../util');

const router = express.Router();
router.use(requireAuth);

const requireUser = (req, res, next) => {
  if (!req.user.id) return next(new HttpError(400, 'Integration keys have no user profile'));
  next();
};

router.get('/me', requireUser, asyncH(async (req, res) => {
  res.json(publicUser(await getUser(req.user.id)));
}));

router.put('/me', requireUser, asyncH(async (req, res) => {
  const { email, name, phoneNumber, vehicleType, profilePictureUrl, emailUpdates, driverProfile, vehicle } = req.body || {};
  await db.withTx(async (client) => {
    try {
      await client.query(
        `UPDATE users SET
           email = COALESCE(NULLIF(lower($1), ''), email),
           name = COALESCE($2, name),
           phone_number = COALESCE($3, phone_number),
           profile_picture_url = COALESCE($4, profile_picture_url),
           email_updates = COALESCE($6, email_updates),
           updated_at = now()
         WHERE id = $5`,
        [str(email), name ?? null, phoneNumber ?? null, profilePictureUrl ?? null, req.user.id,
          typeof emailUpdates === 'boolean' ? emailUpdates : null]
      );
    } catch (e) {
      if (e.code === '23505') throw new HttpError(409, 'That email is already in use');
      throw e;
    }
    if (vehicleType !== undefined && req.user.role === 'driver') await setVehicleType(req.user.id, vehicleType, client);
    await saveDriverDetails(client, await getUser(req.user.id, client), { driverProfile, vehicle });
  });
  res.json(publicUser(await getUser(req.user.id)));
}));

// Drivers upload their profile photo and document photos (license, insurance card, vehicle, registration).
router.put('/me/documents/:kind', requireUser, requireRole('driver'), asyncH(async (req, res) => {
  const { kind } = req.params;
  if (!DOC_KINDS[kind]) throw new HttpError(400, `kind must be one of: ${Object.keys(DOC_KINDS).join(', ')}`);
  const data = req.body?.data;
  if (!isImageDataUrl(data)) throw new HttpError(400, 'Send the photo as a JPEG or PNG image');
  if (data.length > MAX_DOC_BYTES) throw new HttpError(413, 'That photo is too large');
  await db.query(
    `INSERT INTO driver_documents (user_id, kind, data) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, kind) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`, [req.user.id, kind, data]);
  res.json(publicUser(await getUser(req.user.id)));
}));

// A driver's document photo: the driver themself, or staff reviewing them.
router.get('/:id/documents/:kind', asyncH(async (req, res) => {
  const self = req.user.id === req.params.id;
  if (!self && !['admin', 'dispatcher'].includes(req.user.role)) throw new HttpError(403, 'Not allowed');
  const { rows } = await db.query('SELECT kind, data, updated_at FROM driver_documents WHERE user_id = $1 AND kind = $2',
    [req.params.id, req.params.kind]).catch(() => ({ rows: [] }));
  if (!rows[0]) throw new HttpError(404, 'No photo uploaded yet');
  res.json({ kind: rows[0].kind, label: DOC_KINDS[rows[0].kind], data: rows[0].data, updatedAt: rows[0].updated_at });
}));

router.put('/me/push-token', requireUser, asyncH(async (req, res) => {
  await db.query('UPDATE users SET push_token = $1 WHERE id = $2', [req.body?.token || null, req.user.id]);
  res.json({ ok: true });
}));

// Drivers report where they are so dispatch and shippers can track them.
router.put('/me/location', requireUser, requireRole('driver'), asyncH(async (req, res) => {
  const location = parseLocation(req.body);
  if (!location) throw new HttpError(400, 'lat and lng are required');
  await db.query(
    'UPDATE users SET last_location = $1, location_updated_at = now() WHERE id = $2',
    [JSON.stringify(location), req.user.id]
  );
  res.json({ ok: true });
}));

router.put('/me/availability', requireUser, requireRole('driver'), asyncH(async (req, res) => {
  if (req.body?.online) {
    const blocker = driverWorkBlocker(await getUser(req.user.id));
    if (blocker) throw new HttpError(409, blocker);
  }
  await db.query('UPDATE users SET is_online = $1 WHERE id = $2', [!!req.body?.online, req.user.id]);
  res.json({ online: !!req.body?.online });
}));

// ---- Staff: manage people ----

// Staff invite a driver by email: the account is approved, and the email has a link to choose a
// password (valid 7 days) and to get the app.
router.post('/invite', requireRole('admin', 'dispatcher'), asyncH(async (req, res) => {
  const b = req.body || {};
  if (!str(b.name)) throw new HttpError(400, 'Name is required');
  const { user, token } = await db.withTx(async (client) => {
    const u = await createUser({ email: b.email, password: crypto.randomBytes(24).toString('hex'), name: b.name,
      phoneNumber: b.phoneNumber, role: 'driver' }, client);
    if (b.vehicleType) await setVehicle(u.id, { type: b.vehicleType }, client);
    const t = crypto.randomBytes(32).toString('hex');
    await client.query(
      "UPDATE users SET reset_token_hash = $2, reset_token_expires = now() + interval '7 days' WHERE id = $1",
      [u.id, crypto.createHash('sha256').update(t).digest('hex')]);
    return { user: await getUser(u.id, client), token: t };
  });
  driverEmails.invite(user, token);
  res.status(201).json(publicUser(user, { includeLocation: true }));
}));

// Staff approve, reject, suspend or reinstate a driver. The driver is emailed.
router.post('/:id/review', requireRole('admin', 'dispatcher'), asyncH(async (req, res) => {
  const { status, note } = req.body || {};
  if (!['approved', 'rejected', 'suspended'].includes(status)) throw new HttpError(400, 'status must be approved, rejected or suspended');
  const target = await getUser(req.params.id).catch(() => null);
  if (!target || target.role !== 'driver') throw new HttpError(404, 'Driver not found');
  await db.query(
    `UPDATE users SET driver_status = $2, review_note = $3, reviewed_at = now(), reviewed_by = $4,
       is_online = CASE WHEN $2 = 'approved' THEN is_online ELSE false END, updated_at = now() WHERE id = $1`,
    [target.id, status, str(note).slice(0, 500), req.user.id]);
  const updated = await getUser(target.id);
  if (status !== target.driver_status) {
    if (status === 'approved') driverEmails.approved(updated);
    else if (status === 'rejected') driverEmails.rejected(updated, str(note));
    else driverEmails.suspended(updated, str(note));
  }
  res.json(publicUser(updated, { includeLocation: true }));
}));

// GET /users?role=driver&online=true
router.get('/', requireRole('admin', 'dispatcher'), asyncH(async (req, res) => {
  const params = [];
  const where = [];
  if (req.query.role) { params.push(req.query.role); where.push(`u.role = $${params.length}`); }
  if (req.query.online === 'true') where.push('u.is_online');
  if (req.query.organizationId) { params.push(req.query.organizationId); where.push(`u.organization_id = $${params.length}`); }
  const { rows } = await db.query(
    `${USER_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY u.created_at`, params);
  res.json(rows.map((u) => publicUser(u, { includeLocation: true })));
}));

router.get('/:id', requireRole('admin', 'dispatcher'), asyncH(async (req, res) => {
  const user = await getUser(req.params.id).catch(() => null);
  if (!user) throw new HttpError(404, 'User not found');
  res.json(publicUser(user, { includeLocation: true }));
}));

// Admins can change role/company/active; dispatchers can only (de)activate drivers and shippers.
router.patch('/:id', requireRole('admin', 'dispatcher'), asyncH(async (req, res) => {
  const target = await getUser(req.params.id).catch(() => null);
  if (!target) throw new HttpError(404, 'User not found');
  const { role, organizationId, isActive, name, phoneNumber, vehicleType, driverProfile, vehicle } = req.body || {};
  // Staff can fix a typo in someone's email (it's how they sign in). Staff accounts' emails: admins only.
  const email = req.body?.email === undefined ? undefined : str(req.body.email).toLowerCase();
  if (email !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address');
  const noDriverPay = typeof req.body?.noDriverPay === 'boolean' ? req.body.noDriverPay : undefined;
  if (noDriverPay !== undefined && target.role !== 'driver') throw new HttpError(400, 'Only drivers have driver pay');
  if (req.user.role !== 'admin') {
    if (noDriverPay !== undefined) throw new HttpError(403, 'Only admins can change who gets driver pay');
    if (['admin', 'dispatcher'].includes(target.role) || role !== undefined || organizationId !== undefined) {
      // (covers changing a staff member's email too)
      throw new HttpError(403, 'Only admins can change roles or companies');
    }
  }
  if (role !== undefined && !ROLES.includes(role)) throw new HttpError(400, `role must be one of: ${ROLES.join(', ')}`);
  if (target.id === req.user.id && (isActive === false || (role && role !== 'admin'))) {
    throw new HttpError(400, "You can't disable or demote your own account");
  }
  await db.withTx(async (client) => {
    try {
      await client.query(
        `UPDATE users SET role = COALESCE($2, role),
           organization_id = CASE WHEN $3::boolean THEN $4::uuid ELSE organization_id END,
           is_active = COALESCE($5, is_active), name = COALESCE($6, name),
           phone_number = COALESCE($7, phone_number), email = COALESCE($8, email), updated_at = now()
         WHERE id = $1`,
        [target.id, role ?? null, organizationId !== undefined, organizationId || null,
          isActive ?? null, name ?? null, phoneNumber ?? null, email ?? null]
      );
    } catch (e) {
      if (e.code === '23505') throw new HttpError(409, 'That email is already used by another account');
      if (e.code === '23514') throw new HttpError(400, 'Shipper accounts need an organizationId');
      if (e.code === '23503') throw new HttpError(400, 'Organization not found');
      throw e;
    }
    if (vehicleType !== undefined) await setVehicleType(target.id, vehicleType, client);
    await saveDriverDetails(client, target, { driverProfile, vehicle });
    if (noDriverPay !== undefined) {
      await client.query('UPDATE users SET no_driver_pay = $2 WHERE id = $1', [target.id, noDriverPay]);
      // Their orders not yet paid out follow the new setting (custom amounts set by hand are kept).
      const { rows } = await client.query(
        "SELECT id FROM orders WHERE driver_id = $1 AND driver_paid_at IS NULL AND status <> 'cancelled'", [target.id]);
      for (const r of rows) await refreshDriverPay(client, r.id);
    }
  });
  res.json(publicUser(await getUser(target.id), { includeLocation: true }));
}));

module.exports = router;
