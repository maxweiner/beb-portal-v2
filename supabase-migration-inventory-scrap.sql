-- ============================================================
-- Inventory items — Scrap + Delete support
--
-- Adds a new `scrapped` value to the inventory_status enum plus
-- supporting columns (reason note, who/when). Lets users mark an
-- item as physically destroyed/lost/written-off without losing the
-- accounting history.
--
-- Delete is implemented separately as a soft-archive via the
-- existing `archived_at` column — no schema change needed for that;
-- the UI just stamps the column.
--
-- Idempotent. Safe to re-run.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. Add 'scrapped' to the inventory_status enum
-- ─────────────────────────────────────────────────────────────
--
-- `ADD VALUE IF NOT EXISTS` is non-transactional but supported in
-- modern Postgres. If we ever hit a "cannot run inside transaction"
-- error from a future client, we'd split this out into a separate
-- migration; for the Supabase Dashboard SQL editor it works as-is.
ALTER TYPE inventory_status ADD VALUE IF NOT EXISTS 'scrapped';

-- ─────────────────────────────────────────────────────────────
-- 2. Scrap-metadata columns on inventory_items
-- ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF to_regclass('public.inventory_items') IS NULL THEN
    RAISE NOTICE 'skip inventory_items (table missing)';
    RETURN;
  END IF;
  BEGIN
    ALTER TABLE public.inventory_items
      ADD COLUMN IF NOT EXISTS scrap_reason TEXT;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'scrap_reason add skipped: %', SQLERRM;
  END;
  BEGIN
    ALTER TABLE public.inventory_items
      ADD COLUMN IF NOT EXISTS scrapped_at TIMESTAMPTZ;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'scrapped_at add skipped: %', SQLERRM;
  END;
  BEGIN
    ALTER TABLE public.inventory_items
      ADD COLUMN IF NOT EXISTS scrapped_by_user_id UUID
        REFERENCES public.users(id) ON DELETE SET NULL;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'scrapped_by_user_id add skipped: %', SQLERRM;
  END;
END $$;

DO $$ BEGIN
  RAISE NOTICE 'inventory_items scrap support ready: status enum has ''scrapped'', plus scrap_reason / scrapped_at / scrapped_by_user_id.';
END $$;
