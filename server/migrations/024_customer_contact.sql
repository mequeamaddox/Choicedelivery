-- Orders dispatch books for someone without an account (phone or walk-in customers): who to email,
-- and when a payment link was sent (the link works until the order is paid).
ALTER TABLE orders
  ADD COLUMN customer_name TEXT,
  ADD COLUMN customer_email TEXT,
  ADD COLUMN payment_requested_at TIMESTAMPTZ;
