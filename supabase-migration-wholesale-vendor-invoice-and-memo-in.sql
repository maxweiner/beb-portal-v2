-- ── Inventory Card: vendor_invoice_number + memo_in ──
-- Two new columns on inventory_items so the Inventory Card can capture:
--
--   vendor_invoice_number  TEXT    — the invoice # the *vendor* sent us
--                                    when we bought / received the item.
--                                    Distinct from vendor_stock_number
--                                    (vendor's SKU for the item itself);
--                                    multiple items can share one
--                                    vendor invoice #.
--
--   memo_in                BOOLEAN — true when the item is on memo *into*
--                                    the company (loaned to us by a
--                                    vendor) rather than owned outright.
--                                    Separate from the existing
--                                    status='on_memo' which means we
--                                    have it out on memo to a customer.
--
-- Both default to NULL / false so existing rows are unaffected.
-- Safe to re-run.

ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS vendor_invoice_number TEXT;

ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS memo_in BOOLEAN NOT NULL DEFAULT false;

-- Brand-scoped index so "show me everything from vendor invoice 12345"
-- is fast. Mirrors the vendor_stock_number index pattern.
CREATE INDEX IF NOT EXISTS idx_inventory_items_vendor_invoice
  ON public.inventory_items (brand, vendor_invoice_number)
  WHERE vendor_invoice_number IS NOT NULL;

-- Partial index — only rows that *are* on memo-in. Cheap and lets the
-- "items loaned to us" list filter come straight off an index.
CREATE INDEX IF NOT EXISTS idx_inventory_items_memo_in
  ON public.inventory_items (brand)
  WHERE memo_in = true;

DO $$ BEGIN
  RAISE NOTICE 'Added inventory_items.vendor_invoice_number + memo_in + indexes.';
END $$;
