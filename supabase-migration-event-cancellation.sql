-- ── Cancel-event flow: schema + enum tweaks ─────────────────
-- Adds the columns the new /api/events/[id]/cancel endpoint
-- writes to, plus extends the marketing_status enum to include
-- 'paused' so we can pause campaigns when their event is
-- cancelled (already-mailed pieces stay mailed; pending stops).
--
-- events.status enum already has 'cancelled' as a valid value
-- (per supabase-migration-save-the-date-status.sql), so no
-- change to the enum itself.
--
-- Also blocks new public bookings against cancelled events at
-- the database level via a CHECK on the appointments insert
-- path... actually, the API enforces that. Skipping a DB CHECK
-- since cancelled events can still receive admin-side overrides.
--
-- Safe to re-run.
-- ============================================================

-- 1. events: cancellation columns
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS cancelled_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by         UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancellation_reason  TEXT;

COMMENT ON COLUMN public.events.cancelled_at IS
  'Set when status flips to cancelled. NULL otherwise. cancelled_by + cancellation_reason are filled at the same time.';

-- 2. marketing_status: add 'paused' so the cancel endpoint can
--    flag campaigns without losing their existing data.
DO $$ BEGIN
  ALTER TYPE marketing_status ADD VALUE IF NOT EXISTS 'paused';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  RAISE NOTICE 'Event cancellation schema installed: events.cancelled_at + cancelled_by + cancellation_reason; marketing_status now includes paused.';
END $$;
