-- ── Wholesale: add mobile_phone columns ──
-- Vendors and wholesale customers each get a separate mobile phone
-- field alongside the existing landline phone. Both stored as raw
-- digits (formatted XXX-XXX-XXXX in the UI via PhoneInput).
--
-- Safe to re-run.

ALTER TABLE public.wholesale_vendors
  ADD COLUMN IF NOT EXISTS mobile_phone TEXT;

ALTER TABLE public.wholesale_customers
  ADD COLUMN IF NOT EXISTS mobile_phone TEXT;

-- Default existing customers without a payment-terms preference to
-- 'Net 30' to match the new-customer default. Doesn't touch rows
-- that already have a value.
UPDATE public.wholesale_customers
   SET default_payment_terms = 'Net 30'
 WHERE default_payment_terms IS NULL OR default_payment_terms = '';

DO $$ BEGIN
  RAISE NOTICE 'Added mobile_phone to wholesale_vendors + wholesale_customers; backfilled missing default_payment_terms to Net 30.';
END $$;
