-- ── Trunk-comms: Schedule Send feature
--
-- Extends communication_sends to support pre-scheduled sends. A
-- scheduled row carries scheduled_for (the date+time the cron worker
-- should fire it at) and starts in delivery_status='scheduled'. The
-- cron worker selects all due rows, fires them through the existing
-- /api/communications/send pipeline, and flips status to 'sent' or
-- 'failed' depending on outcome.
--
-- The 9 AM trigger is computed at schedule time (UI picks a date;
-- server resolves the store's state → tz and stores 9 AM local as
-- a timestamptz). We don't need a recurring schedule — these are
-- one-shot sends.
--
-- Safe to re-run.
-- ============================================================

-- 1. Extend the delivery_status enum.
DO $$ BEGIN
  ALTER TYPE communication_delivery_status ADD VALUE IF NOT EXISTS 'scheduled' BEFORE 'sent';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE communication_delivery_status ADD VALUE IF NOT EXISTS 'cancelled';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Schedule + lifecycle columns on communication_sends.
ALTER TABLE public.communication_sends
  ADD COLUMN IF NOT EXISTS scheduled_for         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS scheduled_by_user_id  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS scheduled_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by_user_id  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS failure_reason        TEXT;

-- 3. Index for the cron worker's "due" query.
CREATE INDEX IF NOT EXISTS idx_comm_sends_scheduled_due
  ON public.communication_sends (scheduled_for)
  WHERE delivery_status = 'scheduled';

-- 4. The existing trunk-comms-phase-1 NOT NULL on sent_at conflicts
--    with scheduled rows that haven't been sent yet. Drop the NOT
--    NULL — it's only meaningful once a row has fired.
ALTER TABLE public.communication_sends
  ALTER COLUMN sent_at DROP NOT NULL;

DO $$ BEGIN
  RAISE NOTICE 'Schedule-send columns + statuses installed.';
END $$;
