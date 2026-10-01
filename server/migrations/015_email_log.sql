-- Recent outgoing emails and whether Resend accepted them, shown on the owner's Account page so a failed
-- email (e.g. domain not verified) is visible without digging through server logs. Pruned to ~500 rows.
CREATE TABLE email_log (
  id         BIGSERIAL PRIMARY KEY,
  recipient  TEXT NOT NULL,
  subject    TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'not_configured')),
  error      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX email_log_created_idx ON email_log (created_at DESC);
