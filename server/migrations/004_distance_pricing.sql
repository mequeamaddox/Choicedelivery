-- Pricing from the original Choice Delivery quote page:
--   $25 base (first 10 miles) + $1.50 per extra mile, x vehicle multiplier, + $50 rush.
-- "same_day" becomes "rush" (2 hours or less), matching the original app.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_service_level_check;
UPDATE orders SET service_level = 'rush' WHERE service_level = 'same_day';
ALTER TABLE orders ADD CONSTRAINT orders_service_level_check CHECK (service_level IN ('standard', 'rush'));

ALTER TABLE orders
  ADD COLUMN distance_miles  NUMERIC(7, 1),
  ADD COLUMN price_breakdown JSONB,
  ADD COLUMN price_is_custom BOOLEAN NOT NULL DEFAULT false;
