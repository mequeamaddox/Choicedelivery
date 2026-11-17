-- Messages between dispatch and drivers. Each driver has one conversation with dispatch (any owner or
-- dispatcher can read and reply). A message to all drivers is copied into every driver's conversation.
CREATE TABLE messages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  from_staff   BOOLEAN NOT NULL,
  body         TEXT NOT NULL,
  order_id     UUID REFERENCES orders(id) ON DELETE SET NULL,
  broadcast    BOOLEAN NOT NULL DEFAULT false,
  read_at      TIMESTAMPTZ, -- when the other side (the driver, or dispatch) read it
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX messages_driver_idx ON messages (driver_id, created_at DESC);
CREATE INDEX messages_unread_idx ON messages (driver_id, from_staff) WHERE read_at IS NULL;
