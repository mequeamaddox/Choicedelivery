-- Driver onboarding and profiles.
--   driver_status: applied (signed up, waiting for review) -> approved | rejected; approved drivers can be
--   suspended. Only approved drivers see open jobs, go online or get assigned work. Accounts created or
--   invited by staff start approved.
ALTER TABLE users
  ADD COLUMN driver_status  TEXT NOT NULL DEFAULT 'approved'
    CHECK (driver_status IN ('applied', 'approved', 'rejected', 'suspended')),
  ADD COLUMN driver_profile JSONB NOT NULL DEFAULT '{}'::jsonb, -- city, zip, license, insurance, emergency contact, agreements
  ADD COLUMN applied_at     TIMESTAMPTZ,
  ADD COLUMN reviewed_at    TIMESTAMPTZ,
  ADD COLUMN reviewed_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN review_note    TEXT NOT NULL DEFAULT '';
CREATE INDEX users_driver_status_idx ON users (driver_status) WHERE role = 'driver';

ALTER TABLE vehicles
  ADD COLUMN year  TEXT NOT NULL DEFAULT '',
  ADD COLUMN color TEXT NOT NULL DEFAULT '';

-- Profile photo and document photos (driver's license, insurance card, vehicle, registration), stored as
-- image data URLs like proof-of-delivery photos. Only the driver and staff can read documents; the profile
-- photo is shown to customers on the tracking page.
CREATE TABLE driver_documents (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('photo', 'license_front', 'license_back', 'insurance', 'vehicle', 'registration')),
  data       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind)
);
