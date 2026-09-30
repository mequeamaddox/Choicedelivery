// Staff view of website leads (contact messages and business-plan requests).
const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { BUSINESS_PLANS } = require('../pricing');
const { asyncH, HttpError } = require('../util');

const router = express.Router();
router.use(requireAuth, requireRole('admin', 'dispatcher'));

const STATUSES = ['new', 'contacted', 'won', 'closed'];
const serialize = (l) => ({
  id: l.id, type: l.type, name: l.name, company: l.company, email: l.email, phone: l.phone, message: l.message,
  plan: l.plan, planName: l.plan ? BUSINESS_PLANS[l.plan]?.name || l.plan : null, status: l.status,
  createdAt: l.created_at, updatedAt: l.updated_at,
});

router.get('/', asyncH(async (req, res) => {
  const params = [];
  let where = '';
  if (req.query.status) {
    params.push(String(req.query.status).split(','));
    where = 'WHERE status = ANY($1)';
  }
  const { rows } = await db.query(`SELECT * FROM leads ${where} ORDER BY created_at DESC LIMIT 500`, params);
  res.json(rows.map(serialize));
}));

router.patch('/:id', asyncH(async (req, res) => {
  const status = req.body?.status;
  if (!STATUSES.includes(status)) throw new HttpError(400, `status must be one of: ${STATUSES.join(', ')}`);
  const { rows } = await db.query(
    'UPDATE leads SET status = $2, updated_at = now() WHERE id = $1 RETURNING *', [req.params.id, status]
  ).catch(() => ({ rows: [] }));
  if (!rows[0]) throw new HttpError(404, 'Lead not found');
  res.json(serialize(rows[0]));
}));

module.exports = router;
