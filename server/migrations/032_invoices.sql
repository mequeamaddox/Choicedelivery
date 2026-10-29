-- Monthly invoices for companies billed on account ("Net 30"): every delivered order and extra charge
-- billed to the account goes on exactly one invoice.
ALTER TABLE organizations ADD COLUMN payment_terms_days INTEGER NOT NULL DEFAULT 30;
ALTER TABLE orders ADD COLUMN po_number TEXT;

CREATE SEQUENCE invoice_number_seq START 1001;

CREATE TABLE invoices (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  invoice_number    TEXT NOT NULL UNIQUE,
  period_start      DATE,
  period_end        DATE NOT NULL,
  issued_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  terms_days        INTEGER NOT NULL,
  due_date          DATE NOT NULL,
  total_cents       INTEGER NOT NULL,
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'void')),
  sent_at           TIMESTAMPTZ,
  sent_to           TEXT,
  reminded_at       TIMESTAMPTZ,
  paid_at           TIMESTAMPTZ,
  paid_method       TEXT,
  paid_note         TEXT,
  stripe_session_id TEXT,
  public_token      UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX invoices_org_idx ON invoices (organization_id, issued_at DESC);

CREATE TABLE invoice_lines (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  order_id    UUID REFERENCES orders(id) ON DELETE SET NULL,
  charge_id   UUID REFERENCES order_charges(id) ON DELETE SET NULL,
  day         DATE NOT NULL,
  description TEXT NOT NULL,
  reference   TEXT,
  cents       INTEGER NOT NULL,
  sequence    INTEGER NOT NULL
);
CREATE INDEX invoice_lines_invoice_idx ON invoice_lines (invoice_id, sequence);

ALTER TABLE orders ADD COLUMN invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL;
ALTER TABLE order_charges ADD COLUMN invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL;
CREATE INDEX orders_invoice_idx ON orders (invoice_id);
