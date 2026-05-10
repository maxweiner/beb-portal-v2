-- ── Wholesale: inventory.vendor_stock_number ──
-- The vendor's own SKU / stock number when we bought the item. Useful
-- for cross-referencing a vendor's invoice, reordering, and tracing
-- back to a specific lot when a stone has no GIA report.
--
-- Safe to re-run.

ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS vendor_stock_number TEXT;

CREATE INDEX IF NOT EXISTS idx_inventory_items_vendor_stock
  ON public.inventory_items (brand, vendor_stock_number)
  WHERE vendor_stock_number IS NOT NULL;

DO $$ BEGIN
  RAISE NOTICE 'Added inventory_items.vendor_stock_number + brand-scoped index.';
END $$;
