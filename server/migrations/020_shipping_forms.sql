-- Shipping forms: a shipper fills one out for a shipment and gets a label with a barcode (its code).
-- Booking a delivery from the form puts the code on the order as its reference number, so the
-- driver app's barcode scan finds the job.
CREATE TABLE shipping_forms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  shipper JSONB NOT NULL,
  recipient JSONB NOT NULL,
  pieces INTEGER,
  weight_lbs NUMERIC,
  description TEXT,
  reference TEXT,
  instructions TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX shipping_forms_org_idx ON shipping_forms (organization_id, created_at DESC);
CREATE INDEX shipping_forms_creator_idx ON shipping_forms (created_by, created_at DESC);
