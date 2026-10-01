-- Where the driver's phone was when they arrived at and completed each stop, and how far that was
-- from the stop's address, so dispatch can see a stop was really done on site.
ALTER TABLE stops
  ADD COLUMN arrived_location JSONB,
  ADD COLUMN arrived_distance_m INTEGER,
  ADD COLUMN completed_location JSONB,
  ADD COLUMN completed_distance_m INTEGER;
