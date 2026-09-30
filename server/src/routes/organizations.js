const express = require('express');
const db = require('../db');
const { requireAuth, requireRole, isStaff } = require('../auth');
const { asyncH, HttpError, str } = require('../util');
const { createUser, publicUser } = require('../users');

const router = express.Router();
router.use(requireAuth);

const serialize = (o) => ({
  id: o.id, name: o.name, phone: o.phone, billingEmail: o.billing_email, address: o.address,
  createdAt: o.created_at, isDemo: o.is_demo,
});

function canAccess(user, orgId) {
  return isStaff(user) || (user.role === 'shipper' && user.organization_id === orgId);
}

router.get('/', asyncH(async (req, res) => {
  if (isStaff(req.user)) {
    const { rows } = await db.query('SELECT * FROM organizations ORDER BY name');
    return res.json(rows.map(serialize));
  }
  if (req.user.role !== 'shipper') throw new HttpError(403, 'Not allowed for your account type');
  const { rows } = await db.query('SELECT * FROM organizations WHERE id = $1', [req.user.organization_id]);
  res.json(rows.map(serialize));
}));

router.post('/', requireRole('admin', 'dispatcher'), asyncH(async (req, res) => {
  const { name, phone, billingEmail, address } = req.body || {};
  if (!str(name)) throw new HttpError(400, 'name is required');
  const { rows } = await db.query(
    'INSERT INTO organizations (name, phone, billing_email, address) VALUES ($1, $2, lower($3), $4) RETURNING *',
    [str(name), str(phone), str(billingEmail), str(address)]
  );
  res.status(201).json(serialize(rows[0]));
}));

router.get('/:id', asyncH(async (req, res) => {
  if (!canAccess(req.user, req.params.id)) throw new HttpError(404, 'Organization not found');
  const { rows } = await db.query('SELECT * FROM organizations WHERE id = $1', [req.params.id]).catch(() => ({ rows: [] }));
  if (!rows[0]) throw new HttpError(404, 'Organization not found');
  res.json(serialize(rows[0]));
}));

router.patch('/:id', asyncH(async (req, res) => {
  if (!canAccess(req.user, req.params.id)) throw new HttpError(404, 'Organization not found');
  const { name, phone, billingEmail, address } = req.body || {};
  const { rows } = await db.query(
    `UPDATE organizations SET name = COALESCE(NULLIF($2, ''), name), phone = COALESCE($3, phone),
       billing_email = COALESCE(lower($4), billing_email), address = COALESCE($5, address), updated_at = now()
     WHERE id = $1 RETURNING *`,
    [req.params.id, str(name), phone ?? null, billingEmail ?? null, address ?? null]
  );
  if (!rows[0]) throw new HttpError(404, 'Organization not found');
  res.json(serialize(rows[0]));
}));

// Shippers can see who else at their company has access.
router.get('/:id/users', asyncH(async (req, res) => {
  if (!canAccess(req.user, req.params.id)) throw new HttpError(404, 'Organization not found');
  const { rows } = await db.query(
    'SELECT id, email, name, phone_number, is_active FROM users WHERE organization_id = $1 ORDER BY created_at',
    [req.params.id]
  );
  res.json(rows.map((u) => ({ id: u.id, email: u.email, name: u.name, phoneNumber: u.phone_number, isActive: u.is_active })));
}));

// Add a coworker to a shipper company (shippers for their own company, or staff).
router.post('/:id/users', asyncH(async (req, res) => {
  if (!canAccess(req.user, req.params.id)) throw new HttpError(404, 'Organization not found');
  const { email, password, name, phoneNumber } = req.body || {};
  const user = await createUser({ email, password, name, phoneNumber, role: 'shipper', organizationId: req.params.id });
  res.status(201).json(publicUser(user));
}));

module.exports = router;
