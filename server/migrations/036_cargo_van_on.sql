-- Offer the cargo van again: turn it on in saved fee settings (the owner can still switch it off there).
UPDATE settings SET value = jsonb_set(value, '{vehicles,Cargo Van,enabled}', 'true'::jsonb)
WHERE key = 'fees' AND value->'vehicles' ? 'Cargo Van';
