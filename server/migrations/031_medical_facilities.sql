-- Medical facilities (labs, clinics, pharmacies): every order they book has chain of custody.
ALTER TABLE organizations ADD COLUMN is_medical BOOLEAN NOT NULL DEFAULT false;
