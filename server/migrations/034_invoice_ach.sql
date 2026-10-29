-- A bank (ACH) payment on an invoice takes a few days to clear; this marks it as on its way.
ALTER TABLE invoices ADD COLUMN payment_processing_at TIMESTAMPTZ;
