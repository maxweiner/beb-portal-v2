-- Customer intakes — schema addendum for the rebuilt license scanner.
--
-- The original customer_intakes table was created by an earlier migration
-- (see supabase-migration-customer-intakes.sql). This addendum ADDS the
-- columns the new scanner needs without disturbing existing rows.
--
-- Safe to run repeatedly — every statement uses IF NOT EXISTS.

-- Middle name (new parser extracts DAD and the middle slot of DAA/DCT).
alter table public.customer_intakes
  add column if not exists middle_name text;

-- Issue date (AAMVA DBD).
alter table public.customer_intakes
  add column if not exists issue_date date;

-- Country of issuance (AAMVA DCG).
alter table public.customer_intakes
  add column if not exists country text;

-- AAMVA version number from the barcode header (01..10 currently in the wild).
alter table public.customer_intakes
  add column if not exists aamva_version integer;

-- SHA-256 hex digest of the raw barcode. Stored for dedup ONLY — the raw
-- barcode string is NEVER persisted. Combined with event_id in an index for
-- the duplicate-scan check.
alter table public.customer_intakes
  add column if not exists barcode_hash text;

-- Normalized height in inches (the original `height` text column stays for
-- backward compat with older rows; new rows populate both).
alter table public.customer_intakes
  add column if not exists height_inches integer;

-- Dedup index: one intake per (event, license) pair. Does not forbid the
-- same license being scanned at different events — only within a single
-- event, which is the behavior the scanner UI enforces.
create unique index if not exists customer_intakes_event_hash_idx
  on public.customer_intakes (event_id, barcode_hash)
  where barcode_hash is not null;

-- No policy changes — existing RLS (buyer-insert/select, admin-select,
-- nobody-can-update-or-delete) already covers the new columns.
