-- ============================================================
-- Partial payments — STEP 1 of 2: enum value only
--
-- Postgres requires ALTER TYPE ... ADD VALUE to be committed
-- before the new value can be USED at runtime (PL/pgSQL bodies
-- can reference it, but the trigger that fires during the same
-- transaction errors with: "unsafe use of new value of enum
-- type"). So we split the migration into two passes — this one
-- adds the value and lets Supabase auto-commit it; step 2
-- creates the table, trigger, settings row, and backfill.
-- ============================================================

ALTER TYPE expense_report_status ADD VALUE IF NOT EXISTS 'partially_paid' BEFORE 'paid';

DO $$ BEGIN
  RAISE NOTICE 'Step 1 of 2 done — partially_paid enum value added. Now paste step 2.';
END $$;
