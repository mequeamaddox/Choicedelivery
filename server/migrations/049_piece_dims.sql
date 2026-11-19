-- The size of the largest piece (inches), so the vehicle is picked by size as well as weight.
ALTER TABLE orders ADD COLUMN piece_dims JSONB; -- { "l": 48, "w": 40, "h": 36 }
