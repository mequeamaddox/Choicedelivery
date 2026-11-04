-- TONU (truck ordered, not used): the $50 kept when an order is cancelled after the driver is on the way.
ALTER TABLE orders ADD COLUMN tonu_cents INTEGER;
