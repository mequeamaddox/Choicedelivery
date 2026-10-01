const bcrypt = require('bcryptjs');
const db = require('./db');
const { ROLES } = require('./auth');
const { HttpError, str } = require('./util');

const USER_SELECT = `
  SELECT u.*, o.name AS organization_name, o.billing_mode AS organization_billing_mode,
         veh.type AS vehicle_type, veh.make AS vehicle_make, veh.model AS vehicle_model, veh.year AS vehicle_year,
         veh.color AS vehicle_color, veh.plate AS vehicle_plate, docs.kinds AS doc_kinds, docs.photo_at
  FROM users u
  LEFT JOIN organizations o ON o.id = u.organization_id
  LEFT JOIN LATERAL (SELECT * FROM vehicles v WHERE v.driver_id = u.id ORDER BY v.created_at LIMIT 1) veh ON true
  LEFT JOIN LATERAL (SELECT array_agg(d.kind ORDER BY d.kind) AS kinds,
                            max(d.updated_at) FILTER (WHERE d.kind = 'photo') AS photo_at
                     FROM driver_documents d WHERE d.user_id = u.id) docs ON true`;

// ---- Driver profiles ----
const DOC_KINDS = {
  photo: 'Profile photo',
  license_front: "Driver's license (front)",
  license_back: "Driver's license (back)",
  insurance: 'Insurance card',
  vehicle: 'Photo of your vehicle',
  registration: 'Vehicle registration',
};
const REQUIRED_DOCS = ['photo', 'license_front', 'insurance', 'vehicle'];

const clip = (v, n = 120) => str(v).slice(0, n);
const isoDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(str(v)) ? str(v) : '');
const today = () => new Date().toISOString().slice(0, 10);

// Merges editable profile fields over the saved profile. Unknown fields are ignored.
function mergeDriverProfile(saved = {}, input = {}) {
  const out = { ...saved };
  if (input.city !== undefined) out.city = clip(input.city, 80);
  if (input.zip !== undefined) out.zip = clip(input.zip, 10);
  if (input.license) {
    out.license = { ...(saved.license || {}) };
    if (input.license.number !== undefined) out.license.number = clip(input.license.number, 40);
    if (input.license.state !== undefined) out.license.state = clip(input.license.state, 2).toUpperCase();
    if (input.license.expires !== undefined) out.license.expires = isoDate(input.license.expires);
  }
  if (input.insurance) {
    out.insurance = { ...(saved.insurance || {}) };
    if (input.insurance.company !== undefined) out.insurance.company = clip(input.insurance.company, 80);
    if (input.insurance.policyNumber !== undefined) out.insurance.policyNumber = clip(input.insurance.policyNumber, 60);
    if (input.insurance.expires !== undefined) out.insurance.expires = isoDate(input.insurance.expires);
  }
  if (input.emergencyContact) {
    out.emergencyContact = {
      name: clip(input.emergencyContact.name ?? saved.emergencyContact?.name, 80),
      phone: clip(input.emergencyContact.phone ?? saved.emergencyContact?.phone, 30),
    };
  }
  return out;
}

// What's still needed before a driver's profile is complete, and anything expired.
function driverChecklist(u) {
  const p = u.driver_profile || {};
  const docs = new Set(u.doc_kinds || []);
  const missing = [];
  if (!str(u.phone_number)) missing.push('Phone number');
  if (!u.vehicle_type || !u.vehicle_make || !u.vehicle_model || !u.vehicle_plate) missing.push('Vehicle details (type, make, model, plate)');
  if (!p.license?.number || !p.license?.expires) missing.push("Driver's license number and expiration");
  if (!p.insurance?.company || !p.insurance?.expires) missing.push('Insurance company and expiration');
  for (const k of REQUIRED_DOCS) if (!docs.has(k)) missing.push(DOC_KINDS[k]);
  const expired = [];
  if (p.license?.expires && p.license.expires < today()) expired.push(`Driver's license expired ${p.license.expires}`);
  if (p.insurance?.expires && p.insurance.expires < today()) expired.push(`Insurance expired ${p.insurance.expires}`);
  return { complete: missing.length === 0, missing, expired };
}

