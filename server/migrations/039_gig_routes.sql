-- Gig work (Amazon Flex, Spark, DoorDash...): routes imported from screenshots or pasted text, so the
-- driver can navigate them alongside Choice Delivery jobs, and a shift log (pay, tips, miles) for taxes.
-- Gig customers' addresses are deleted automatically a day after the route (see src/gig.js).
CREATE TABLE gig_routes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app         TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'done')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX gig_routes_user_idx ON gig_routes (user_id, created_at DESC);

CREATE TABLE gig_stops (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id  UUID NOT NULL REFERENCES gig_routes(id) ON DELETE CASCADE,
  sequence  INTEGER NOT NULL,
  address   TEXT NOT NULL,
  note      TEXT NOT NULL DEFAULT '',
  location  JSONB,
  located   BOOLEAN NOT NULL DEFAULT false,
  done_at   TIMESTAMPTZ
);
CREATE INDEX gig_stops_route_idx ON gig_stops (route_id, sequence);

CREATE TABLE gig_shifts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day         DATE NOT NULL,
  app         TEXT NOT NULL,
  hours       NUMERIC(5, 2),
  pay_cents   INTEGER NOT NULL DEFAULT 0 CHECK (pay_cents >= 0),
  tips_cents  INTEGER NOT NULL DEFAULT 0 CHECK (tips_cents >= 0),
  miles       NUMERIC(7, 1),
  stops       INTEGER,
  note        TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX gig_shifts_user_day_idx ON gig_shifts (user_id, day DESC);
