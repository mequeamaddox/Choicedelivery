-- Guest checkout: people can book and pay for a one-off delivery without creating an account. Their
-- contact details are on the order (customer_name / customer_email / customer_phone) and they get the
-- order emails and a tracking link there.
ALTER TABLE orders
  ADD COLUMN is_guest BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN customer_phone TEXT;
