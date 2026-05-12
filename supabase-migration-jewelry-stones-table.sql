-- ============================================================
-- Multi-stone support for jewelry inventory items
-- ============================================================
--
-- Replaces the single-diamond accent fields on inventory_items
-- (jewelry_diamond_count / _total_ct / _shape) with a child
-- table inventory_item_stones. A jewelry piece can now declare
-- any number of stone entries (Diamonds, Rubies, Emeralds, …)
-- in user-chosen order; the Autofill description and the
-- appraisal PDF iterate over them and render Diamonds first,
-- then everything else in user-added order.
--
-- The loose-diamond inventory category (category='diamond')
-- with its GIA-style fields is untouched — that workflow is
-- separate and stays as it was.
--
-- Safe to re-run up through step 4 (idempotent guards); step 5
-- (column drop) uses IF EXISTS, so it's safe to re-run too — but
-- if you've already shipped this and want to revert, you'd need
-- to re-add the columns by hand.
-- ============================================================

-- 1. New child table.
CREATE TABLE IF NOT EXISTS public.inventory_item_stones (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id     UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  -- Stone type: value comes from wholesale_admin_lists where
  -- list_key='stone_type'. Seeded below with Diamond / Ruby /
  -- Emerald / Sapphire / Aquamarine / Garnet; "Add new" in the
  -- form appends to that list so additions are visible to every
  -- other item from then on.
  stone_type  TEXT NOT NULL,
  -- Shape: reuses the existing 'diamond_shape' list (Round,
  -- Princess, Cushion, …). Free-text fallback inherits the
  -- DropdownSelect "(custom)" pattern used elsewhere.
  shape       TEXT,
  count       INT,                             -- number of stones in this entry
  total_ct    NUMERIC(8,3),                    -- total carat weight for the entry
  -- Render order in the Autofill description. Diamonds-first is
  -- applied by the renderer, NOT by sort_order — sort_order is
  -- strictly the user-added order within the non-Diamond group
  -- (and within the Diamond group, if multiple Diamond entries
  -- exist for some reason).
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inventory_item_stones_item
  ON public.inventory_item_stones (item_id);

-- 2. RLS — same gate as the other inventory child tables
--    (inventory_photos, inventory_documents). wholesale_caller_allowed()
--    is the SECURITY DEFINER helper that lets superadmin / admin /
--    is_partner / inventory_access through.
ALTER TABLE public.inventory_item_stones ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'inventory_item_stones'
      AND policyname = 'inventory_item_stones_rw'
  ) THEN
    EXECUTE $POL$
      CREATE POLICY inventory_item_stones_rw ON public.inventory_item_stones
        FOR ALL TO authenticated
        USING      (public.wholesale_caller_allowed())
        WITH CHECK (public.wholesale_caller_allowed())
    $POL$;
  END IF;
END $$;

-- 3. Seed the stone_type managed list for both brands (idempotent
--    via the unique index on brand+list_key+value). "Add new" in
--    the form appends rows here too.
INSERT INTO public.wholesale_admin_lists (brand, list_key, value, active, sort_order)
SELECT b.brand, 'stone_type', v.value, true, v.sort_order
FROM (VALUES ('beb'), ('liberty')) AS b(brand)
CROSS JOIN (VALUES
  ('Diamond',    0),
  ('Ruby',       1),
  ('Emerald',    2),
  ('Sapphire',   3),
  ('Aquamarine', 4),
  ('Garnet',     5)
) AS v(value, sort_order)
ON CONFLICT DO NOTHING;

-- 4. Backfill: every jewelry item that had any of the three diamond
--    accent fields populated gets a single Diamond entry in the new
--    table carrying those values over. Items with all three NULL get
--    no migrated row — they had no stones recorded. Skipped quietly
--    if the columns are already gone (re-runs).
DO $$
DECLARE
  cols_exist BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'inventory_items'
      AND column_name  = 'jewelry_diamond_count'
  ) INTO cols_exist;

  IF cols_exist THEN
    INSERT INTO public.inventory_item_stones
      (item_id, stone_type, shape, count, total_ct, sort_order)
    SELECT
      id,
      'Diamond',
      jewelry_diamond_shape,
      jewelry_diamond_count,
      jewelry_diamond_total_ct,
      0
    FROM public.inventory_items
    WHERE jewelry_diamond_count    IS NOT NULL
       OR jewelry_diamond_total_ct IS NOT NULL
       OR jewelry_diamond_shape    IS NOT NULL;
  END IF;
END $$;

-- 5. Drop the now-vestigial columns. Use IF EXISTS so the migration
--    stays re-runnable.
ALTER TABLE public.inventory_items
  DROP COLUMN IF EXISTS jewelry_diamond_count,
  DROP COLUMN IF EXISTS jewelry_diamond_total_ct,
  DROP COLUMN IF EXISTS jewelry_diamond_shape;

DO $$ BEGIN
  RAISE NOTICE 'inventory_item_stones created, stone_type list seeded, jewelry diamond columns migrated + dropped.';
END $$;
