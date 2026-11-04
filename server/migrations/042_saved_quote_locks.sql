-- Saved quotes keep their price for 14 days (and once booked from a locked quote, for good), unless the
-- customer changes something that affects the price. See lockQuotePrice in src/orders.js.
ALTER TABLE orders ADD COLUMN quote_locked_cents INTEGER, ADD COLUMN quote_locked_until TIMESTAMPTZ;
-- Quotes already saved are locked at their current price from today.
UPDATE orders SET quote_locked_cents = price_cents, quote_locked_until = now() + interval '14 days'
WHERE status = 'quote' AND NOT price_is_custom AND review_status IS DISTINCT FROM 'needed' AND price_cents IS NOT NULL;
