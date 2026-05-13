-- ============================================================
-- Shipping: make event_shipments universal (no more skip-on-no-hold)
--
-- Behavior change
-- ---------------
-- Old: stores with `hold_time_days IS NULL` were treated as "No
--      Hold / no shipping flow" — the create_event_shipment trigger
--      returned early so no event_shipments row was created. Those
--      events never appeared in the Shipping Portal.
--
-- New: EVERY event gets an event_shipments row. When the store has
--      no hold configured, the ship_date defaults to the event's
--      LAST DAY (start_date + 2 days) so it's not flagged overdue
--      mid-event. Staff can still edit ship_date in the portal.
--
-- Box counts continue to fall back to the existing defaults
-- (jewelry=5, silver=3) when the store doesn't override them.
--
-- Migration scope
-- ---------------
-- 1. Rewrite create_event_shipment() to always insert
-- 2. Rewrite resync_event_shipment_date() to always recompute
-- 3. Backfill missing shipment rows for events whose start_date
--    is TODAY or LATER. Past events deliberately untouched per
--    user spec ("events in the past dont matter").
--
-- Idempotent. Safe to re-run.
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. Trigger function: always create a shipment row on event insert
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_event_shipment()
RETURNS TRIGGER AS $$
DECLARE
  v_hold   INT;
  v_jcount INT;
  v_scount INT;
  v_ship   DATE;
BEGIN
  SELECT hold_time_days, default_jewelry_box_count, default_silver_box_count
    INTO v_hold, v_jcount, v_scount
  FROM public.stores
  WHERE id = NEW.store_id;

  -- Ship date: hold_time_days after start_date when configured,
  -- otherwise the event's final day (start_date + 2 days). Staff
  -- can edit in the portal afterward.
  IF v_hold IS NOT NULL THEN
    v_ship := (NEW.start_date::date + (v_hold || ' days')::interval)::date;
  ELSE
    v_ship := (NEW.start_date::date + INTERVAL '2 days')::date;
  END IF;

  INSERT INTO public.event_shipments (
    event_id, store_id, ship_date, jewelry_box_count, silver_box_count
  )
  VALUES (
    NEW.id,
    NEW.store_id,
    v_ship,
    COALESCE(v_jcount, 5),
    COALESCE(v_scount, 3)
  )
  ON CONFLICT (event_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_create_event_shipment ON public.events;
CREATE TRIGGER trg_create_event_shipment
AFTER INSERT ON public.events
FOR EACH ROW EXECUTE FUNCTION public.create_event_shipment();


-- ─────────────────────────────────────────────────────────────
-- 2. Trigger function: keep ship_date in sync when event date moves
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resync_event_shipment_date()
RETURNS TRIGGER AS $$
DECLARE
  v_hold INT;
  v_ship DATE;
  v_has_movement BOOLEAN;
BEGIN
  IF NEW.start_date IS NOT DISTINCT FROM OLD.start_date THEN
    RETURN NEW;
  END IF;

  SELECT hold_time_days INTO v_hold FROM public.stores WHERE id = NEW.store_id;

  IF v_hold IS NOT NULL THEN
    v_ship := (NEW.start_date::date + (v_hold || ' days')::interval)::date;
  ELSE
    v_ship := (NEW.start_date::date + INTERVAL '2 days')::date;
  END IF;

  -- Only resync when nothing has shipped yet — same guard as before.
  SELECT EXISTS (
    SELECT 1 FROM public.event_shipment_boxes b
    JOIN public.event_shipments s ON s.id = b.shipment_id
    WHERE s.event_id = NEW.id
      AND b.status NOT IN ('pending', 'cancelled')
  ) INTO v_has_movement;

  IF NOT v_has_movement THEN
    UPDATE public.event_shipments
       SET ship_date = v_ship
     WHERE event_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_resync_event_shipment_date ON public.events;
CREATE TRIGGER trg_resync_event_shipment_date
AFTER UPDATE OF start_date ON public.events
FOR EACH ROW EXECUTE FUNCTION public.resync_event_shipment_date();


-- ─────────────────────────────────────────────────────────────
-- 3. Backfill: insert shipment rows for current + future events
--    that are missing them. Past events left alone.
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.event_shipments (
  event_id, store_id, ship_date, jewelry_box_count, silver_box_count
)
SELECT
  e.id,
  e.store_id,
  CASE
    WHEN s.hold_time_days IS NOT NULL
      THEN (e.start_date::date + (s.hold_time_days || ' days')::interval)::date
    ELSE
      (e.start_date::date + INTERVAL '2 days')::date
  END AS ship_date,
  COALESCE(s.default_jewelry_box_count, 5),
  COALESCE(s.default_silver_box_count, 3)
FROM public.events e
JOIN public.stores s ON s.id = e.store_id
LEFT JOIN public.event_shipments es ON es.event_id = e.id
WHERE es.id IS NULL
  AND e.start_date >= CURRENT_DATE
  AND (e.status IS NULL OR e.status NOT IN ('cancelled'))
ON CONFLICT (event_id) DO NOTHING;

DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n
  FROM public.event_shipments es
  JOIN public.events e ON e.id = es.event_id
  WHERE e.start_date >= CURRENT_DATE;
  RAISE NOTICE 'event_shipments universal rollout complete: % shipment row(s) cover today and future events.', n;
END $$;
