const express = require('express');
const db = require('../db');
const { requireAuth, requireRole, ROLES } = require('../auth');
const { USER_SELECT, publicUser, getUser, setVehicleType } = require('../users');
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
  const { email, name, phoneNumber, vehicleType, profilePictureUrl, emailUpdates } = req.body || {};
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
  });
  res.json(publicUser(await getUser(req.user.id)));
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
  await db.query('UPDATE users SET is_online = $1 WHERE id = $2', [!!req.body?.online, req.user.id]);
  res.json({ online: !!req.body?.online });
}));

// ---- Staff: manage people ----

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
  const { role, organizationId, isActive, name, phoneNumber, vehicleType } = req.body || {};
  if (req.user.role !== 'admin') {
    if (['admin', 'dispatcher'].includes(target.role) || role !== undefined || organizationId !== undefined) {
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
           phone_number = COALESCE($7, phone_number), updated_at = now()
         WHERE id = $1`,
        [target.id, role ?? null, organizationId !== undefined, organizationId || null,
          isActive ?? null, name ?? null, phoneNumber ?? null]
      );
    } catch (e) {
      if (e.code === '23514') throw new HttpError(400, 'Shipper accounts need an organizationId');
      if (e.code === '23503') throw new HttpError(400, 'Organization not found');
      throw e;
    }
    if (vehicleType !== undefined) await setVehicleType(target.id, vehicleType, client);
  });
  res.json(publicUser(await getUser(target.id), { includeLocation: true }));
}));

module.exports = router;
