-- Where website visitors came from (ad click IDs, utm_* tags, referring site), so leads, signups and
-- quote requests can be credited to the ad or source that brought them. See src/attribution.js.
ALTER TABLE leads ADD COLUMN attribution JSONB;
ALTER TABLE users ADD COLUMN attribution JSONB;

-- One row per website action (quote, contact message, plan request, signup, driver application).
-- Quotes aren't saved anywhere else, so this is the only record of them.
CREATE TABLE site_events (
  id BIGSERIAL PRIMARY KEY,
  kind TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'direct',
  attribution JSONB,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX site_events_created_at_idx ON site_events (created_at DESC);
