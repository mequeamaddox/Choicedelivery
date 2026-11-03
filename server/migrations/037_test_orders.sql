-- Orders marked as tests (practice runs before real work): left out of the money-in and driver-pay report.
ALTER TABLE orders ADD COLUMN is_test BOOLEAN NOT NULL DEFAULT false;
