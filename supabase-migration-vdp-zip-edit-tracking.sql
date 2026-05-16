-- ============================================================
-- VDP zip-code edit tracking
--
-- After a VDP campaign is approved, the zip-code list used to be
-- frozen (read-only chip display). Operators sometimes need to edit
-- it (e.g., drop a zip that was returned undeliverable, add one that
-- got missed). This adds:
--   1. `zips_last_edited_at` + `zips_last_edited_by` columns on
--      vdp_campaign_details so the UI can show 'Last edited Apr 7
--      by Diane' under the chip list.
--   2. RLS adjustments not needed — the existing policies on
--      vdp_zip_codes already permit writes for users with marketing
--      access.
--
-- Audit trail of edits is delivered via email — every edit triggers
-- a notification to all superadmin users via /api/marketing/campaigns/
-- [id]/edit-zips. The columns here just power the in-app 'last
-- edited by' chip.
--
-- Safe to re-run. Idempotent.
-- ============================================================

ALTER TABLE public.vdp_campaign_details
  ADD COLUMN IF NOT EXISTS zips_last_edited_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS zips_last_edited_by UUID NULL
    REFERENCES public.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.vdp_campaign_details.zips_last_edited_at IS
  'Set when a user edits the zip list AFTER initial approval via /api/marketing/campaigns/[id]/edit-zips. NULL when the zips have never been edited post-approval (the original submitted+approved list is still in place).';
COMMENT ON COLUMN public.vdp_campaign_details.zips_last_edited_by IS
  'User who last edited the zip list post-approval. Pairs with zips_last_edited_at to power the UI chip.';

DO $$ BEGIN
  RAISE NOTICE 'vdp_campaign_details.zips_last_edited_at / _by installed. UI can now surface a Last-edited chip; /api/marketing/campaigns/[id]/edit-zips writes both.';
END $$;
