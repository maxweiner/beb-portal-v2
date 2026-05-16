-- ============================================================
-- Buying Communications phase 3b: master checklist + per-event items
--
-- Mirrors trunk-side checklist (trunk_show_checklist_master /
-- _items) but FKs to events instead of trunk_shows. Auto-check on
-- send is wired in the /api/buying-communications/send route.
--
-- Per-spec on trunk side (which we mirror):
--   - Master edits never retroactively modify existing per-event
--     items. New events going forward pick up the latest master.
--   - A `send_communication` master item MUST reference a
--     buying-template; other action types must NOT.
--   - Auto-check on send: when a letter goes out for (event,
--     template), any open checklist item with that template_id on
--     that event flips to completed + linked to the send id.
--
-- Reuses the existing `communication_linked_action` ENUM from the
-- trunk migration. No new types.
--
-- Trigger fan-out: when a new buying event is INSERTed, generate
-- per-event item rows for every is_active master item, computing
-- due_date = NEW.start_date − days_before_event_start.
--
-- Safe to re-run. Idempotent.
-- ============================================================

-- ── 1. Master list (admin-managed, brand-agnostic) ──────────
CREATE TABLE IF NOT EXISTS public.buying_event_checklist_master (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title                    TEXT NOT NULL,
  description              TEXT,
  days_before_event_start  INT  NOT NULL CHECK (days_before_event_start >= 0),
  linked_action_type       communication_linked_action NOT NULL DEFAULT 'none',
  linked_template_id       UUID REFERENCES public.buying_communication_templates(id) ON DELETE SET NULL,
  display_order            INT NOT NULL DEFAULT 0,
  is_active                BOOLEAN NOT NULL DEFAULT TRUE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_buy_master_template_when_send CHECK (
    (linked_action_type = 'send_communication' AND linked_template_id IS NOT NULL)
    OR (linked_action_type <> 'send_communication' AND linked_template_id IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_buy_checklist_master_active_order
  ON public.buying_event_checklist_master (is_active, display_order);

ALTER TABLE public.buying_event_checklist_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Buying-checklist-master read" ON public.buying_event_checklist_master;
CREATE POLICY "Buying-checklist-master read"
  ON public.buying_event_checklist_master FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u
    WHERE u.auth_id = auth.uid()
      AND (u.role IN ('admin','superadmin') OR u.is_partner = TRUE)));
DROP POLICY IF EXISTS "Buying-checklist-master write" ON public.buying_event_checklist_master;
CREATE POLICY "Buying-checklist-master write"
  ON public.buying_event_checklist_master FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u
    WHERE u.auth_id = auth.uid()
      AND (u.role IN ('admin','superadmin') OR u.is_partner = TRUE)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u
    WHERE u.auth_id = auth.uid()
      AND (u.role IN ('admin','superadmin') OR u.is_partner = TRUE)));

-- ── 2. Per-event instances ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.buying_event_checklist_items (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id                  UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  -- NULL = ad-hoc item added on this event, not from master.
  master_item_id            UUID REFERENCES public.buying_event_checklist_master(id) ON DELETE SET NULL,

  -- Snapshot at instance creation; master edits never retroactively
  -- change existing rows.
  title                     TEXT NOT NULL,
  description               TEXT,
  due_date                  DATE NOT NULL,
  linked_action_type        communication_linked_action NOT NULL DEFAULT 'none',
  linked_template_id        UUID REFERENCES public.buying_communication_templates(id) ON DELETE SET NULL,
  -- Auto-stamped by the send route when a letter fires.
  linked_send_id            UUID REFERENCES public.buying_communication_sends(id) ON DELETE SET NULL,

  is_completed              BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at              TIMESTAMPTZ,
  completed_by_user_id      UUID REFERENCES public.users(id) ON DELETE SET NULL,
  previous_completion_log   JSONB NOT NULL DEFAULT '[]'::jsonb,

  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_buy_checklist_items_event
  ON public.buying_event_checklist_items (event_id, due_date);
CREATE INDEX IF NOT EXISTS idx_buy_checklist_items_open
  ON public.buying_event_checklist_items (event_id, due_date)
  WHERE is_completed = FALSE;

ALTER TABLE public.buying_event_checklist_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Buying-checklist-items read" ON public.buying_event_checklist_items;
CREATE POLICY "Buying-checklist-items read"
  ON public.buying_event_checklist_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u
    WHERE u.auth_id = auth.uid()
      AND (u.role IN ('admin','superadmin') OR u.is_partner = TRUE)));
