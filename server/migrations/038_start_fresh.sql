-- One-time cleanup before real work starts (requested by the owner, Nov 2026): every order so far was a
-- test. Deletes all orders (their stops, proof, charges, history and driver alerts go with them), all
-- invoices and Net terms applications, and restarts numbering at CD-100001 and INV-1001. Companies,
-- logins, drivers, settings, leads and expenses stay. Runs once; a new database has nothing to delete.
DELETE FROM invoices;
DELETE FROM credit_applications;
DELETE FROM orders;
ALTER SEQUENCE order_number_seq RESTART WITH 100001;
ALTER SEQUENCE invoice_number_seq RESTART WITH 1001;
