-- Idempotent schema; applied automatically on server start.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email               TEXT NOT NULL UNIQUE,
  password_hash       TEXT NOT NULL,
  role                TEXT NOT NULL DEFAULT 'driver' CHECK (role IN ('driver', 'admin')),
  phone_number        TEXT NOT NULL DEFAULT '',
  vehicle_type        TEXT NOT NULL DEFAULT '',
  profile_picture_url TEXT NOT NULL DEFAULT '',
  push_token          TEXT,
  reset_token_hash    TEXT,
  reset_token_expires TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pickups (
  id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  status              TEXT NOT NULL DEFAULT 'Pending',
  contact_name        TEXT NOT NULL DEFAULT '',
  contact_phone       TEXT NOT NULL DEFAULT '',
  pickup_address      TEXT NOT NULL DEFAULT '',
  destination_address TEXT NOT NULL DEFAULT '',
  weight              TEXT NOT NULL DEFAULT '',
  number_of_pieces    TEXT NOT NULL DEFAULT '',
  vehicle_type        TEXT NOT NULL DEFAULT '',
  tracking_number     TEXT UNIQUE,
  pickup_date         TIMESTAMPTZ NOT NULL DEFAULT now(),
  pickup_location     JSONB,
  delivery_location   JSONB,
  driver_id           UUID REFERENCES users(id) ON DELETE SET NULL,
  pickup_signature    TEXT,
  pickup_image        TEXT,
  picked_up_at        TIMESTAMPTZ,
  delivery_signature  TEXT,
  delivery_image      TEXT,
  printed_name        TEXT,
  delivered_at        TIMESTAMPTZ,
  notes               JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pickups_status_idx ON pickups (lower(status));
CREATE INDEX IF NOT EXISTS pickups_driver_idx ON pickups (driver_id);
