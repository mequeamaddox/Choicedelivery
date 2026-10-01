-- Payouts: instant (driver asked to be paid now, for a fee) vs. the weekly batch or a one-off by
-- dispatch; the fee kept, and Stripe's payout id for instant payouts.
ALTER TABLE driver_payouts
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'dispatch' CHECK (kind IN ('dispatch', 'batch', 'instant')),
  ADD COLUMN fee_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN stripe_payout_id TEXT;
