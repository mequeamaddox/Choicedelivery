-- Reminders to driver applicants who haven't finished their application (2 days, then a week after applying).
ALTER TABLE users ADD COLUMN application_reminders INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN application_reminded_at TIMESTAMPTZ;