// Where drivers send questions (email, so applicants don't need to phone in).
const supportEmail = () => process.env.SUPPORT_EMAIL || 'info@choicedeliverysc.com';

// Why this driver can't take work right now, or null if they can.
function driverWorkBlocker(u) {
  if (u.role !== 'driver') return null;
  if (u.driver_status === 'applied') return "Your application is still being reviewed. We'll email you when you're approved.";
  if (u.driver_status === 'rejected') return `Your driver application was not approved. Questions? Email ${supportEmail()}.`;
  if (u.driver_status === 'suspended') return `Your driver account is on hold. Questions? Email ${supportEmail()}.`;
  const { expired } = driverChecklist(u);
  if (expired.length) return `${expired.join(' and ')}. Upload the new one under Account → Profile to keep taking jobs.`;
  return null;
}

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
    emailUpdates: u.email_updates,
  };
  if (u.role === 'driver') {
    out.isOnline = u.is_online;
    out.driverStatus = u.driver_status;
    out.appliedAt = u.applied_at;
    out.reviewedAt = u.reviewed_at;
    out.reviewNote = u.review_note;
    out.driverProfile = u.driver_profile || {};
    out.noDriverPay = !!u.no_driver_pay; // owner who drives: no payouts
    out.vehicle = {
      type: u.vehicle_type || '', make: u.vehicle_make || '', model: u.vehicle_model || '',
      year: u.vehicle_year || '', color: u.vehicle_color || '', plate: u.vehicle_plate || '',
    };
    out.documents = u.doc_kinds || [];
    out.photoUrl = u.photo_at ? `/public/driver-photo/${u.id}?v=${new Date(u.photo_at).getTime()}` : null;
    out.checklist = driverChecklist(u);
    out.workBlocker = driverWorkBlocker(u);
  }
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

async function createUser({ email, password, role = 'driver', name = '', phoneNumber = '', organizationId = null,
  driverStatus = 'approved' }, client = db) {
  email = str(email).toLowerCase();
  if (!email || !password) throw new HttpError(400, 'Email and password are required');
  if (String(password).length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
  if (!ROLES.includes(role)) throw new HttpError(400, `role must be one of: ${ROLES.join(', ')}`);
  if (role === 'shipper' && !organizationId) throw new HttpError(400, 'Shipper accounts need an organizationId');
  const hash = await bcrypt.hash(String(password), 10);
  try {
    const { rows } = await client.query(
      `INSERT INTO users (email, password_hash, role, name, phone_number, organization_id, driver_status, applied_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $7 = 'applied' THEN now() END) RETURNING id`,
      [email, hash, role, str(name), str(phoneNumber), organizationId, driverStatus]
    );
    return getUser(rows[0].id, client);
  } catch (e) {
    if (e.code === '23505') throw new HttpError(409, 'An account with that email already exists');
    if (e.code === '23503') throw new HttpError(400, 'Organization not found');
    throw e;
  }
}

// Updates the driver's primary vehicle (creating it if needed). Only the given fields change.
async function setVehicle(driverId, vehicle = {}, client = db) {
  const fields = ['type', 'make', 'model', 'year', 'color', 'plate'].filter((k) => vehicle[k] !== undefined);
  if (!fields.length) return;
  const values = fields.map((k) => (k === 'plate' ? clip(vehicle[k], 12).toUpperCase() : clip(vehicle[k], 40)));
  const { rowCount } = await client.query(
    `UPDATE vehicles SET ${fields.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now()
     WHERE id = (SELECT id FROM vehicles WHERE driver_id = $1 ORDER BY created_at LIMIT 1)`,
    [driverId, ...values]);
  if (!rowCount) {
    await client.query(
      `INSERT INTO vehicles (driver_id, ${fields.join(', ')}) VALUES ($1, ${fields.map((k, i) => `$${i + 2}`).join(', ')})`,
      [driverId, ...values]);
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

module.exports = {
  USER_SELECT, publicUser, getUser, createUser, setVehicleType, setVehicle, mergeDriverProfile, driverChecklist,
  driverWorkBlocker, DOC_KINDS, REQUIRED_DOCS,
};
