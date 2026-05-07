-- ── Broadcast tool: schema + nav module ─────────────────────
-- Superadmin/partner-only message blasts to all users / a specific
-- role / a chosen list of users. Tracks per-recipient delivery,
-- opens, and clicks (Resend webhooks). Optional in-app banner
-- mirrors the email so phone-only people who skip inboxes still
-- see the message.
--
-- Safe to re-run.
-- ============================================================

-- 1. Add 'broadcast' to the role_modules CHECK constraint.
DO $$
DECLARE
  conname text;
BEGIN
  SELECT c.conname INTO conname
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  WHERE t.relname = 'role_modules' AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) ILIKE '%module_id%';
  IF conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE role_modules DROP CONSTRAINT %I', conname);
  END IF;
END $$;

ALTER TABLE role_modules ADD CONSTRAINT role_modules_module_id_check
  CHECK (module_id IN (
    'dashboard',
    'appointments', 'buying-events', 'calendar', 'travel', 'dayentry',
    'buying-event-stores',
    'trade-shows', 'trunk-shows', 'trunk-show-stores',
    'trunk-communications', 'leads',
    'marketing', 'shipping', 'expenses', 'reports', 'customers',
    'admin', 'liberty-admin',
    'staff', 'data-research', 'financials',
    'recipients', 'notification-templates',
    'accounting-queue',
    'broadcast'   -- NEW: superadmin/partner messaging tool
  ));

INSERT INTO role_modules (role_id, module_id) VALUES
  ('admin',      'broadcast'),
  ('superadmin', 'broadcast')
ON CONFLICT (role_id, module_id) DO NOTHING;

-- 2. broadcasts — one row per send.
CREATE TABLE IF NOT EXISTS public.broadcasts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE SET NULL,
  brand           TEXT NOT NULL CHECK (brand IN ('beb', 'liberty')),
  subject         TEXT NOT NULL,
  -- HTML body rendered by the rich-text editor. Already inline-styled
  -- by the build step before storage so we can email it as-is.
  body_html       TEXT NOT NULL,
  cta_label       TEXT,
  cta_url         TEXT,
  -- Recipient scope. Exactly one of these shapes is meaningful per
  -- broadcast — the API enforces.
  scope_kind      TEXT NOT NULL CHECK (scope_kind IN ('all', 'role', 'individual')),
  scope_role      TEXT,                   -- when kind='role'
  scope_user_ids  UUID[] NOT NULL DEFAULT '{}',  -- when kind='individual'
  show_in_app     BOOLEAN NOT NULL DEFAULT FALSE,
  recipient_count INT NOT NULL DEFAULT 0,
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_broadcasts_sender ON public.broadcasts(sender_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_broadcasts_brand  ON public.broadcasts(brand, sent_at DESC);

ALTER TABLE public.broadcasts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS broadcasts_read ON public.broadcasts;
CREATE POLICY broadcasts_read ON public.broadcasts
  FOR SELECT TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin')
    OR COALESCE((SELECT u.is_partner FROM public.users u WHERE u.id = public.get_effective_user_id()), FALSE)
  );

-- All writes go through the API (admin client) so no INSERT/UPDATE
-- policies are needed — RLS denies by default.

-- 3. broadcast_recipients — one row per (broadcast, user/email).
CREATE TABLE IF NOT EXISTS public.broadcast_recipients (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id    UUID NOT NULL REFERENCES public.broadcasts(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES public.users(id) ON DELETE SET NULL,
  email           TEXT NOT NULL,
  -- Status starts as 'queued', becomes 'sent' after the Resend POST,
  -- 'failed' on error. Resend webhooks update opened_at + clicked_at
  -- on top of the send status.
  status          TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued','sent','failed','bounced','complained')),
  resend_id       TEXT,                       -- Resend message id; used by webhooks
  error_text      TEXT,
  sent_at         TIMESTAMPTZ,
  delivered_at    TIMESTAMPTZ,
  opened_at       TIMESTAMPTZ,
  clicked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_broadcast ON public.broadcast_recipients(broadcast_id);
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_resend_id ON public.broadcast_recipients(resend_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_broadcast_recipients_unique ON public.broadcast_recipients(broadcast_id, email);

ALTER TABLE public.broadcast_recipients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS broadcast_recipients_read ON public.broadcast_recipients;
CREATE POLICY broadcast_recipients_read ON public.broadcast_recipients
  FOR SELECT TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin')
    OR COALESCE((SELECT u.is_partner FROM public.users u WHERE u.id = public.get_effective_user_id()), FALSE)
  );

-- 4. broadcast_dismissals — per-user dismiss state for the in-app banner.
CREATE TABLE IF NOT EXISTS public.broadcast_dismissals (
  user_id        UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  broadcast_id   UUID NOT NULL REFERENCES public.broadcasts(id) ON DELETE CASCADE,
  dismissed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, broadcast_id)
);
CREATE INDEX IF NOT EXISTS idx_broadcast_dismissals_broadcast ON public.broadcast_dismissals(broadcast_id);

ALTER TABLE public.broadcast_dismissals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS broadcast_dismissals_select ON public.broadcast_dismissals;
CREATE POLICY broadcast_dismissals_select ON public.broadcast_dismissals
  FOR SELECT TO authenticated
  USING (user_id = public.get_effective_user_id() OR public.has_any_role('admin', 'superadmin'));

DROP POLICY IF EXISTS broadcast_dismissals_insert ON public.broadcast_dismissals;
CREATE POLICY broadcast_dismissals_insert ON public.broadcast_dismissals
  FOR INSERT TO authenticated
  WITH CHECK (user_id = public.get_effective_user_id());

DO $$ BEGIN
  RAISE NOTICE 'Broadcast module installed. Tables: broadcasts, broadcast_recipients, broadcast_dismissals. Module granted to admin + superadmin.';
END $$;
