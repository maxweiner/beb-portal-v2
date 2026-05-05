-- ── Trunk Communications + Pre-Event Checklist (phase 1: schema) ──
-- Sales reps send templated letters to trunk show stores at preset
-- times before each event. This phase adds:
--
--   1. communication_templates       — admin-managed letter content
--   2. communication_send_schedules  — preset send times per template
--   3. communication_sends           — log of every letter sent
--   4. trunk_show_checklist_master   — admin-managed per-event tasks
--   5. trunk_show_checklist_items    — per-trunk-show task instances
--
-- Plus contact-info cleanup on trunk_show_stores (single canonical
-- "primary contact" pair instead of free-form email_1/email_2 +
-- contact_1/contact_2/contact_3).
--
-- Outbound email uses the existing Resend integration (lib/email.ts),
-- not Postmark — Postmark is inbound-webhook-only in this codebase.
-- Domain verification for bebllp.com on Resend is therefore the only
-- thing that matters; the spec's postmark_domain_verification table
-- is intentionally NOT created.
--
-- RLS pattern:
--   - admin/superadmin/partner: full read/write everywhere
--   - sales_rep role: read-only on templates + schedules; read/write
--     on sends + checklist items for trunk shows assigned to them
--   - everyone else: no access
--
-- Safe to re-run.
-- ============================================================

