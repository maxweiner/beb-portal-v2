-- ============================================================
-- Buying Communications phase 2: send log + delivery tracking
--
-- Mirrors communication_sends (trunk side) but tied to events
-- instead of trunk_shows. New column cc_emails (TEXT[]) captures
-- the user-CC picker that buying-comms adds beyond what trunk has.
-- bcc_emails reserved for future use; populated by the server
-- send route per request.
--
-- Reuses the existing `communication_delivery_status` ENUM that
-- ships in supabase-migration-trunk-comms-phase-1.sql — no new
-- type needed.
--
-- RLS: read = anyone with buying-communications module access,
-- write = same gate. Mirrors the trunk-side policy shape (auth_id
-- against users.auth_id, never inline email match).
--
-- Safe to re-run. Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.buying_communication_sends (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id                    UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  template_id                 UUID REFERENCES public.buying_communication_templates(id) ON DELETE SET NULL,
  -- schedule_id reserved for phase 3 auto-schedules. No FK yet —
  -- the schedules table doesn't exist; phase 3 will add it + the
  -- constraint together.
  schedule_id                 UUID,
  sent_by_user_id             UUID REFERENCES public.users(id) ON DELETE SET NULL,
  sent_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),

  from_email                  TEXT NOT NULL,
  from_name                   TEXT NOT NULL,
  to_email                    TEXT NOT NULL,
  to_name                     TEXT,
  -- User-picked CC list. Resolved at send time from
  -- buying_communication_sends_cc_users (or inline user IDs the
  -- client passes) so the recipient can see who else got the email.
  cc_emails                   TEXT[] NOT NULL DEFAULT '{}',
  bcc_emails                  TEXT[] NOT NULL DEFAULT '{}',
  subject_line_rendered       TEXT NOT NULL,
  body_rendered               TEXT NOT NULL,
  pdf_url                     TEXT,

  -- Delivery tracking via Resend webhooks (phase 3+).
  resend_message_id           TEXT,
  delivery_status             communication_delivery_status NOT NULL DEFAULT 'sent',
  delivery_status_updated_at  TIMESTAMPTZ,

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_buying_comm_sends_event
  ON public.buying_communication_sends (event_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_buying_comm_sends_template
  ON public.buying_communication_sends (template_id);
CREATE INDEX IF NOT EXISTS idx_buying_comm_sends_resend_msgid
  ON public.buying_communication_sends (resend_message_id) WHERE resend_message_id IS NOT NULL;

ALTER TABLE public.buying_communication_sends ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Buying-comms-sends read" ON public.buying_communication_sends;
CREATE POLICY "Buying-comms-sends read"
  ON public.buying_communication_sends FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.auth_id = auth.uid()
      AND (u.role IN ('admin','superadmin') OR u.is_partner = TRUE)
  ));

-- INSERT is service-role only (via /api/buying-communications/send).
-- No client-side INSERT policy on purpose — keeps the audit trail
-- honest. Trunk-side uses the same shape.

DO $$ BEGIN
  RAISE NOTICE 'buying_communication_sends installed. Send route /api/buying-communications/send can now log letters; read access is admin/partner via RLS.';
END $$;
