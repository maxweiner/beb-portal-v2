-- ============================================================
-- Whole-dollar policy: inventory_items.cost_cents + buyer_checks.amount
--
-- Spec 2026-05-15:
--   - inventory_items.cost is whole dollars only — no cents.
--   - buyer_checks.amount is whole dollars only — no cents.
--
-- This migration rounds every existing row to the nearest whole
-- dollar so the data matches the new UI gates (which prevent cents
-- entry going forward). One-shot UPDATE per column. Safe to re-run
-- — the WHERE clause filters on rows that aren't already at
-- whole-dollar values.
--
-- Other money columns (wholesale_price_cents, retail_price_cents,
-- edge_price_cents, sale_price_cents, memo_price_cents, etc.) are
-- intentionally NOT touched. Those still allow cents per current
-- product spec.
-- ============================================================

-- 1. inventory_items.cost_cents → whole dollars
-- cost_cents is integer cents. Whole dollars = multiple of 100.
UPDATE public.inventory_items
   SET cost_cents = ROUND(cost_cents::numeric / 100) * 100
 WHERE cost_cents IS NOT NULL
   AND cost_cents % 100 <> 0;

-- 2. buyer_checks.amount → whole dollars
-- amount is stored as numeric/decimal. ROUND() to the nearest
-- integer. (Schema-wise the column likely keeps its NUMERIC(12,2)
-- type — we just write integer values into it.)
UPDATE public.buyer_checks
   SET amount = ROUND(amount)
 WHERE amount IS NOT NULL
   AND amount <> ROUND(amount);

DO $$
DECLARE
  v_inv_remaining INT;
  v_chk_remaining INT;
BEGIN
  SELECT COUNT(*) INTO v_inv_remaining
    FROM public.inventory_items
   WHERE cost_cents IS NOT NULL AND cost_cents % 100 <> 0;
  SELECT COUNT(*) INTO v_chk_remaining
    FROM public.buyer_checks
   WHERE amount IS NOT NULL AND amount <> ROUND(amount);
  RAISE NOTICE 'Whole-dollar rounding applied. Inventory rows still with cents: %. Buyer-check rows still with cents: %. Both should be 0.', v_inv_remaining, v_chk_remaining;
END $$;
