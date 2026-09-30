-- The biggest vehicle is a half-ton pickup: "Truck" becomes "Pickup Truck".
UPDATE orders SET vehicle_type = 'Pickup Truck' WHERE vehicle_type = 'Truck';
UPDATE vehicles SET type = 'Pickup Truck' WHERE type = 'Truck';

-- Orders the formula can't price (too heavy for the vehicle, over the top weight tier) are held as
-- quotes for manual review: 'needed' until dispatch sets a price, then 'done' and the customer can book.
ALTER TABLE orders ADD COLUMN review_status TEXT CHECK (review_status IN ('needed', 'done'));
