// Admin-only: load or remove the sample data set (see src/demo.js).
const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { hasDemoData, loadDemoData, removeDemoData } = require('../demo');
const { asyncH } = require('../util');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

router.get('/', asyncH(async (req, res) => res.json(await hasDemoData(db))));
router.post('/', asyncH(async (req, res) => res.status(201).json(await db.withTx((c) => loadDemoData(c, req.user.id)))));
router.delete('/', asyncH(async (req, res) => res.json({ removed: await db.withTx(removeDemoData) })));

module.exports = router;
