const express = require('express');
const db = require('./db');
const { requireAuth, requireAdmin } = require('./auth');
const { publicUser } = require('./routes-auth');

const router = express.Router();
const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);

router.use(requireAuth);

router.get('/me', asyncH(async (req, res) => {
  const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  if (!rows[0]) return res.status(404).json({ message: 'Driver not found' });
  res.json(publicUser(rows[0]));
}));

router.put('/me', asyncH(async (req, res) => {
  const { email, phoneNumber, vehicleType, profilePictureUrl } = req.body || {};
  try {
    const { rows } = await db.query(
      `UPDATE users SET
         email = COALESCE(NULLIF(lower(trim($1)), ''), email),
         phone_number = COALESCE($2, phone_number),
         vehicle_type = COALESCE($3, vehicle_type),
         profile_picture_url = COALESCE($4, profile_picture_url),
         updated_at = now()
       WHERE id = $5 RETURNING *`,
      [email ?? '', phoneNumber ?? null, vehicleType ?? null, profilePictureUrl ?? null, req.user.id]
    );
    res.json(publicUser(rows[0]));
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ message: 'That email is already in use' });
    throw e;
  }
}));

router.put('/me/push-token', asyncH(async (req, res) => {
  await db.query('UPDATE users SET push_token = $1 WHERE id = $2', [req.body?.token || null, req.user.id]);
  res.json({ ok: true });
}));

router.get('/', requireAdmin, asyncH(async (req, res) => {
  const { rows } = await db.query('SELECT * FROM users ORDER BY created_at');
  res.json(rows.map(publicUser));
}));

router.delete('/:id', requireAdmin, asyncH(async (req, res) => {
  await db.query('DELETE FROM users WHERE id = $1', [req.params.id]);
  res.status(204).end();
}));

module.exports = router;
