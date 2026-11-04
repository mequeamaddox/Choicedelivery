-- Phone alerts for dispatch (the "Choice Dispatch" home-screen app): one row per phone or browser that
-- turned alerts on, and which kinds of alerts each person wants (missing = on).
CREATE TABLE web_push_subscriptions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  device     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_sent_at TIMESTAMPTZ
);
CREATE INDEX web_push_subscriptions_user ON web_push_subscriptions (user_id);
ALTER TABLE users ADD COLUMN push_prefs JSONB NOT NULL DEFAULT '{}';
