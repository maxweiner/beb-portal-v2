-- ============================================================
-- Buying Communications module — schema + nav module registration
--
-- Mirrors Trunk Communications (already shipped) but targets BUYING
-- events instead of trunk shows. Spec 2026-05-16: per Max's option
-- A — fully separate tables, no shared registry.
--
-- This migration is PR 1 of the module build:
--   1. New nav module id 'buying-communications' in role_modules
--      CHECK constraint; granted to admin / superadmin out of the
--      gate. Partners get access via users.is_partner in the page.
--   2. buying_communication_templates table (mirror of
--      communication_templates).
--   3. RLS: read = anyone with buying-communications module access,
--      write = admin/superadmin (same shape as the trunk table).
--
-- Phase 2 (next PR) adds the send pipeline + log; phase 3 adds
-- master checklist + schedules.
--
-- Safe to re-run. Idempotent.
-- ============================================================

-- ── 1. Register the nav module + grant ───────────────────────
ALTER TABLE role_modules DROP CONSTRAINT IF EXISTS role_modules_module_id_check;
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
    'accounting-hub', 'broadcast',
    'buy-intake', 'intake-lookup',
    'reconciliation',
    'wholesale',
    'buying-communications'   -- NEW: parallel to trunk-communications, targets buying events
  ));

INSERT INTO role_modules (role_id, module_id) VALUES
  ('admin',      'buying-communications'),
  ('superadmin', 'buying-communications')
ON CONFLICT (role_id, module_id) DO NOTHING;

-- ── 2. buying_communication_templates ────────────────────────
CREATE TABLE IF NOT EXISTS public.buying_communication_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  subject_line  TEXT NOT NULL,
  body          TEXT NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  -- AI tracking (mirrors what we added to communication_templates).
  created_by_ai BOOLEAN NOT NULL DEFAULT FALSE,
  ai_prompt     TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_buying_comm_templates_active
  ON public.buying_communication_templates (is_active);

ALTER TABLE public.buying_communication_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Buying-comms read" ON public.buying_communication_templates;
CREATE POLICY "Buying-comms read"
  ON public.buying_communication_templates FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.auth_id = auth.uid()
      AND (u.role IN ('admin','superadmin') OR u.is_partner = TRUE)
  ));

DROP POLICY IF EXISTS "Buying-comms write" ON public.buying_communication_templates;
CREATE POLICY "Buying-comms write"
  ON public.buying_communication_templates FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.auth_id = auth.uid()
      AND (u.role IN ('admin','superadmin') OR u.is_partner = TRUE)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.auth_id = auth.uid()
      AND (u.role IN ('admin','superadmin') OR u.is_partner = TRUE)
  ));

DO $$ BEGIN
  RAISE NOTICE 'buying_communication_templates installed + buying-communications nav module registered. Phase 1 of the module build (templates + AI generator) is unblocked; send-flow lands in phase 2.';
END $$;
