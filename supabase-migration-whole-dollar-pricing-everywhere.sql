-- ============================================================
-- Whole-dollar policy extended: all inventory pricing + memo line +
-- invoice line prices
--
-- Spec 2026-05-15 (follow-up to supabase-migration-whole-dollar-
-- cost-and-checks.sql, which covered inventory.cost + buyer_checks):
--   - inventory_items.wholesale_price_cents → whole dollars
--   - inventory_items.retail_price_cents    → whole dollars
--   - inventory_items.edge_price_cents      → whole dollars
--   - wholesale_memo_lines.memo_price_cents → whole dollars
--   - wholesale_invoice_lines.sale_price_cents → whole dollars
--
-- Each is integer cents. Whole dollars = multiple of 100. The UPDATE
-- per column filters on rows that aren't already at whole-dollar
-- values so it's idempotent / safe to re-run.
--
-- Other money columns intentionally NOT touched:
--   - inventory_items.insurance_value_cents (insurance valuation —
--     keep cents until/unless someone asks)
--   - wholesale_invoice_payments.amount_cents (payments — match the
--     check / wire / ACH amount exactly)
--   - expense_reports.*, expenses.* (receipt totals — cents-accurate)
-- ============================================================

UPDATE public.inventory_items
   SET wholesale_price_cents = ROUND(wholesale_price_cents::numeric / 100) * 100
 WHERE wholesale_price_cents IS NOT NULL
   AND wholesale_price_cents % 100 <> 0;

UPDATE public.inventory_items
   SET retail_price_cents = ROUND(retail_price_cents::numeric / 100) * 100
 WHERE retail_price_cents IS NOT NULL
   AND retail_price_cents % 100 <> 0;

UPDATE public.inventory_items
   SET edge_price_cents = ROUND(edge_price_cents::numeric / 100) * 100
 WHERE edge_price_cents IS NOT NULL
   AND edge_price_cents % 100 <> 0;

UPDATE public.wholesale_memo_lines
   SET memo_price_cents = ROUND(memo_price_cents::numeric / 100) * 100
 WHERE memo_price_cents IS NOT NULL
   AND memo_price_cents % 100 <> 0;

UPDATE public.wholesale_invoice_lines
   SET sale_price_cents = ROUND(sale_price_cents::numeric / 100) * 100
 WHERE sale_price_cents IS NOT NULL
   AND sale_price_cents % 100 <> 0;

DO $$
DECLARE
  v_inv_w INT; v_inv_r INT; v_inv_e INT; v_memo INT; v_inv INT;
BEGIN
  SELECT COUNT(*) INTO v_inv_w FROM public.inventory_items       WHERE wholesale_price_cents IS NOT NULL AND wholesale_price_cents % 100 <> 0;
  SELECT COUNT(*) INTO v_inv_r FROM public.inventory_items       WHERE retail_price_cents    IS NOT NULL AND retail_price_cents    % 100 <> 0;
  SELECT COUNT(*) INTO v_inv_e FROM public.inventory_items       WHERE edge_price_cents      IS NOT NULL AND edge_price_cents      % 100 <> 0;
  SELECT COUNT(*) INTO v_memo  FROM public.wholesale_memo_lines  WHERE memo_price_cents      IS NOT NULL AND memo_price_cents      % 100 <> 0;
  SELECT COUNT(*) INTO v_inv   FROM public.wholesale_invoice_lines WHERE sale_price_cents    IS NOT NULL AND sale_price_cents      % 100 <> 0;
  RAISE NOTICE 'Whole-dollar follow-up done. Remaining cents-bearing rows: wholesale=%, retail=%, edge=%, memo=%, invoice=%. All should be 0.', v_inv_w, v_inv_r, v_inv_e, v_memo, v_inv;
END $$;
