-- Optional add-ons chosen at booking (keys of the 'fees' setting, e.g. loading_help, inside_delivery).
ALTER TABLE orders ADD COLUMN add_ons TEXT[] NOT NULL DEFAULT '{}';

-- Charges added after booking: wait time, heavier than declared, return trips, etc.
-- Card customers pay them online ('due' -> 'paid'); monthly accounts are billed ('invoice').
CREATE TABLE order_charges (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  kind              TEXT NOT NULL CHECK (kind IN
                      ('wait_time', 'extra_weight', 'labor', 'return_trip', 'failed_attempt', 'other')),
  description       TEXT NOT NULL DEFAULT '',
  cents             INTEGER NOT NULL CHECK (cents > 0),
  minutes           INTEGER,
  stop_id           UUID REFERENCES stops(id) ON DELETE SET NULL,
  status            TEXT NOT NULL CHECK (status IN ('due', 'paid', 'invoice', 'waived')),
  stripe_session_id TEXT,
  paid_at           TIMESTAMPTZ,
  created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX order_charges_order_idx ON order_charges (order_id);