DROP POLICY IF EXISTS "Buying-checklist-items write" ON public.buying_event_checklist_items;
CREATE POLICY "Buying-checklist-items write"
  ON public.buying_event_checklist_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u
    WHERE u.auth_id = auth.uid()
      AND (u.role IN ('admin','superadmin') OR u.is_partner = TRUE)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u
    WHERE u.auth_id = auth.uid()
      AND (u.role IN ('admin','superadmin') OR u.is_partner = TRUE)));

-- ── 3. Fan-out trigger on events INSERT ──────────────────────
-- New buying event → create one item per active master entry.
-- due_date = NEW.start_date − days_before_event_start.
CREATE OR REPLACE FUNCTION public.fanout_buying_checklist_on_event_insert()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.start_date IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.buying_event_checklist_items (
    event_id, master_item_id, title, description, due_date,
    linked_action_type, linked_template_id
  )
  SELECT
    NEW.id,
    m.id,
    m.title,
    m.description,
    (NEW.start_date - (m.days_before_event_start || ' days')::INTERVAL)::DATE,
    m.linked_action_type,
    m.linked_template_id
  FROM public.buying_event_checklist_master m
  WHERE m.is_active = TRUE;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_buying_checklist_fanout ON public.events;
CREATE TRIGGER trg_buying_checklist_fanout
AFTER INSERT ON public.events
FOR EACH ROW EXECUTE FUNCTION public.fanout_buying_checklist_on_event_insert();

-- ── 4. Updated-at touch triggers ─────────────────────────────
DROP TRIGGER IF EXISTS trg_buying_checklist_master_touch ON public.buying_event_checklist_master;
CREATE TRIGGER trg_buying_checklist_master_touch
BEFORE UPDATE ON public.buying_event_checklist_master
FOR EACH ROW EXECUTE FUNCTION public.touch_trunk_comms_updated_at();

DROP TRIGGER IF EXISTS trg_buying_checklist_items_touch ON public.buying_event_checklist_items;
CREATE TRIGGER trg_buying_checklist_items_touch
BEFORE UPDATE ON public.buying_event_checklist_items
FOR EACH ROW EXECUTE FUNCTION public.touch_trunk_comms_updated_at();

-- ── 5. Backfill — generate items for existing live events ────
-- One-shot pass so the new checklist is useful immediately, not
-- only for events created post-deploy. Filters to non-cancelled
-- events with a valid start_date. Skips events that already have
-- items so re-runs are safe.
INSERT INTO public.buying_event_checklist_items (
  event_id, master_item_id, title, description, due_date,
  linked_action_type, linked_template_id
)
SELECT
  e.id,
  m.id,
  m.title,
  m.description,
  (e.start_date - (m.days_before_event_start || ' days')::INTERVAL)::DATE,
  m.linked_action_type,
  m.linked_template_id
FROM public.events e
CROSS JOIN public.buying_event_checklist_master m
WHERE m.is_active = TRUE
  AND e.start_date IS NOT NULL
  AND COALESCE(e.status, 'scheduled') <> 'cancelled'
  AND NOT EXISTS (
    SELECT 1 FROM public.buying_event_checklist_items i
     WHERE i.event_id = e.id AND i.master_item_id = m.id
  );

DO $$
DECLARE
  v_master INT; v_items INT;
BEGIN
  SELECT COUNT(*) INTO v_master FROM public.buying_event_checklist_master;
  SELECT COUNT(*) INTO v_items  FROM public.buying_event_checklist_items;
  RAISE NOTICE 'Buying checklist installed. % master entries, % per-event items.', v_master, v_items;
END $$;
