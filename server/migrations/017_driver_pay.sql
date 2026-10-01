-- What the driver earns for an order (drivers see this, never the customer's price), whether dispatch
-- set it by hand, and when it was paid out.
ALTER TABLE orders
  ADD COLUMN driver_pay_cents INTEGER,
  ADD COLUMN driver_pay_is_custom BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN driver_paid_at TIMESTAMPTZ,
  ADD COLUMN driver_paid_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Existing orders: the default rate (70% of the price, at least $15, never more than the price).
UPDATE orders SET driver_pay_cents = LEAST(price_cents, GREATEST(1500, round(price_cents * 0.70)))
 WHERE price_cents IS NOT NULL;
-- Deliveries done before driver pay was tracked count as already settled.
UPDATE orders SET driver_paid_at = completed_at WHERE status = 'completed';

CREATE INDEX orders_driver_unpaid_idx ON orders (driver_id) WHERE status = 'completed' AND driver_paid_at IS NULL;
