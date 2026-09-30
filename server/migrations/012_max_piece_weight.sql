-- Weight of the heaviest single piece. Orders with a piece over the limit (fees.maxPieceLbs, default 75)
-- can't be booked: one driver has to be able to lift every piece.
ALTER TABLE orders ADD COLUMN max_piece_lbs NUMERIC;