-- ── 0. Enums ──────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE communication_assigned_role AS ENUM ('admin', 'rep', 'both');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE communication_linked_action AS ENUM (
    'send_communication', 'marketing_postcard', 'marketing_proof', 'none'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE communication_delivery_status AS ENUM (
    'sent', 'delivered', 'bounced', 'failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 1. trunk_show_stores: primary contact pair ──────────────
-- Single canonical recipient, backfilled from existing email_1
-- + contact_1 when null. Rest of the email_*/contact_* columns
-- stay around for reference but the trunk-comms send pipeline
-- only reads from primary_contact_email + _name.
ALTER TABLE public.trunk_show_stores
  ADD COLUMN IF NOT EXISTS primary_contact_email TEXT,
  ADD COLUMN IF NOT EXISTS primary_contact_name  TEXT;

UPDATE public.trunk_show_stores
   SET primary_contact_email = COALESCE(primary_contact_email, email_1),
       primary_contact_name  = COALESCE(primary_contact_name,  contact_1)
 WHERE primary_contact_email IS NULL OR primary_contact_name IS NULL;

COMMENT ON COLUMN public.trunk_show_stores.primary_contact_email IS
  'Canonical recipient address for trunk-show communications. Backfilled from email_1; admin can override.';

-- ── 2. communication_templates ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.communication_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  subject_line  TEXT NOT NULL,
  body          TEXT NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID REFERENCES public.users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_comm_templates_active
  ON public.communication_templates (is_active);

-- ── 3. communication_send_schedules ─────────────────────────
CREATE TABLE IF NOT EXISTS public.communication_send_schedules (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id              UUID NOT NULL REFERENCES public.communication_templates(id) ON DELETE CASCADE,
  days_before_event_start  INT  NOT NULL CHECK (days_before_event_start >= 0),
  send_window_days         INT  NOT NULL DEFAULT 7 CHECK (send_window_days > 0),
  is_active                BOOLEAN NOT NULL DEFAULT true,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_comm_schedules_template
  ON public.communication_send_schedules (template_id);
CREATE INDEX IF NOT EXISTS idx_comm_schedules_active
  ON public.communication_send_schedules (template_id, is_active);

-- ── 4. communication_sends ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.communication_sends (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trunk_show_id               UUID NOT NULL REFERENCES public.trunk_shows(id) ON DELETE CASCADE,
  template_id                 UUID REFERENCES public.communication_templates(id) ON DELETE SET NULL,
  schedule_id                 UUID REFERENCES public.communication_send_schedules(id) ON DELETE SET NULL,
  sent_by_user_id             UUID REFERENCES public.users(id) ON DELETE SET NULL,
  sent_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),

  from_email                  TEXT NOT NULL,
  from_name                   TEXT NOT NULL,
  to_email                    TEXT NOT NULL,
  to_name                     TEXT,
  subject_line_rendered       TEXT NOT NULL,
  body_rendered               TEXT NOT NULL,
  pdf_url                     TEXT,

  -- Delivery tracking via Resend webhooks.
  resend_message_id           TEXT,
  delivery_status             communication_delivery_status NOT NULL DEFAULT 'sent',
  delivery_status_updated_at  TIMESTAMPTZ,

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_comm_sends_trunk_show
  ON public.communication_sends (trunk_show_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_comm_sends_template
  ON public.communication_sends (template_id);
CREATE INDEX IF NOT EXISTS idx_comm_sends_resend_msgid
  ON public.communication_sends (resend_message_id) WHERE resend_message_id IS NOT NULL;

-- ── 5. trunk_show_checklist_master ──────────────────────────
CREATE TABLE IF NOT EXISTS public.trunk_show_checklist_master (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title                    TEXT NOT NULL,
  description              TEXT,
  days_before_event_start  INT  NOT NULL CHECK (days_before_event_start >= 0),
  assigned_to_role         communication_assigned_role NOT NULL DEFAULT 'rep',
  linked_action_type       communication_linked_action NOT NULL DEFAULT 'none',
  linked_template_id       UUID REFERENCES public.communication_templates(id) ON DELETE SET NULL,
  display_order            INT NOT NULL DEFAULT 0,
  is_active                BOOLEAN NOT NULL DEFAULT true,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- A "send_communication" item must reference a template; other
  -- action types must NOT.
  CONSTRAINT chk_master_template_when_send CHECK (
    (linked_action_type = 'send_communication' AND linked_template_id IS NOT NULL)
    OR (linked_action_type <> 'send_communication' AND linked_template_id IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_checklist_master_active_order
  ON public.trunk_show_checklist_master (is_active, display_order);

-- ── 6. trunk_show_checklist_items (per-trunk-show instances) ─
CREATE TABLE IF NOT EXISTS public.trunk_show_checklist_items (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trunk_show_id             UUID NOT NULL REFERENCES public.trunk_shows(id) ON DELETE CASCADE,
  -- NULL = ad-hoc item added on this trunk show, not from master.
  master_item_id            UUID REFERENCES public.trunk_show_checklist_master(id) ON DELETE SET NULL,

  -- Snapshot at instance creation; master edits never retroactively
  -- change existing rows (per spec).
  title                     TEXT NOT NULL,
  description               TEXT,
  due_date                  DATE NOT NULL,
  assigned_to_role          communication_assigned_role NOT NULL DEFAULT 'rep',
  linked_action_type        communication_linked_action NOT NULL DEFAULT 'none',
  linked_template_id        UUID REFERENCES public.communication_templates(id) ON DELETE SET NULL,
  -- Set when the item was auto-checked by a communication send.
  linked_send_id            UUID REFERENCES public.communication_sends(id) ON DELETE SET NULL,

  is_completed              BOOLEAN NOT NULL DEFAULT false,
  completed_at              TIMESTAMPTZ,
  completed_by_user_id      UUID REFERENCES public.users(id) ON DELETE SET NULL,
  -- jsonb array of { action: 'check'|'uncheck', user_id, timestamp }.
  previous_completion_log   JSONB NOT NULL DEFAULT '[]'::jsonb,

  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_checklist_items_trunk_show
  ON public.trunk_show_checklist_items (trunk_show_id, due_date);
CREATE INDEX IF NOT EXISTS idx_checklist_items_open
  ON public.trunk_show_checklist_items (trunk_show_id, due_date)
  WHERE is_completed = false;

-- ── 7. updated_at touch triggers ────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_trunk_comms_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_comm_templates_touch       ON public.communication_templates;
CREATE TRIGGER trg_comm_templates_touch       BEFORE UPDATE ON public.communication_templates
FOR EACH ROW EXECUTE FUNCTION public.touch_trunk_comms_updated_at();

DROP TRIGGER IF EXISTS trg_comm_schedules_touch       ON public.communication_send_schedules;
CREATE TRIGGER trg_comm_schedules_touch       BEFORE UPDATE ON public.communication_send_schedules
FOR EACH ROW EXECUTE FUNCTION public.touch_trunk_comms_updated_at();

DROP TRIGGER IF EXISTS trg_checklist_master_touch     ON public.trunk_show_checklist_master;
CREATE TRIGGER trg_checklist_master_touch     BEFORE UPDATE ON public.trunk_show_checklist_master
FOR EACH ROW EXECUTE FUNCTION public.touch_trunk_comms_updated_at();

DROP TRIGGER IF EXISTS trg_checklist_items_touch      ON public.trunk_show_checklist_items;
CREATE TRIGGER trg_checklist_items_touch      BEFORE UPDATE ON public.trunk_show_checklist_items
FOR EACH ROW EXECUTE FUNCTION public.touch_trunk_comms_updated_at();

-- ── 8. RLS ──────────────────────────────────────────────────
-- Helpers: full-access predicate (admin/superadmin/partner) and
-- "rep assigned to this trunk show" predicate. Both use email
-- lookup against auth.jwt() rather than impersonation-aware
-- get_effective_user_id() so policies work cleanly for non-
-- impersonating users too.

CREATE OR REPLACE FUNCTION public.is_trunk_comms_admin() RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT public.get_my_role() IN ('admin','superadmin')
      OR EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.email = auth.jwt()->>'email' AND u.is_partner IS TRUE
      );
$$;

CREATE OR REPLACE FUNCTION public.is_assigned_trunk_show_rep(p_trunk_show_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.trunk_shows ts
    JOIN public.users u ON u.id = ts.assigned_rep_id
    WHERE ts.id = p_trunk_show_id
      AND u.email = auth.jwt()->>'email'
  );
$$;

-- communication_templates
ALTER TABLE public.communication_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "comm_templates_select" ON public.communication_templates;
CREATE POLICY "comm_templates_select"
  ON public.communication_templates FOR SELECT TO authenticated
  USING (
    public.is_trunk_comms_admin()
    OR public.get_my_role() = 'sales_rep'
  );

DROP POLICY IF EXISTS "comm_templates_write" ON public.communication_templates;
CREATE POLICY "comm_templates_write"
  ON public.communication_templates FOR ALL TO authenticated
  USING (public.is_trunk_comms_admin())
  WITH CHECK (public.is_trunk_comms_admin());

-- communication_send_schedules
ALTER TABLE public.communication_send_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "comm_schedules_select" ON public.communication_send_schedules;
CREATE POLICY "comm_schedules_select"
  ON public.communication_send_schedules FOR SELECT TO authenticated
  USING (
    public.is_trunk_comms_admin()
    OR public.get_my_role() = 'sales_rep'
  );

DROP POLICY IF EXISTS "comm_schedules_write" ON public.communication_send_schedules;
CREATE POLICY "comm_schedules_write"
  ON public.communication_send_schedules FOR ALL TO authenticated
  USING (public.is_trunk_comms_admin())
  WITH CHECK (public.is_trunk_comms_admin());

-- communication_sends — admin sees all; rep sees their own trunk shows.
ALTER TABLE public.communication_sends ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "comm_sends_select" ON public.communication_sends;
CREATE POLICY "comm_sends_select"
  ON public.communication_sends FOR SELECT TO authenticated
  USING (
    public.is_trunk_comms_admin()
    OR public.is_assigned_trunk_show_rep(trunk_show_id)
  );

DROP POLICY IF EXISTS "comm_sends_insert" ON public.communication_sends;
CREATE POLICY "comm_sends_insert"
  ON public.communication_sends FOR INSERT TO authenticated
  WITH CHECK (
    public.is_trunk_comms_admin()
    OR public.is_assigned_trunk_show_rep(trunk_show_id)
  );

DROP POLICY IF EXISTS "comm_sends_update" ON public.communication_sends;
CREATE POLICY "comm_sends_update"
  ON public.communication_sends FOR UPDATE TO authenticated
  USING (public.is_trunk_comms_admin())
  WITH CHECK (public.is_trunk_comms_admin());

-- trunk_show_checklist_master — same shape as templates.
ALTER TABLE public.trunk_show_checklist_master ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "checklist_master_select" ON public.trunk_show_checklist_master;
CREATE POLICY "checklist_master_select"
  ON public.trunk_show_checklist_master FOR SELECT TO authenticated
  USING (
    public.is_trunk_comms_admin()
    OR public.get_my_role() = 'sales_rep'
  );

DROP POLICY IF EXISTS "checklist_master_write" ON public.trunk_show_checklist_master;
CREATE POLICY "checklist_master_write"
  ON public.trunk_show_checklist_master FOR ALL TO authenticated
  USING (public.is_trunk_comms_admin())
  WITH CHECK (public.is_trunk_comms_admin());

-- trunk_show_checklist_items — admin sees all; rep sees their trunk shows.
ALTER TABLE public.trunk_show_checklist_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "checklist_items_select" ON public.trunk_show_checklist_items;
CREATE POLICY "checklist_items_select"
  ON public.trunk_show_checklist_items FOR SELECT TO authenticated
  USING (
    public.is_trunk_comms_admin()
    OR public.is_assigned_trunk_show_rep(trunk_show_id)
  );

DROP POLICY IF EXISTS "checklist_items_write" ON public.trunk_show_checklist_items;
CREATE POLICY "checklist_items_write"
  ON public.trunk_show_checklist_items FOR ALL TO authenticated
  USING (
    public.is_trunk_comms_admin()
    OR public.is_assigned_trunk_show_rep(trunk_show_id)
  )
  WITH CHECK (
    public.is_trunk_comms_admin()
    OR public.is_assigned_trunk_show_rep(trunk_show_id)
  );

DO $$ BEGIN
  RAISE NOTICE 'Trunk Comms phase 1 schema installed: 5 tables, 3 enums, RLS, helpers.';
END $$;
