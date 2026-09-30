-- Multi-sided platform model: companies (shippers), users with roles, vehicles,
-- orders with any number of pickup/drop-off stops, and an event timeline per order.

-- ---------- Organizations (shipper companies) ----------
CREATE TABLE organizations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  phone         TEXT NOT NULL DEFAULT '',
  billing_email TEXT NOT NULL DEFAULT '',
  address       TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Users: roles, company membership, live driver state ----------
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'dispatcher', 'driver', 'shipper'));
ALTER TABLE users
  ADD COLUMN name                TEXT NOT NULL DEFAULT '',
  ADD COLUMN organization_id     UUID REFERENCES organizations(id) ON DELETE SET NULL,
  ADD COLUMN is_active           BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN is_online           BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN last_location       JSONB,
  ADD COLUMN location_updated_at TIMESTAMPTZ;
ALTER TABLE users ADD CONSTRAINT shipper_has_org
  CHECK (role <> 'shipper' OR organization_id IS NOT NULL);
CREATE INDEX users_role_idx ON users (role);
CREATE INDEX users_org_idx ON users (organization_id);

-- ---------- Vehicles ----------
CREATE TABLE vehicles (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type         TEXT NOT NULL DEFAULT '',
  make         TEXT NOT NULL DEFAULT '',
  model        TEXT NOT NULL DEFAULT '',
  plate        TEXT NOT NULL DEFAULT '',
  capacity_lbs INTEGER,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX vehicles_driver_idx ON vehicles (driver_id);
INSERT INTO vehicles (driver_id, type)
  SELECT id, vehicle_type FROM users WHERE vehicle_type <> '';
ALTER TABLE users DROP COLUMN vehicle_type;

-- ---------- Orders ----------
CREATE SEQUENCE order_number_seq START 100001;

CREATE TABLE orders (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number     TEXT NOT NULL UNIQUE DEFAULT ('CD-' || nextval('order_number_seq')),
  public_token     UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(), -- for shareable tracking links
  organization_id  UUID REFERENCES organizations(id) ON DELETE SET NULL,
  created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  driver_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN
                     ('pending', 'accepted', 'at_pickup', 'in_transit', 'at_dropoff', 'completed', 'cancelled')),
  vehicle_type     TEXT NOT NULL DEFAULT '',
  weight           TEXT NOT NULL DEFAULT '',
  number_of_pieces TEXT NOT NULL DEFAULT '',
  description      TEXT NOT NULL DEFAULT '',
  tracking_number  TEXT UNIQUE,
  price_cents      INTEGER,
  currency         TEXT NOT NULL DEFAULT 'usd',
  scheduled_at     TIMESTAMPTZ,
  accepted_at      TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  cancelled_at     TIMESTAMPTZ,
  notes            JSONB NOT NULL DEFAULT '[]'::jsonb,
  legacy_id        TEXT UNIQUE, -- id from the old pickups table / Firebase
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX orders_status_idx ON orders (status);
CREATE INDEX orders_driver_idx ON orders (driver_id);
CREATE INDEX orders_org_idx ON orders (organization_id);
CREATE INDEX orders_created_idx ON orders (created_at DESC);

-- ---------- Stops (pickups and drop-offs, in route order) ----------
CREATE TABLE stops (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sequence      INTEGER NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('pickup', 'dropoff')),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'arrived', 'completed')),
  address       TEXT NOT NULL DEFAULT '',
  location      JSONB,
  contact_name  TEXT NOT NULL DEFAULT '',
  contact_phone TEXT NOT NULL DEFAULT '',
  instructions  TEXT NOT NULL DEFAULT '',
  arrived_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  signature     TEXT,  -- proof of pickup/delivery (data URL for now; move to object storage later)
  photo         TEXT,
  printed_name  TEXT,
  barcode       TEXT,
  UNIQUE (order_id, sequence)
);

-- ---------- Order timeline ----------
CREATE TABLE order_events (
  id         BIGSERIAL PRIMARY KEY,
  order_id   UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  actor_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  type       TEXT NOT NULL,
  data       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX order_events_order_idx ON order_events (order_id, created_at);

-- ---------- Carry over anything in the old pickups table ----------
INSERT INTO orders (legacy_id, driver_id, status, vehicle_type, weight, number_of_pieces,
                    tracking_number, notes, scheduled_at, accepted_at, completed_at, created_at, updated_at)
SELECT p.id, p.driver_id,
       CASE lower(p.status)
         WHEN 'pending' THEN 'pending'
         WHEN 'accepted' THEN 'accepted'
         WHEN 'picked up' THEN 'at_pickup'
         WHEN 'in transit' THEN 'in_transit'
         WHEN 'delivered' THEN 'at_dropoff'
         WHEN 'completed' THEN 'completed'
         ELSE 'pending' END,
       p.vehicle_type, p.weight, p.number_of_pieces, p.tracking_number, p.notes,
       p.pickup_date, CASE WHEN p.driver_id IS NOT NULL THEN p.updated_at END,
       p.delivered_at, p.created_at, p.updated_at
FROM pickups p;

INSERT INTO stops (order_id, sequence, type, status, address, location, contact_name, contact_phone,
                   completed_at, signature, photo)
SELECT o.id, 1, 'pickup',
       CASE WHEN o.status IN ('in_transit', 'at_dropoff', 'completed') THEN 'completed'
            WHEN o.status = 'at_pickup' THEN 'arrived' ELSE 'pending' END,
       p.pickup_address, p.pickup_location, p.contact_name, p.contact_phone,
       p.picked_up_at, p.pickup_signature, p.pickup_image
FROM pickups p JOIN orders o ON o.legacy_id = p.id;

INSERT INTO stops (order_id, sequence, type, status, address, location, contact_name, contact_phone,
                   completed_at, signature, photo, printed_name)
SELECT o.id, 2, 'dropoff',
       CASE WHEN o.status = 'completed' THEN 'completed'
            WHEN o.status = 'at_dropoff' THEN 'arrived' ELSE 'pending' END,
       p.destination_address, p.delivery_location, p.contact_name, p.contact_phone,
       p.delivered_at, p.delivery_signature, p.delivery_image, p.printed_name
FROM pickups p JOIN orders o ON o.legacy_id = p.id;

-- Kept (renamed) rather than dropped so nothing is lost; safe to drop once verified.
ALTER TABLE pickups RENAME TO pickups_legacy;
