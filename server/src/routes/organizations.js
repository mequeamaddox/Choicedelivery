const express = require('express');
const db = require('../db');
const { requireAuth, requireRole, isStaff } = require('../auth');
const { asyncH, HttpError, str } = require('../util');
const crypto = require('crypto');
const { createUser, publicUser } = require('../users');
const { inviteCustomer } = require('../notify');

const router = express.Router();
router.use(requireAuth);

const serialize = (o) => ({
  id: o.id, name: o.name, phone: o.phone, billingEmail: o.billing_email, address: o.address,
  createdAt: o.created_at, isDemo: o.is_demo, billingMode: o.billing_mode, isMedical: !!o.is_medical,
  paymentTermsDays: o.payment_terms_days,
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
  const { name, phone, billingEmail, address, billingMode = 'card', paymentTermsDays = 30, isMedical = false } = req.body || {};
  if (!str(name)) throw new HttpError(400, 'name is required');
  if (!['card', 'invoice'].includes(billingMode)) throw new HttpError(400, 'billingMode must be card or invoice');
  if (![0, 15, 30, 45, 60].includes(paymentTermsDays)) throw new HttpError(400, 'paymentTermsDays must be 0, 15, 30, 45 or 60');
  const { rows } = await db.query(
    `INSERT INTO organizations (name, phone, billing_email, address, billing_mode, payment_terms_days, is_medical)
     VALUES ($1, $2, lower($3), $4, $5, $6, $7) RETURNING *`,
    [str(name), str(phone), str(billingEmail), str(address), billingMode, paymentTermsDays, isMedical === true]
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
  const { name, phone, billingEmail, address, billingMode, isMedical, paymentTermsDays } = req.body || {};
  if (paymentTermsDays !== undefined) {
    if (!isStaff(req.user)) throw new HttpError(403, 'Only dispatch can change payment terms');
    if (![0, 15, 30, 45, 60].includes(paymentTermsDays)) throw new HttpError(400, 'paymentTermsDays must be 0, 15, 30, 45 or 60');
  }
  if (isMedical !== undefined && (!isStaff(req.user) || typeof isMedical !== 'boolean')) {
    throw new HttpError(isStaff(req.user) ? 400 : 403, 'Only dispatch can mark a company as a medical facility');
  }
  if (billingMode !== undefined) {
    if (!isStaff(req.user)) throw new HttpError(403, 'Only dispatch can change how a company is billed');
    if (!['card', 'invoice'].includes(billingMode)) throw new HttpError(400, 'billingMode must be card or invoice');
  }
  const { rows } = await db.query(
    `UPDATE organizations SET name = COALESCE(NULLIF($2, ''), name), phone = COALESCE($3, phone),
       billing_email = COALESCE(lower($4), billing_email), address = COALESCE($5, address),
       billing_mode = COALESCE($6, billing_mode), is_medical = COALESCE($7, is_medical),
       payment_terms_days = COALESCE($8, payment_terms_days), updated_at = now()
     WHERE id = $1 RETURNING *`,
    [req.params.id, str(name), phone ?? null, billingEmail ?? null, address ?? null, billingMode ?? null, isMedical ?? null, paymentTermsDays ?? null]
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

// Invite someone to a company: dispatch adding a new company's contact, or a customer adding a coworker
// from their Team page. They get an email to choose their own password (the link works for 7 days).
router.post('/:id/invite', asyncH(async (req, res) => {
  if (!canAccess(req.user, req.params.id)) throw new HttpError(404, 'Organization not found');
  const b = req.body || {};
  if (!str(b.name)) throw new HttpError(400, 'Enter their name');
  const { rows: [org] } = await db.query('SELECT name, billing_mode FROM organizations WHERE id = $1', [req.params.id]);
  if (!org) throw new HttpError(404, 'Organization not found');
  const token = crypto.randomBytes(32).toString('hex');
  const user = await db.withTx(async (client) => {
    const u = await createUser({ email: b.email, password: crypto.randomBytes(24).toString('hex'), name: b.name,
      phoneNumber: b.phoneNumber, role: 'shipper', organizationId: req.params.id }, client);
    await client.query("UPDATE users SET reset_token_hash = $2, reset_token_expires = now() + interval '7 days' WHERE id = $1",
      [u.id, crypto.createHash('sha256').update(token).digest('hex')]);
    return u;
  });
  const { rows: [me] } = await db.query('SELECT name, email FROM users WHERE id = $1', [req.user.id]);
  const invitedBy = isStaff(req.user) ? null : (me?.name || me?.email);
  await inviteCustomer({ user, company: org.name, token, invitedBy, billing: org.billing_mode })
    .catch((e) => console.error('Customer invite email failed:', e.message));
  res.status(201).json(publicUser(user));
}));

// Dispatch turning a company's login off (someone who left) or back on.
router.patch('/:id/users/:userId', requireRole('admin', 'dispatcher'), asyncH(async (req, res) => {
  if (typeof req.body?.isActive !== 'boolean') throw new HttpError(400, 'isActive must be true or false');
  const { rows: [u] } = await db.query(
    "UPDATE users SET is_active = $3, updated_at = now() WHERE id = $2 AND organization_id = $1 AND role = 'shipper' RETURNING id",
    [req.params.id, req.params.userId, req.body.isActive]);
  if (!u) throw new HttpError(404, 'User not found');
  res.json({ id: u.id, isActive: req.body.isActive });
}));

module.exports = router;
