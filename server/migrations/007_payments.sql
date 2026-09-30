-- Payments. Card customers pay per order through Stripe Checkout before drivers see the job;
-- "invoice" companies (monthly accounts) are billed outside the app and their jobs dispatch right away.
ALTER TABLE organizations ADD COLUMN billing_mode TEXT NOT NULL DEFAULT 'card'
  CHECK (billing_mode IN ('card', 'invoice'));

ALTER TABLE orders
  ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'invoice'
    CHECK (payment_status IN ('unpaid', 'paid', 'invoice', 'waived', 'refunded')),
  ADD COLUMN paid_cents INTEGER,
  ADD COLUMN paid_at TIMESTAMPTZ,
  ADD COLUMN payment_method TEXT,           -- 'card', 'cash', 'check', ...
  ADD COLUMN stripe_session_id TEXT,
  ADD COLUMN stripe_payment_intent TEXT,
  ADD COLUMN refunded_cents INTEGER;
CREATE INDEX orders_payment_idx ON orders (payment_status);
