-- The owner turned off the lunch-rush surcharge. Update saved fee settings too (new defaults cover the rest).
UPDATE settings SET value = jsonb_set(value, '{surcharges,lunch,enabled}', 'false'), updated_at = now()
WHERE key = 'fees' AND value #> '{surcharges,lunch}' IS NOT NULL;
