-- ── Buying-event waitlist ────────────────────────────────────
-- Per-event walk-in waitlist. Each buying event gets a public
-- signup URL + QR code (handled by W-B); customers either add
-- themselves or staff add them via an internal UI.
--
-- Lifecycle:
--   • Customer joins (public or staff-added) — status='waiting'
--   • Buyer is free → staff "calls up" — status='called', SMS
--     sent if notify_pref='sms'
--   • Customer arrives at the buyer table — status='served'
--   • No-show after a reasonable wait — status='no_show'
--
-- Auto-clear at 7pm:
--   Each entry stores expires_at (computed by the signup endpoint
--   from the store's local 7pm). The active queue is filtered
--   `status='waiting' AND expires_at > now()`. Past-7pm signups
--   are rejected at the API layer ("Waitlist closed for today").
--   Expired rows stay in the table for end-of-event reporting.
--
-- Reporting:
--   The post-event tally counts ALL rows for the event regardless
--   of expiry, grouped by how_heard.
--
-- Safe to re-run.
-- ============================================================

DO $$ BEGIN
  CREATE TYPE event_waitlist_status AS ENUM (
    'waiting', 'called', 'served', 'no_show'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE event_waitlist_notify_pref AS ENUM ('sms', 'wait');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.event_waitlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,

  -- Customer-supplied at signup.
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  item_count INT NOT NULL CHECK (item_count >= 0),
  -- Free text drawn from the per-store booking_config.hear_about_options
  -- array (same source as appointments.how_heard) — kept as TEXT, not
  -- enum, so per-store custom values flow through naturally.
  how_heard TEXT,

  -- Origin: NULL when self-added via the public signup URL; user_id
  -- of the portal user (admin/buyer/etc.) when added internally.
  added_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,

  -- Notification preference at signup. 'wait' = customer is staying
  -- in the store, 'sms' = text them when they're up next.
  notify_pref event_waitlist_notify_pref NOT NULL DEFAULT 'wait',
  notified_at TIMESTAMPTZ,

  -- Lifecycle.
  status event_waitlist_status NOT NULL DEFAULT 'waiting',
  called_at TIMESTAMPTZ,
  called_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  served_at TIMESTAMPTZ,

  -- Auto-clear cutoff. Computed by the signup endpoint as today's
  -- 7pm in the store's local timezone (defaults to America/New_York
  -- if store has no timezone). Active queue = expires_at > now().
  expires_at TIMESTAMPTZ NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_waitlist_event
  ON public.event_waitlist (event_id);

-- Optimizes the active-queue query: WHERE event_id=X AND
-- status='waiting' AND expires_at > now() ORDER BY created_at.
CREATE INDEX IF NOT EXISTS idx_event_waitlist_active
  ON public.event_waitlist (event_id, expires_at)
  WHERE status = 'waiting';

-- Touch updated_at on every UPDATE.
CREATE OR REPLACE FUNCTION public.touch_event_waitlist_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_event_waitlist_touch ON public.event_waitlist;
CREATE TRIGGER trg_event_waitlist_touch
BEFORE UPDATE ON public.event_waitlist
FOR EACH ROW EXECUTE FUNCTION public.touch_event_waitlist_updated_at();

-- ── RLS ──────────────────────────────────────────────────────
-- The public signup endpoint uses the service-role key (bypasses
-- RLS), so anonymous users never touch this table directly. RLS
-- here only governs portal users:
--   • SELECT: any authenticated user (buyers need to see queues)
--   • INSERT/UPDATE: any authenticated user (collaborative — audit
--     columns capture who did what)
--   • DELETE: admin/superadmin/partner only (destructive)
ALTER TABLE public.event_waitlist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_waitlist_select" ON public.event_waitlist;
CREATE POLICY "event_waitlist_select"
  ON public.event_waitlist FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "event_waitlist_insert" ON public.event_waitlist;
CREATE POLICY "event_waitlist_insert"
  ON public.event_waitlist FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "event_waitlist_update" ON public.event_waitlist;
CREATE POLICY "event_waitlist_update"
  ON public.event_waitlist FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "event_waitlist_delete" ON public.event_waitlist;
CREATE POLICY "event_waitlist_delete"
  ON public.event_waitlist FOR DELETE TO authenticated
  USING (
    public.get_my_role() IN ('admin','superadmin')
    OR EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.email = auth.jwt()->>'email' AND u.is_partner IS TRUE
    )
  );

DO $$ BEGIN
  RAISE NOTICE 'event_waitlist installed (status + notify_pref enums, RLS, indexes, touch trigger).';
END $$;
