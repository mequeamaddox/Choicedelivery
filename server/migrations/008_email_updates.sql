-- Shippers get order status emails unless they turn them off (Account page).
ALTER TABLE users ADD COLUMN email_updates BOOLEAN NOT NULL DEFAULT true;
