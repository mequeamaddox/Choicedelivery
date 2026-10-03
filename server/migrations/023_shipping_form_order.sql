-- A shipping form made for an order already booked ("Print shipping label" on the order page).
ALTER TABLE shipping_forms ADD COLUMN order_id UUID REFERENCES orders(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX shipping_forms_order_idx ON shipping_forms (order_id) WHERE order_id IS NOT NULL;
