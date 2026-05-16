-- ============================================================
-- Buying Communications phase 3c-i: schedule-send support
--
-- Extends buying_communication_sends with the same scheduling
-- columns trunk-side ships in supabase-migration-trunk-comms-
-- schedule-send.sql. A 'scheduled' row carries scheduled_for
-- (the date+time the cron should fire it at) and starts in
-- delivery_status='scheduled'. The /api/cron/buying-comms-fire-
-- due worker selects due rows, calls Resend, flips status to
-- 'sent' or 'failed'.
--
-- The 'scheduled' + 'cancelled' enum values are added by the
-- trunk-side migration on communication_delivery_status — we
-- reuse the enum, so no enum changes here. If you're running
-- this BEFORE the trunk schedule-send migration, run that one
-- first.
--
-- Safe to re-run. Idempotent.
-- ============================================================

ALTER TABLE public.buying_communication_sends
  ADD COLUMN IF NOT EXISTS scheduled_for         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS scheduled_by_user_id  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS scheduled_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by_user_id  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS failure_reason        TEXT;

-- Index for the cron worker's due-row query.
CREATE INDEX IF NOT EXISTS idx_buying_comm_sends_scheduled_due
  ON public.buying_communication_sends (scheduled_for)
  WHERE delivery_status = 'scheduled';

-- Scheduled rows have NULL sent_at until the cron fires them.
-- Phase 2's NOT NULL conflicts; drop it.
ALTER TABLE public.buying_communication_sends
  ALTER COLUMN sent_at DROP NOT NULL;

DO $$ BEGIN
  RAISE NOTICE 'Buying-comms schedule-send columns + index installed. Sent_at is now nullable for scheduled rows.';
END $$;
