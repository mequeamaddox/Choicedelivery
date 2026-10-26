-- Chain of custody (medical and other sensitive deliveries): the driver counts the pieces, and checks the
-- seal number if there is one, at every handoff.
ALTER TABLE orders
  ADD COLUMN custody_required BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN seal_number TEXT,
  ADD COLUMN temperature TEXT;
ALTER TABLE stops
  ADD COLUMN piece_count INTEGER,
  ADD COLUMN seal_seen TEXT;
