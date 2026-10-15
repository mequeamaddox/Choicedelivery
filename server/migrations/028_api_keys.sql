-- API keys for customers' own systems (e.g. a parts store sending orders from its software). Each key
-- acts as the customer account that made it, so it only sees that company's orders. Only a hash of
-- the key is stored; the key itself is shown once when it's created.
CREATE TABLE api_keys (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL DEFAULT '',
  prefix       TEXT NOT NULL,          -- first characters, to tell keys apart in lists
  key_hash     TEXT NOT NULL UNIQUE,   -- sha256 of the key
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ
);
CREATE INDEX api_keys_user_idx ON api_keys (user_id);
