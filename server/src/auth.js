const crypto = require('crypto');
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

// A short-lived token good for one purpose only (e.g. opening the payout-method page from the driver
// app in a browser). requireAuth accepts it only on routes that set req.authScope to that purpose.
function signScopedToken(userId, purpose, expiresIn = '15m') {
  return jwt.sign({ sub: userId, purpose }, JWT_SECRET, { expiresIn });
}

// Customer API keys ("cd_live_..."): random, stored only as a sha256 hash.
const API_KEY_PREFIX = 'cd_live_';
const hashApiKey = (key) => crypto.createHash('sha256').update(key).digest('hex');
function newApiKey() {
  const key = API_KEY_PREFIX + crypto.randomBytes(24).toString('base64url');
  return { key, prefix: key.slice(0, API_KEY_PREFIX.length + 6), hash: hashApiKey(key) };
}
// What a customer API key may do: price, book and track its own orders (and shipping forms), and read
// its profile. Account changes (password, profile, coworkers, other keys) need a real login.
const API_KEY_PATHS = ['/orders', '/shipping-forms'];
const apiKeyAllowed = (req) => req.method === 'GET' || API_KEY_PATHS.includes(req.baseUrl);

// Accepts a user JWT, a customer API key, or, for server-to-server integrations (e.g. a website order
// form), the DISPATCH_API_KEY sent as "Authorization: Bearer <key>", which acts as a dispatcher.
// The user row is re-read on each request so role changes and deactivation apply immediately.
async function requireAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: 'Not authenticated' });

  if (process.env.DISPATCH_API_KEY && token === process.env.DISPATCH_API_KEY) {
    req.user = { id: null, role: 'dispatcher', organization_id: null, integration: true };
    return next();
  }
  if (token.startsWith(API_KEY_PREFIX)) {
    try {
      const { rows: [row] } = await db.query(
        `SELECT k.id AS key_id, k.last_used_at, u.id, u.role, u.organization_id, u.is_active, u.driver_status
         FROM api_keys k JOIN users u ON u.id = k.user_id WHERE k.key_hash = $1 AND k.revoked_at IS NULL`, [hashApiKey(token)]);
      if (!row || !row.is_active || row.role !== 'shipper') return res.status(401).json({ message: 'Invalid or revoked API key' });
      if (!apiKeyAllowed(req)) return res.status(403).json({ message: 'API keys can only book and track orders. Log in to change account settings.' });
      if (!row.last_used_at || Date.now() - row.last_used_at > 60 * 1000) {
        db.query('UPDATE api_keys SET last_used_at = now() WHERE id = $1', [row.key_id]).catch(() => {});
      }
      const { key_id: apiKeyId, last_used_at: _, ...user } = row;
      req.user = { ...user, apiKeyId };
      return next();
    } catch (e) {
      return next(e);
    }
  }
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ message: 'Session expired, please log in again' });
  }
  if (payload.purpose && payload.purpose !== req.authScope) {
    return res.status(401).json({ message: 'This link has expired. Go back to the app and try again.' });
  }
  try {
    const { rows } = await db.query(
      'SELECT id, role, organization_id, is_active, driver_status FROM users WHERE id = $1', [payload.sub]);
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

module.exports = { ROLES, STAFF, signToken, signScopedToken, requireAuth, requireRole, isStaff, newApiKey };
