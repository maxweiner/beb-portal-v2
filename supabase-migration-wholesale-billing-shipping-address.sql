-- ── Wholesale: split address into billing + shipping ──
-- wholesale_customers and wholesale_vendors each had a single TEXT
-- `address` column. In B2B jewelry, the bill-to address (corporate
-- accounting office) and the ship-to address (the store / location)
-- are frequently different — single-field setups force the user to
-- pick one and lose the other on memos/invoices.
--
-- Strategy:
--   1. Add billing_address + shipping_address columns to both tables.
--   2. Backfill BOTH from the existing `address` column so day-one
--      data is sane (most vendors/customers really do have one
--      shared address; this preserves that as the default).
--   3. Keep the legacy `address` column. New app code writes to
--      address = billing_address so older PDF / API paths that still
--      read `address` keep working without per-call branching.
--      A future migration can drop `address` once nothing reads it.
--
-- Safe to re-run.

ALTER TABLE public.wholesale_customers
  ADD COLUMN IF NOT EXISTS billing_address  TEXT,
  ADD COLUMN IF NOT EXISTS shipping_address TEXT;

ALTER TABLE public.wholesale_vendors
  ADD COLUMN IF NOT EXISTS billing_address  TEXT,
  ADD COLUMN IF NOT EXISTS shipping_address TEXT;

-- Backfill from legacy `address` where the new columns are still null
-- (COALESCE pattern keeps the migration idempotent — a re-run won't
-- clobber values an admin has already updated). Both addresses get
-- the same backfill because for an existing row we have no way to
-- distinguish bill-to from ship-to.
UPDATE public.wholesale_customers
SET billing_address  = COALESCE(billing_address,  address),
    shipping_address = COALESCE(shipping_address, address)
WHERE address IS NOT NULL
  AND (billing_address IS NULL OR shipping_address IS NULL);

UPDATE public.wholesale_vendors
SET billing_address  = COALESCE(billing_address,  address),
    shipping_address = COALESCE(shipping_address, address)
WHERE address IS NOT NULL
  AND (billing_address IS NULL OR shipping_address IS NULL);

DO $$ BEGIN
  RAISE NOTICE 'Added billing_address + shipping_address to wholesale_customers and wholesale_vendors; backfilled from legacy address column.';
END $$;
