const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is not set. Generate one with: openssl rand -hex 32');
}

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
}

// Accepts either a user JWT or, for server-to-server dispatch (e.g. a website order form),
// the DISPATCH_API_KEY sent as "Authorization: Bearer <key>".
function requireAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: 'Not authenticated' });

  if (process.env.DISPATCH_API_KEY && token === process.env.DISPATCH_API_KEY) {
    req.user = { id: null, role: 'admin', dispatch: true };
    return next();
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.sub, role: payload.role };
    next();
  } catch {
    res.status(401).json({ message: 'Session expired, please log in again' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ message: 'Admin only' });
  next();
}

module.exports = { signToken, requireAuth, requireAdmin };
