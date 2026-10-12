-- Mileage log for drivers (for taxes): miles counted automatically from the locations the app sends
-- while a driver is online, per day (Columbia time), plus trips the driver adds by hand.
CREATE TABLE driver_mileage (
  driver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day       DATE NOT NULL,
  miles     NUMERIC(9,2) NOT NULL DEFAULT 0,  -- all tracked miles while online
  job_miles NUMERIC(9,2) NOT NULL DEFAULT 0,  -- the part driven with a job in progress
  PRIMARY KEY (driver_id, day)
);

CREATE TABLE mileage_entries (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day        DATE NOT NULL,
  miles      NUMERIC(7,1) NOT NULL CHECK (miles > 0 AND miles <= 2000),
  note       TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX mileage_entries_driver_day_idx ON mileage_entries (driver_id, day);
