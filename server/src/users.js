const bcrypt = require('bcryptjs');
const db = require('./db');
const { ROLES } = require('./auth');
const { HttpError, str } = require('./util');

const USER_SELECT = `
  SELECT u.*, o.name AS organization_name, o.billing_mode AS organization_billing_mode,
         (SELECT v.type FROM vehicles v WHERE v.driver_id = u.id ORDER BY v.created_at LIMIT 1) AS vehicle_type
  FROM users u LEFT JOIN organizations o ON o.id = u.organization_id`;

function publicUser(u, { includeLocation = false } = {}) {
  const out = {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    organization: u.organization_id
      ? { id: u.organization_id, name: u.organization_name, billingMode: u.organization_billing_mode } : null,
    phoneNumber: u.phone_number,
    vehicleType: u.vehicle_type || '',
    profilePictureUrl: u.profile_picture_url,
    isActive: u.is_active,
    isDemo: u.is_demo,
  };
  if (u.role === 'driver') out.isOnline = u.is_online;
  if (includeLocation) {
    out.lastLocation = u.last_location;
    out.locationUpdatedAt = u.location_updated_at;
  }
  return out;
}

async function getUser(id, client = db) {
  const { rows } = await client.query(`${USER_SELECT} WHERE u.id = $1`, [id]);
  return rows[0] || null;
}

async function createUser({ email, password, role = 'driver', name = '', phoneNumber = '', organizationId = null },
  client = db) {
  email = str(email).toLowerCase();
  if (!email || !password) throw new HttpError(400, 'Email and password are required');
  if (String(password).length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
  if (!ROLES.includes(role)) throw new HttpError(400, `role must be one of: ${ROLES.join(', ')}`);
  if (role === 'shipper' && !organizationId) throw new HttpError(400, 'Shipper accounts need an organizationId');
  const hash = await bcrypt.hash(String(password), 10);
  try {
    const { rows } = await client.query(
      `INSERT INTO users (email, password_hash, role, name, phone_number, organization_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [email, hash, role, str(name), str(phoneNumber), organizationId]
    );
    return getUser(rows[0].id, client);
  } catch (e) {
    if (e.code === '23505') throw new HttpError(409, 'An account with that email already exists');
    if (e.code === '23503') throw new HttpError(400, 'Organization not found');
    throw e;
  }
}

// Sets the driver's primary vehicle type (creating the vehicle record if needed).
async function setVehicleType(driverId, type, client = db) {
  const { rowCount } = await client.query(
    `UPDATE vehicles SET type = $2, updated_at = now()
     WHERE id = (SELECT id FROM vehicles WHERE driver_id = $1 ORDER BY created_at LIMIT 1)`,
    [driverId, str(type)]
  );
  if (!rowCount && str(type)) {
    await client.query('INSERT INTO vehicles (driver_id, type) VALUES ($1, $2)', [driverId, str(type)]);
  }
}

module.exports = { USER_SELECT, publicUser, getUser, createUser, setVehicleType };
