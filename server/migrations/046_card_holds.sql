-- Card holds: card orders are authorized at booking (the price plus a buffer for extra charges) and
-- charged after delivery. 'authorized' = card on hold; 'released' = hold let go when cancelled.
-- Extra charges that fit in the buffer are 'hold' until the card is charged. Also lets TONU fees be billed.
ALTER TABLE orders DROP CONSTRAINT orders_payment_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_payment_status_check
  CHECK (payment_status IN ('unpaid', 'paid', 'invoice', 'waived', 'refunded', 'authorized', 'released'));
ALTER TABLE orders ADD COLUMN hold_cents INTEGER, ADD COLUMN hold_expires_at TIMESTAMPTZ;
ALTER TABLE order_charges DROP CONSTRAINT order_charges_status_check;
ALTER TABLE order_charges ADD CONSTRAINT order_charges_status_check CHECK (status IN ('due', 'paid', 'invoice', 'waived', 'hold'));
ALTER TABLE order_charges DROP CONSTRAINT order_charges_kind_check;
ALTER TABLE order_charges ADD CONSTRAINT order_charges_kind_check
  CHECK (kind IN ('wait_time', 'extra_weight', 'labor', 'return_trip', 'failed_attempt', 'other', 'tonu'));
CREATE INDEX orders_authorized ON orders (hold_expires_at) WHERE payment_status = 'authorized';
