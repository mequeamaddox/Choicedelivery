-- Driver pay for work that isn't an order in the app (e.g. a day of Walmart deliveries). Paid out with the
-- driver's order pay: Wednesday direct deposit, Pay with Stripe, or marked paid by hand.
CREATE TABLE driver_pay_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day              DATE NOT NULL,
  description      TEXT NOT NULL,
  cents            INTEGER NOT NULL CHECK (cents > 0),
  driver_paid_at   TIMESTAMPTZ,
  driver_paid_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  driver_payout_id UUID REFERENCES driver_payouts(id) ON DELETE SET NULL,
  created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX driver_pay_items_driver_idx ON driver_pay_items (driver_id, day);

-- Custom invoices: bill a company or anyone (name + email) for lines typed by hand.
ALTER TABLE invoices ALTER COLUMN organization_id DROP NOT NULL;
ALTER TABLE invoices ADD COLUMN is_custom BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE invoices ADD COLUMN bill_to_name TEXT;
ALTER TABLE invoices ADD COLUMN bill_to_email TEXT;
ALTER TABLE invoices ADD COLUMN bill_to_address TEXT;
ALTER TABLE invoices ADD COLUMN memo TEXT;
ALTER TABLE invoices ADD CONSTRAINT invoices_bill_to_check CHECK (organization_id IS NOT NULL OR bill_to_name IS NOT NULL);
