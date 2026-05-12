-- ============================================================
-- stores: add store_phone + quo_phone_number
--
-- Two new phone columns on `public.stores`:
--   - store_phone        — the store's main public-facing line.
--                          Distinct from owner_phone (the owner's
--                          personal contact, already exists).
--   - quo_phone_number   — the QUO tracking number used on marketing
--                          materials (postcards, ads). Surfaces in
--                          CampaignDetail so the marketer can read it
--                          off without leaving the campaign view.
--
-- Phone values stored as raw 10-digit strings; UI formats with dashes
-- (XXX-XXX-XXXX) via the shared PhoneInput component.
--
-- Naming mirrors the existing `trunk_show_stores.store_phone` and
-- `trunk_show_stores.quo_phone_number` columns from the trunk-show
-- side so the two store tables stay symmetric.
--
-- Idempotent.
-- ============================================================

DO $$ BEGIN
  IF to_regclass('public.stores') IS NULL THEN
    RAISE NOTICE 'skip stores (table missing)';
    RETURN;
  END IF;

  BEGIN
    ALTER TABLE public.stores
      ADD COLUMN IF NOT EXISTS store_phone TEXT;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'stores.store_phone add skipped: %', SQLERRM;
  END;

  BEGIN
    ALTER TABLE public.stores
      ADD COLUMN IF NOT EXISTS quo_phone_number TEXT;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'stores.quo_phone_number add skipped: %', SQLERRM;
  END;
END $$;

DO $$ BEGIN
  RAISE NOTICE 'stores: store_phone + quo_phone_number ready.';
END $$;
