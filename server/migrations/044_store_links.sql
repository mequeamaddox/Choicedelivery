-- Store delivery link: a store (e.g. a liquidation warehouse) gets a QR code for its counter. Its customers
-- scan it, enter where their purchase is going and pay for the delivery; the store's address is the pickup.
ALTER TABLE organizations ADD COLUMN store_code TEXT UNIQUE;
