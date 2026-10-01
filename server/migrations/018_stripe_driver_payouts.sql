-- Paying drivers through Stripe Connect: each driver's Stripe (Express) account, and a record of
-- every payout (by Stripe transfer, or marked paid by hand) with the orders it covered.
ALTER TABLE users
  ADD COLUMN stripe_account_id TEXT UNIQUE,
  ADD COLUMN stripe_payouts_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN stripe_details_submitted BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE driver_payouts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cents              INTEGER NOT NULL CHECK (cents >= 0),
  method             TEXT NOT NULL CHECK (method IN ('stripe', 'manual')),
  stripe_transfer_id TEXT,
  created_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX driver_payouts_driver_idx ON driver_payouts (driver_id, created_at DESC);

ALTER TABLE orders ADD COLUMN driver_payout_id UUID REFERENCES driver_payouts(id) ON DELETE SET NULL;
