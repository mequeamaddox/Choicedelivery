-- Independent contractor driver agreements signed in the app: the exact text the driver saw, what they
-- filled in, their drawn signature, and when and from where they signed.
CREATE TABLE driver_agreements (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version    TEXT NOT NULL,
  legal_name TEXT NOT NULL,
  address    TEXT NOT NULL,
  city       TEXT NOT NULL,
  state      TEXT NOT NULL,
  zip        TEXT NOT NULL,
  phone      TEXT NOT NULL,
  email      TEXT NOT NULL,
  consents   JSONB NOT NULL,
  signature  TEXT NOT NULL,
  document   JSONB NOT NULL,
  ip         TEXT,
  user_agent TEXT,
  signed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX driver_agreements_user ON driver_agreements (user_id, signed_at DESC);
