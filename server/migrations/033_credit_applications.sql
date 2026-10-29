-- Customers applying to be billed on account (Net terms) instead of paying by card for each order.
CREATE TABLE credit_applications (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
  data             JSONB NOT NULL,
  submitted_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  submitted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at      TIMESTAMPTZ,
  approved_terms   INTEGER,
  credit_limit_cents INTEGER,
  decision_note    TEXT
);
CREATE INDEX credit_applications_org_idx ON credit_applications (organization_id, submitted_at DESC);
CREATE UNIQUE INDEX credit_applications_one_pending ON credit_applications (organization_id) WHERE status = 'pending';
ALTER TABLE organizations ADD COLUMN credit_limit_cents INTEGER;
