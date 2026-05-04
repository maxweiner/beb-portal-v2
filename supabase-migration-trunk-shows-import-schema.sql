-- ── Trunk shows: re-anchor to trunk_show_stores + import fields ──
--
-- Two changes bundled because they're tightly coupled by the
-- spreadsheet import that follows:
--
-- 1. trunk_shows.store_id was FK'd to public.stores (the BEB
--    buying-event store list, brand-tagged 'beb' / 'liberty').
--    The actual trunk-show clients live in trunk_show_stores
--    (Garcia & Co, Adler's Diamonds, etc.). Repoint the FK so
--    the model matches reality. assigned_rep_id loses NOT NULL
--    so an import without a known rep can land as unassigned.
--
-- 2. The marketing/show-prep workflow has six milestone dates
--    plus a VIP flag. Add columns. Each milestone is a single
--    nullable DATE — NULL = not done.
--
-- We're not live yet so we wipe trunk_shows + cascade. Importer
-- repopulates from the spreadsheet (the source of truth).
--
-- Safe to re-run.
-- ============================================================

-- 1. Wipe (cascades to slots / bookings / spiffs / hours / tokens
--    via existing ON DELETE CASCADE constraints).
TRUNCATE TABLE public.trunk_shows CASCADE;

-- 2. Repoint store_id FK from stores → trunk_show_stores.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.trunk_shows'::regclass
       AND conname  = 'trunk_shows_store_id_fkey'
  ) THEN
    ALTER TABLE public.trunk_shows DROP CONSTRAINT trunk_shows_store_id_fkey;
  END IF;
END $$;

ALTER TABLE public.trunk_shows
  ADD CONSTRAINT trunk_shows_store_id_fkey
  FOREIGN KEY (store_id) REFERENCES public.trunk_show_stores(id) ON DELETE RESTRICT;

-- 3. Allow unassigned trunk shows.
ALTER TABLE public.trunk_shows
  ALTER COLUMN assigned_rep_id DROP NOT NULL;

-- 4. New marketing/show-prep columns.
ALTER TABLE public.trunk_shows
  ADD COLUMN IF NOT EXISTS vip_showing                       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS confirmation_letter_sent_at       DATE,
  ADD COLUMN IF NOT EXISTS postcards_email_sent_at           DATE,
  ADD COLUMN IF NOT EXISTS postcards_ordered_at              DATE,
  ADD COLUMN IF NOT EXISTS proofed_at                        DATE,
  ADD COLUMN IF NOT EXISTS final_files_sent_at               DATE,
  ADD COLUMN IF NOT EXISTS post_event_questionnaire_sent_at  DATE;

COMMENT ON COLUMN public.trunk_shows.vip_showing IS
  'VIP Showing flag from the marketing tracker spreadsheet.';
COMMENT ON COLUMN public.trunk_shows.confirmation_letter_sent_at IS
  'Date the confirmation letter went out. NULL = not done yet.';
COMMENT ON COLUMN public.trunk_shows.postcards_email_sent_at IS
  'Date the post-card email went to the store. NULL = not done.';
COMMENT ON COLUMN public.trunk_shows.postcards_ordered_at IS
  'Date the postcards were ordered for printing. NULL = not done.';
COMMENT ON COLUMN public.trunk_shows.proofed_at IS
  'Date the postcard proofs were approved. NULL = not done.';
COMMENT ON COLUMN public.trunk_shows.final_files_sent_at IS
  'Date the final printed-ready files were sent. NULL = not done.';
COMMENT ON COLUMN public.trunk_shows.post_event_questionnaire_sent_at IS
  'Date the post-event questionnaire went to the store. NULL = not done.';

DO $$ BEGIN
  RAISE NOTICE 'Trunk shows: store_id now references trunk_show_stores; assigned_rep_id is nullable; six milestone date columns + vip_showing installed. Existing trunk_shows rows wiped — run the importer next.';
END $$;
