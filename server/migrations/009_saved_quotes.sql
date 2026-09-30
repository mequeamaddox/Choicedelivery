-- Saved quotes: an order with status 'quote' holds the route, shipment details and price but isn't
-- booked yet. Drivers never see it, it doesn't count toward demand pricing, and it can't be tracked.
-- Booking turns it into a normal 'pending' order (re-priced for the actual booking time).
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN
  ('quote', 'pending', 'accepted', 'at_pickup', 'in_transit', 'at_dropoff', 'completed', 'cancelled'));

-- When the order was booked (differs from created_at for orders that started as saved quotes).
ALTER TABLE orders ADD COLUMN booked_at TIMESTAMPTZ;
UPDATE orders SET booked_at = created_at WHERE status <> 'quote';
