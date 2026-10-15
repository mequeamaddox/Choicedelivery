// Customers make and revoke API keys for their own systems; staff see and can revoke every key.
const express = require('express');
const db = require('../db');
const { requireAuth, isStaff, newApiKey } = require('../auth');
const { asyncH, HttpError, str } = require('../util');

const router = express.Router();
router.use(requireAuth);
router.use((req, res, next) => {
  if (!req.user.id) return next(new HttpError(400, 'Integration keys have no API keys'));
  if (!isStaff(req.user) && req.user.role !== 'shipper') return next(new HttpError(403, 'API keys are for customer accounts'));
  next();
});

const keyJson = (k) => ({
  id: k.id, name: k.name, prefix: k.prefix, createdAt: k.created_at, lastUsedAt: k.last_used_at, revokedAt: k.revoked_at,
  ...(k.user_email ? { user: { name: k.user_name, email: k.user_email }, company: k.company_name } : {}),
});

router.get('/', asyncH(async (req, res) => {
  if (isStaff(req.user)) {
    const { rows } = await db.query(
      `SELECT k.*, u.name AS user_name, u.email AS user_email, o.name AS company_name
       FROM api_keys k JOIN users u ON u.id = k.user_id LEFT JOIN organizations o ON o.id = u.organization_id
       WHERE k.revoked_at IS NULL ORDER BY k.created_at DESC`);
    return res.json(rows.map(keyJson));
  }
  const { rows } = await db.query(
    'SELECT * FROM api_keys WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC', [req.user.id]);
  res.json(rows.map(keyJson));
}));

// The key is in this response only; it can't be shown again.
router.post('/', asyncH(async (req, res) => {
  if (req.user.role !== 'shipper') throw new HttpError(403, 'API keys are made from a customer account');
  const { rows: [{ n }] } = await db.query(
    'SELECT count(*)::int AS n FROM api_keys WHERE user_id = $1 AND revoked_at IS NULL', [req.user.id]);
  if (n >= 5) throw new HttpError(409, 'You already have 5 keys. Revoke one you no longer use first.');
  const { key, prefix, hash } = newApiKey();
  const { rows: [k] } = await db.query(
    'INSERT INTO api_keys (user_id, name, prefix, key_hash) VALUES ($1, $2, $3, $4) RETURNING *',
    [req.user.id, str(req.body?.name).slice(0, 80) || 'API key', prefix, hash]);
  res.status(201).json({ ...keyJson(k), key });
}));

router.delete('/:id', asyncH(async (req, res) => {
  const { rowCount } = await db.query(
    `UPDATE api_keys SET revoked_at = now() WHERE id::text = $1 AND revoked_at IS NULL AND ($2 OR user_id = $3)`,
    [req.params.id, isStaff(req.user), req.user.id]);
  if (!rowCount) throw new HttpError(404, 'Key not found');
  res.json({ ok: true });
}));

module.exports = router;
