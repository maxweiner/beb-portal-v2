-- ── Wholesale: rename jewelry_metal_grams → jewelry_metal_dwt ──
--
-- Liberty's metal weights are entered in pennyweight (dwt), not
-- grams (1 dwt = 1.555 g). The column was originally named grams;
-- rename so the storage matches what's actually being entered.
-- App code + PDFs updated in the same PR.
--
-- Safe to re-run.
-- ============================================================

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'inventory_items'
      AND column_name = 'jewelry_metal_grams'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'inventory_items'
      AND column_name = 'jewelry_metal_dwt'
  ) THEN
    EXECUTE 'ALTER TABLE public.inventory_items RENAME COLUMN jewelry_metal_grams TO jewelry_metal_dwt';
  END IF;
END $$;

DO $$ BEGIN
  RAISE NOTICE 'inventory_items.jewelry_metal_grams renamed to jewelry_metal_dwt (no data change).';
END $$;
