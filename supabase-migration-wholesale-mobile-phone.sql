-- ── Wholesale: mobile phone, Net 30 backfill, inventory gender ──
-- Three small additive changes bundled in one runnable file:
--
--   1. mobile_phone column on wholesale_vendors + wholesale_customers
--   2. Backfill default_payment_terms = 'Net 30' on customers that
--      have no preference set yet
--   3. gender column on inventory_items (Female / Male / Unisex /
--      NULL for items where gender doesn't apply, e.g. loose
--      diamonds)
--
-- Safe to re-run.

ALTER TABLE public.wholesale_vendors
  ADD COLUMN IF NOT EXISTS mobile_phone TEXT;

ALTER TABLE public.wholesale_customers
  ADD COLUMN IF NOT EXISTS mobile_phone TEXT;

UPDATE public.wholesale_customers
   SET default_payment_terms = 'Net 30'
 WHERE default_payment_terms IS NULL OR default_payment_terms = '';

ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS gender TEXT
  CHECK (gender IS NULL OR gender IN ('Female','Male','Unisex'));

DO $$ BEGIN
  RAISE NOTICE 'Added mobile_phone to vendors+customers; backfilled Net 30; added gender to inventory_items (Female/Male/Unisex).';
END $$;
