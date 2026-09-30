const jwt = require('jsonwebtoken');
const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is not set. Generate one with: openssl rand -hex 32');
}

const ROLES = ['admin', 'dispatcher', 'driver', 'shipper'];
const STAFF = ['admin', 'dispatcher'];

function signToken(user) {
  return jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: '30d' });
}

// Accepts a user JWT or, for server-to-server integrations (e.g. a website order form),
// the DISPATCH_API_KEY sent as "Authorization: Bearer <key>", which acts as a dispatcher.
// The user row is re-read on each request so role changes and deactivation apply immediately.
async function requireAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: 'Not authenticated' });

  if (process.env.DISPATCH_API_KEY && token === process.env.DISPATCH_API_KEY) {
    req.user = { id: null, role: 'dispatcher', organization_id: null, integration: true };
    return next();
  }
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ message: 'Session expired, please log in again' });
  }
  try {
    const { rows } = await db.query(
      'SELECT id, role, organization_id, is_active FROM users WHERE id = $1', [payload.sub]);
    if (!rows[0] || !rows[0].is_active) return res.status(401).json({ message: 'Account is disabled' });
    req.user = rows[0];
    next();
  } catch (e) {
    next(e);
  }
}

const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user?.role)) return res.status(403).json({ message: 'Not allowed for your account type' });
  next();
};

const isStaff = (user) => STAFF.includes(user.role);

module.exports = { ROLES, STAFF, signToken, requireAuth, requireRole, isStaff };
