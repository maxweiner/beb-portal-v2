-- ── Trunk shows: per-milestone "who marked it done" audit columns ──
--
-- The sheet-style admin UI (Trunk Show Events) needs to know not just
-- *when* each marketing milestone was checked off, but *who* did it.
-- The existing schema (see supabase-migration-trunk-shows-import-schema.sql)
-- only stores the date — NULL DATE means not done, set DATE means done,
-- but we lose the actor.
--
-- Adding a nullable user FK alongside each milestone date. The sheet
-- UI will not render these (per spec — date-only on screen), but they
-- power the audit log + hover-tooltip if surfaced later. Existing rows
-- get NULL since we never recorded the actor; new actions populate it.
--
-- Six milestones mirror the existing *_at columns:
--   confirmation_letter_sent
--   postcards_email_sent
--   postcards_ordered
--   proofed
--   final_files_sent
--   post_event_questionnaire_sent
--
-- ON DELETE SET NULL so deleting a user doesn't blow away historical
-- trunk-show rows; the milestone date stays, the actor goes anonymous.
--
-- Safe to re-run.
-- ============================================================

ALTER TABLE public.trunk_shows
  ADD COLUMN IF NOT EXISTS confirmation_letter_sent_by      UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS postcards_email_sent_by          UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS postcards_ordered_by             UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS proofed_by                       UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS final_files_sent_by              UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS post_event_questionnaire_sent_by UUID REFERENCES public.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.trunk_shows.confirmation_letter_sent_by IS
  'User who marked confirmation_letter_sent_at. NULL for legacy rows or unchecked.';
COMMENT ON COLUMN public.trunk_shows.postcards_email_sent_by IS
  'User who marked postcards_email_sent_at. NULL for legacy rows or unchecked.';
COMMENT ON COLUMN public.trunk_shows.postcards_ordered_by IS
  'User who marked postcards_ordered_at. NULL for legacy rows or unchecked.';
COMMENT ON COLUMN public.trunk_shows.proofed_by IS
  'User who marked proofed_at. NULL for legacy rows or unchecked.';
COMMENT ON COLUMN public.trunk_shows.final_files_sent_by IS
  'User who marked final_files_sent_at. NULL for legacy rows or unchecked.';
COMMENT ON COLUMN public.trunk_shows.post_event_questionnaire_sent_by IS
  'User who marked post_event_questionnaire_sent_at. NULL for legacy rows or unchecked.';

DO $$ BEGIN
  RAISE NOTICE 'Trunk shows: six nullable *_by columns added for milestone audit. Sheet UI does not render these — they back the audit log only.';
END $$;
