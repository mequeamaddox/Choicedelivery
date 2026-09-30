-- Sample data an admin can load and remove from the web app. Demo rows are flagged so removal
-- never touches real records, real drivers never see demo jobs, and demo orders don't affect pricing.
ALTER TABLE organizations ADD COLUMN is_demo BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN is_demo BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE orders ADD COLUMN is_demo BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE leads ADD COLUMN is_demo BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX orders_demo_idx ON orders (is_demo) WHERE is_demo;
