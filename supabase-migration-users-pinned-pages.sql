-- ============================================================
-- Adds users.pinned_pages JSONB array of NavPage IDs.
--
-- Drives the "★ Pinned" section at the top of the sidebar (per-user
-- favorites — synced across devices, persists across sessions).
-- Empty array = no pinned items, sidebar shows just the regular
-- sections.
--
-- Safe to re-run.
-- ============================================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS pinned_pages JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.users.pinned_pages IS
  'Array of NavPage IDs the user has pinned to the top of their sidebar (e.g. ["dashboard","expenses","marketing"]). Order is preserved — drives the display order in the Pinned section.';

DO $$ BEGIN
  RAISE NOTICE 'users.pinned_pages installed (default empty array).';
END $$;
