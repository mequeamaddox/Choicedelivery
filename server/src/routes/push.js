// Phone alerts for dispatch (see src/webpush.js): turn them on for this phone, pick which kinds, test.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const { asyncH, HttpError } = require('../util');
const webpush = require('../webpush');

const router = express.Router();
router.use(requireAuth, requireRole('admin', 'dispatcher', 'driver'));

router.get('/', asyncH(async (req, res) => res.json(await webpush.config(req.user.id))));

router.post('/subscribe', asyncH(async (req, res) => {
  if (!(await webpush.subscribe(req.user.id, req.body?.subscription, req.body?.device))) {
    throw new HttpError(400, "This phone didn't give us what it needs for alerts. Try again.");
  }
  res.json(await webpush.config(req.user.id));
}));

router.post('/unsubscribe', asyncH(async (req, res) => {
  await webpush.unsubscribe(req.user.id, req.body?.endpoint);
  res.json(await webpush.config(req.user.id));
}));

router.patch('/prefs', asyncH(async (req, res) => {
  await webpush.setPrefs(req.user.id, req.body);
  res.json(await webpush.config(req.user.id));
}));

router.post('/test', asyncH(async (req, res) => {
  const driver = req.user.role === 'driver';
  const sent = await webpush.notifyUserDevices(req.user.id, {
    title: driver ? 'Choice Driver' : 'Choice Dispatch',
    body: driver ? "Job alerts are working. You'll get one like this when a new job comes in." : "Alerts are working. You'll get one like this for new orders.",
    url: driver ? '/#/driver' : '/#/', tag: 'test',
  });
  if (!sent) throw new HttpError(409, "Couldn't reach this phone. Turn alerts off and on again.");
  res.json({ sent });
}));

module.exports = router;
