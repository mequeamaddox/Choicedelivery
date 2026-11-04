-- Emailed quotes are honored at the quoted price when the same email books the same trip (src/quote-locks.js).
CREATE TABLE quote_locks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email        TEXT NOT NULL,
  lead_id      UUID,
  price_cents  INTEGER NOT NULL,
  vehicle_type TEXT,
  service_level TEXT NOT NULL DEFAULT 'standard',
  weight_lbs   NUMERIC,
  add_ons      TEXT[] NOT NULL DEFAULT '{}',
  addresses    TEXT[] NOT NULL,
  locations    JSONB NOT NULL DEFAULT '[]',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  order_id     UUID REFERENCES orders(id) ON DELETE SET NULL
);
CREATE INDEX quote_locks_email ON quote_locks (email) WHERE order_id IS NULL;

-- Quotes already emailed in the last two weeks (their map points are looked up when they book).
INSERT INTO quote_locks (email, lead_id, price_cents, vehicle_type, service_level, weight_lbs, addresses, created_at, expires_at)
SELECT l.email, l.id,
       round(substring(l.message from 'Price: \$([0-9]+\.[0-9]{2})')::numeric * 100)::int,
       substring(l.message from 'Vehicle: ([^\n]+)'),
       CASE WHEN l.message ~ 'Service: Rush' THEN 'rush' ELSE 'standard' END,
       substring(l.message from 'Weight: ([0-9]+) lbs')::numeric,
       ARRAY[substring(l.message from 'From: ([^\n]+)'), substring(l.message from 'To: ([^\n]+)')],
       l.created_at, l.created_at + interval '14 days'
FROM leads l
WHERE l.type = 'quote' AND l.created_at > now() - interval '14 days'
  AND l.message ~ 'Price: \$[0-9]+\.[0-9]{2}' AND l.message !~ 'Price: \$[0-9.]+ \(' AND l.message ~ 'From: ' AND l.message ~ 'To: ';
