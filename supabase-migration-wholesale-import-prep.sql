-- ── Wholesale: import prep — nullable category + alternate_item_number ──
--
-- Two changes to support importing legacy inventory:
--   1. Make inventory_items.category nullable so rows can be
--      imported without a category and triaged later.
--   2. Add alternate_item_number column (e.g., the legacy
--      "LIB-40506" / "26071" code from prior systems). Indexed
--      and brand-scoped. Wired into search.
--   3. Seed the 'I' (imported) prefix in wholesale_number_sequences
--      so legacy items get I-1001, I-1002, … without disturbing
--      the J/W/D sequences.
--
-- Safe to re-run.
-- ============================================================

ALTER TABLE public.inventory_items
  ALTER COLUMN category DROP NOT NULL;

ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS alternate_item_number TEXT;

CREATE INDEX IF NOT EXISTS idx_inventory_items_alt_num
  ON public.inventory_items (brand, alternate_item_number)
  WHERE alternate_item_number IS NOT NULL;

INSERT INTO public.wholesale_number_sequences (brand, prefix, last_number) VALUES
  ('beb','I',1000), ('liberty','I',1000)
ON CONFLICT (brand, prefix) DO NOTHING;

DO $$ BEGIN
  RAISE NOTICE 'Inventory: category nullable + alternate_item_number added + I- (imported) sequence seeded.';
END $$;
