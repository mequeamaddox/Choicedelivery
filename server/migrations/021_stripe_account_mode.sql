-- Which Stripe mode (test or live) each driver's connected account was made in. Test accounts don't
-- exist in live mode, so after switching to live keys those drivers set up direct deposit again.
ALTER TABLE users ADD COLUMN stripe_account_mode TEXT CHECK (stripe_account_mode IN ('test', 'live'));
UPDATE users SET stripe_account_mode = 'test' WHERE stripe_account_id IS NOT NULL;
