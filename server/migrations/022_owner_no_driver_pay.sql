-- Owners who also drive: their deliveries owe no driver pay (the money already stays in the business).
ALTER TABLE users ADD COLUMN no_driver_pay BOOLEAN NOT NULL DEFAULT false;
