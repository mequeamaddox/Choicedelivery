-- The owner's business expense log (fuel, insurance, phone, supplies...), with an optional receipt photo.
CREATE TABLE expenses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  day         DATE NOT NULL,
  cents       INTEGER NOT NULL CHECK (cents > 0),
  category    TEXT NOT NULL,
  vendor      TEXT NOT NULL DEFAULT '',
  note        TEXT NOT NULL DEFAULT '',
  receipt     TEXT,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX expenses_day_idx ON expenses (day DESC);
