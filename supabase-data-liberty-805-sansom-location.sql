-- ── Liberty: assign all inventory to "805 Sansom Street" ──
-- Creates the location if missing and assigns every Liberty inventory
-- row (including the just-imported legacy items) to it. Idempotent.
-- ============================================================

INSERT INTO public.inventory_locations (brand, name, sort_order, active)
VALUES ('liberty', '805 Sansom Street', 1, TRUE)
ON CONFLICT DO NOTHING;

UPDATE public.inventory_items
   SET location_id = (
     SELECT id FROM public.inventory_locations
      WHERE brand='liberty' AND name='805 Sansom Street'
      LIMIT 1
   )
 WHERE brand='liberty';

DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM public.inventory_items WHERE brand='liberty';
  RAISE NOTICE 'All % Liberty inventory rows now point at 805 Sansom Street.', n;
END $$;
