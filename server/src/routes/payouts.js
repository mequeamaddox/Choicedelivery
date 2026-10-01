// Driver pay: what each driver has earned on completed orders, and marking it paid. Money is sent
// outside the app (Cash App, Zelle, check, payroll); this keeps the record of who is owed what.
const express = require('express');
const db = require('../db');
const { requireAuth, requireRole, isStaff } = require('../auth');
const { asyncH, HttpError } = require('../util');
const { recordEvent } = require('../orders');

const router = express.Router();
router.use(requireAuth);

const ORDER_COLS = `o.id, o.order_number, o.completed_at, o.driver_pay_cents, o.driver_paid_at, o.driver_id,
  (SELECT address FROM stops s WHERE s.order_id = o.id ORDER BY sequence LIMIT 1) AS pickup,
  (SELECT address FROM stops s WHERE s.order_id = o.id ORDER BY sequence DESC LIMIT 1) AS dropoff`;
const serialize = (r) => ({
  id: r.id, orderNumber: r.order_number, completedAt: r.completed_at, driverPayCents: r.driver_pay_cents ?? 0,
  driverPaidAt: r.driver_paid_at, pickup: r.pickup, dropoff: r.dropoff,
});
const sum = (list) => list.reduce((n, o) => n + (o.driverPayCents || 0), 0);

// Staff: every driver with completed orders not yet paid out (status=unpaid, default), or paid in the
// last 60 days (status=paid).
router.get('/', requireRole('admin', 'dispatcher'), asyncH(async (req, res) => {
  const paid = req.query.status === 'paid';
  const { rows } = await db.query(
    `SELECT ${ORDER_COLS}, u.name AS driver_name, u.email AS driver_email, u.phone_number AS driver_phone
     FROM orders o JOIN users u ON u.id = o.driver_id
     WHERE o.status = 'completed' AND NOT o.is_demo AND ${paid ? "o.driver_paid_at > now() - interval '60 days'" : 'o.driver_paid_at IS NULL'}
     ORDER BY u.name, o.completed_at`);
  const drivers = new Map();
  for (const r of rows) {
    if (!drivers.has(r.driver_id)) {
      drivers.set(r.driver_id, { driver: { id: r.driver_id, name: r.driver_name, email: r.driver_email, phoneNumber: r.driver_phone }, orders: [] });
    }
    drivers.get(r.driver_id).orders.push(serialize(r));
  }
  res.json([...drivers.values()].map((d) => ({ ...d, totalCents: sum(d.orders) })));
}));

// Staff: mark orders' driver pay as paid out. Body: { orderIds }.
router.post('/mark-paid', requireRole('admin', 'dispatcher'), asyncH(async (req, res) => {
  const ids = Array.isArray(req.body?.orderIds) ? req.body.orderIds.filter((x) => typeof x === 'string').slice(0, 500) : [];
  if (!ids.length) throw new HttpError(400, 'Choose at least one order');
  const result = await db.withTx(async (client) => {
    let rows;
    try {
      ({ rows } = await client.query(
        `UPDATE orders SET driver_paid_at = now(), driver_paid_by = $2
         WHERE id = ANY($1::uuid[]) AND status = 'completed' AND driver_paid_at IS NULL RETURNING id, driver_pay_cents`,
        [ids, req.user.id]));
    } catch (e) {
      if (e.code === '22P02') throw new HttpError(400, 'Invalid order id');
      throw e;
    }
    for (const r of rows) await recordEvent(client, r.id, req.user.id, 'driver_paid', { cents: r.driver_pay_cents });
    return rows;
  });
  res.json({ paidOrders: result.length, totalCents: result.reduce((n, r) => n + (r.driver_pay_cents || 0), 0) });
}));

// Drivers: their own earnings — owed (completed, not yet paid out), this week, and recent payouts.
router.get('/me', asyncH(async (req, res) => {
  if (req.user.role !== 'driver' && !isStaff(req.user)) throw new HttpError(403, 'Drivers only');
  const { rows } = await db.query(
    `SELECT ${ORDER_COLS} FROM orders o
     WHERE o.driver_id = $1 AND o.status = 'completed' AND (o.driver_paid_at IS NULL OR o.driver_paid_at > now() - interval '60 days')
     ORDER BY o.completed_at DESC`, [req.user.id]);
  const orders = rows.map(serialize);
  const unpaid = orders.filter((o) => !o.driverPaidAt);
  const weekStart = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  res.json({
    owedCents: sum(unpaid),
    last7DaysCents: sum(orders.filter((o) => new Date(o.completedAt) > weekStart)),
    paidLast60DaysCents: sum(orders.filter((o) => o.driverPaidAt)),
    orders,
  });
}));

module.exports = router;
