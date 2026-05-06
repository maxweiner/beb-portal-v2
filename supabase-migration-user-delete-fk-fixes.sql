-- ── Make user-FK columns survive a hard delete ──────────────
-- Hard-deleting a user (Admin Panel → 🗑 Delete forever, gated
-- to Max's two emails) failed with:
--   update or delete on table "users" violates foreign key
--   constraint "event_days_entered_by_fkey" on table "event_days"
--
-- The FK was created without an ON DELETE clause, so Postgres
-- defaults to NO ACTION — meaning any reference blocks the
-- delete. Re-creates the constraint with ON DELETE SET NULL so
-- historical event_days rows survive the deletion with the
-- entered_by link nulled out. The denormalized
-- event_days.entered_by_name (a TEXT snapshot) is unaffected
-- so reports + recap PDFs still show the buyer's name.
--
-- Other event_days FKs to users (if any future migration adds
-- them) follow the same pattern.
--
-- Safe to re-run.
-- ============================================================

ALTER TABLE public.event_days
  DROP CONSTRAINT IF EXISTS event_days_entered_by_fkey;

ALTER TABLE public.event_days
  ADD CONSTRAINT event_days_entered_by_fkey
  FOREIGN KEY (entered_by) REFERENCES public.users(id) ON DELETE SET NULL;

DO $$ BEGIN
  RAISE NOTICE 'event_days.entered_by FK now ON DELETE SET NULL.';
END $$;
