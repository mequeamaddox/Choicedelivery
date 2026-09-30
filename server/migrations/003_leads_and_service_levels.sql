-- Service level drives default pricing (standard $25, same-day/rush $50; see src/pricing.js).
ALTER TABLE orders ADD COLUMN service_level TEXT NOT NULL DEFAULT 'standard'
  CHECK (service_level IN ('standard', 'same_day'));

-- Messages and business-plan requests from the public website (www.choicedeliverysc.com).
CREATE TABLE leads (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type        TEXT NOT NULL CHECK (type IN ('contact', 'contract', 'quote')),
  name        TEXT NOT NULL DEFAULT '',
  company     TEXT NOT NULL DEFAULT '',
  email       TEXT NOT NULL DEFAULT '',
  phone       TEXT NOT NULL DEFAULT '',
  message     TEXT NOT NULL DEFAULT '',
  plan        TEXT,
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  status      TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'won', 'closed')),
  ip          TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX leads_created_idx ON leads (created_at DESC);
CREATE INDEX leads_status_idx ON leads (status);
