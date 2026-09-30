const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Accepts {lat, lng} (numbers or numeric strings); returns a clean object or null.
function parseLocation(v) {
  if (!v || v.lat == null || v.lng == null) return null;
  const lat = Number(v.lat);
  const lng = Number(v.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new HttpError(400, 'Location must be {lat, lng} with valid coordinates');
  }
  return { lat, lng };
}

const str = (v) => (v === undefined || v === null ? '' : String(v).trim());

module.exports = { asyncH, HttpError, parseLocation, str };
