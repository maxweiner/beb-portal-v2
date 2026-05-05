-- ── Trunk Comms phase 10: copy master checklist on insert ──
-- AFTER INSERT trigger on trunk_shows that fans out every active
-- master_checklist row into a per-show item. Pairs with phase 4's
-- schedule trigger; both populate trunk_show_checklist_items but
-- with different origin signals:
--   • master_item_id NOT NULL → from master (this trigger)
--   • master_item_id NULL + linked_template_id NOT NULL → from
--     a schedule fan-out (phase 4 trigger)
--
-- Per spec rule 6d: due dates already in the past still get
-- inserted — they show up as overdue immediately so the rep
-- knows there's catch-up to do.
--
-- Per spec rule 6e: edits to a master item don't retroactively
-- change existing per-show items because we snapshot title /
-- description / role / linked_* into the per-show row at
-- creation time.
--
-- Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fanout_master_checklist_on_trunk_show_insert()
RETURNS TRIGGER AS $$
DECLARE r RECORD;
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.status = 'cancelled' THEN RETURN NEW; END IF;
  IF NEW.start_date IS NULL THEN RETURN NEW; END IF;

  FOR r IN
    SELECT id, title, description, days_before_event_start,
           assigned_to_role, linked_action_type, linked_template_id
    FROM public.trunk_show_checklist_master
    WHERE is_active = true
  LOOP
    INSERT INTO public.trunk_show_checklist_items (
      trunk_show_id, master_item_id, title, description,
      due_date, assigned_to_role,
      linked_action_type, linked_template_id
    ) VALUES (
      NEW.id, r.id, r.title, r.description,
      NEW.start_date - r.days_before_event_start,
      r.assigned_to_role,
      r.linked_action_type, r.linked_template_id
    );
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_trunk_shows_fanout_master_checklist ON public.trunk_shows;
CREATE TRIGGER trg_trunk_shows_fanout_master_checklist
AFTER INSERT ON public.trunk_shows
FOR EACH ROW EXECUTE FUNCTION public.fanout_master_checklist_on_trunk_show_insert();

-- ── Backfill for trunk shows that already exist ─────────────
-- One-shot: pair every active future trunk show with every
-- active master item it doesn't already have. Pre-existing
-- shows that started before deployment of this migration are
-- skipped (they're already running or done).
INSERT INTO public.trunk_show_checklist_items (
  trunk_show_id, master_item_id, title, description,
  due_date, assigned_to_role,
  linked_action_type, linked_template_id
)
SELECT
  ts.id, m.id, m.title, m.description,
  ts.start_date - m.days_before_event_start,
  m.assigned_to_role,
  m.linked_action_type, m.linked_template_id
FROM public.trunk_shows ts
CROSS JOIN public.trunk_show_checklist_master m
WHERE ts.deleted_at IS NULL
  AND ts.status <> 'cancelled'
  AND ts.start_date IS NOT NULL
  AND ts.start_date >= CURRENT_DATE
  AND m.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM public.trunk_show_checklist_items existing
    WHERE existing.trunk_show_id = ts.id
      AND existing.master_item_id = m.id
  );

DO $$ BEGIN
  RAISE NOTICE 'Trunk Comms phase 10 trigger installed; backfilled future shows.';
END $$;
