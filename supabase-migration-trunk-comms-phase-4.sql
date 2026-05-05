-- ── Trunk Comms phase 4: schedule auto-propagation ──────────
-- When (a) a new schedule is added/activated or (b) a new trunk
-- show is created, we need to auto-create per-show checklist
-- items that drive the rep's "send {template name} by {due_date}"
-- workflow. Done in DB triggers so direct SQL inserts and admin
-- UI inserts both propagate identically.
--
-- Rules (per spec):
-- - Compute due_date = trunk_show.start_date − schedule
--   .days_before_event_start. If that's already in the past, do
--   NOT create the item (no retroactive overdue items).
-- - Skip cancelled or soft-deleted trunk shows.
-- - Skip duplicates (admin can disable + re-enable a schedule
--   without piling up).
-- - One row per (trunk_show_id, linked_template_id) is the
--   uniqueness key; no DB constraint, but the function checks
--   before inserting.
--
-- Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_schedule_checklist_item(
  p_trunk_show_id UUID,
  p_template_id   UUID,
  p_due_date      DATE
) RETURNS VOID AS $$
DECLARE
  v_template_name TEXT;
BEGIN
  -- Skip if there's already an open item for this (show, template).
  IF EXISTS (
    SELECT 1 FROM public.trunk_show_checklist_items
    WHERE trunk_show_id = p_trunk_show_id
      AND linked_template_id = p_template_id
      AND is_completed = false
  ) THEN
    RETURN;
  END IF;

  SELECT name INTO v_template_name FROM public.communication_templates WHERE id = p_template_id;
  IF v_template_name IS NULL THEN RETURN; END IF;

  INSERT INTO public.trunk_show_checklist_items (
    trunk_show_id, master_item_id, title, description,
    due_date, assigned_to_role, linked_action_type, linked_template_id
  ) VALUES (
    p_trunk_show_id, NULL, v_template_name, NULL,
    p_due_date, 'rep', 'send_communication', p_template_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Trigger 1: trunk_shows INSERT → fan out active schedules ──
CREATE OR REPLACE FUNCTION public.fanout_schedules_on_trunk_show_insert()
RETURNS TRIGGER AS $$
DECLARE r RECORD;
        v_due DATE;
BEGIN
  -- Only proceed for live shows.
  IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.status = 'cancelled' THEN RETURN NEW; END IF;
  IF NEW.start_date IS NULL THEN RETURN NEW; END IF;

  FOR r IN
    SELECT id, template_id, days_before_event_start
    FROM public.communication_send_schedules
    WHERE is_active = true
  LOOP
    v_due := NEW.start_date - r.days_before_event_start;
    IF v_due >= CURRENT_DATE THEN
      PERFORM public.create_schedule_checklist_item(NEW.id, r.template_id, v_due);
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_trunk_shows_fanout_schedules ON public.trunk_shows;
CREATE TRIGGER trg_trunk_shows_fanout_schedules
AFTER INSERT ON public.trunk_shows
FOR EACH ROW EXECUTE FUNCTION public.fanout_schedules_on_trunk_show_insert();

-- ── Trigger 2: communication_send_schedules INSERT/UPDATE →
-- fan out to all relevant future trunk shows.
-- Fires on INSERT and on UPDATE-to-active so admin can
-- reactivate an archived schedule and the items reappear.
CREATE OR REPLACE FUNCTION public.fanout_trunk_shows_on_schedule_change()
RETURNS TRIGGER AS $$
DECLARE r RECORD;
        v_due DATE;
BEGIN
  IF NEW.is_active IS NOT TRUE THEN RETURN NEW; END IF;

  -- For UPDATE, skip if it was already active and the field of
  -- interest hasn't changed (avoids infinite touch-trigger loops).
  IF TG_OP = 'UPDATE'
     AND OLD.is_active = NEW.is_active
     AND OLD.template_id = NEW.template_id
     AND OLD.days_before_event_start = NEW.days_before_event_start
  THEN
    RETURN NEW;
  END IF;

  FOR r IN
    SELECT id, start_date FROM public.trunk_shows
    WHERE deleted_at IS NULL
      AND status <> 'cancelled'
      AND start_date IS NOT NULL
      AND start_date >= CURRENT_DATE + NEW.days_before_event_start
  LOOP
    v_due := r.start_date - NEW.days_before_event_start;
    PERFORM public.create_schedule_checklist_item(r.id, NEW.template_id, v_due);
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_schedules_fanout_trunk_shows ON public.communication_send_schedules;
CREATE TRIGGER trg_schedules_fanout_trunk_shows
AFTER INSERT OR UPDATE ON public.communication_send_schedules
FOR EACH ROW EXECUTE FUNCTION public.fanout_trunk_shows_on_schedule_change();

DO $$ BEGIN
  RAISE NOTICE 'Trunk Comms phase 4 triggers installed.';
END $$;
