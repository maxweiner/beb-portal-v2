-- ============================================================
-- Rename nav id 'accounting-queue' → 'accounting-hub'.
--
-- The accountant dashboard is being renamed in the UI from
-- "Accounting Queue" to "Accounting Hub" to better reflect that
-- it's a single home for the accountant (queue + W-9 + QuickBooks
-- export + bulk-paid + receipt review) rather than just an inbox.
--
-- This migration brings the database in line with the code rename:
--   - role_modules.module_id rows currently storing 'accounting-queue'
--     get rewritten to 'accounting-hub'.
--   - users.pinned_pages JSONB arrays get the same string swap so
--     anyone who pinned the page keeps their pin.
--   - The role_modules CHECK constraint is rebuilt with the new id
--     list (taking the current canonical list from the most recent
--     module migration, swapping accounting-queue → accounting-hub).
--
-- Follows the same shape as supabase-migration-rename-nav-ids.sql
-- (2026-05-06). Safe to re-run: every UPDATE is idempotent on
-- already-renamed values.
-- ============================================================

-- 1. Drop the existing CHECK constraint so the renames can proceed.
DO $$
DECLARE
  conname text;
BEGIN
  SELECT c.conname INTO conname
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  WHERE t.relname = 'role_modules' AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) ILIKE '%module_id%';
  IF conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE role_modules DROP CONSTRAINT %I', conname);
  END IF;
END $$;

-- 2. Rename the module rows.
UPDATE role_modules SET module_id = 'accounting-hub' WHERE module_id = 'accounting-queue';

-- 3. Re-add the CHECK with the new id list. Mirrors the latest module
--    migration (wholesale) with accounting-queue swapped out.
ALTER TABLE role_modules ADD CONSTRAINT role_modules_module_id_check
  CHECK (module_id IN (
    'dashboard',
    'appointments', 'buying-events', 'calendar', 'travel', 'dayentry',
    'buying-event-stores',
    'trade-shows', 'trunk-shows', 'trunk-show-stores',
    'trunk-communications', 'leads',
    'marketing', 'shipping', 'expenses', 'reports', 'customers',
    'admin', 'liberty-admin',
    'staff', 'data-research', 'financials',
    'recipients', 'notification-templates',
    'accounting-hub', 'broadcast',   -- was 'accounting-queue'
    'buy-intake', 'intake-lookup',
    'reconciliation',
    'wholesale'
  ));

-- 4. Rewrite users.pinned_pages — JSONB array of NavPage ids. Swap
--    the string in-place so the user's pinned section follows the
--    rename without dropping the pin.
UPDATE users
   SET pinned_pages = (
     SELECT COALESCE(jsonb_agg(
       CASE elem
         WHEN 'accounting-queue' THEN 'accounting-hub'
         ELSE elem
       END
     ), '[]'::jsonb)
       FROM jsonb_array_elements_text(pinned_pages) AS elem
   )
 WHERE pinned_pages IS NOT NULL
   AND jsonb_typeof(pinned_pages) = 'array'
   AND pinned_pages != '[]'::jsonb;

DO $$
DECLARE
  rowcount INT;
BEGIN
  SELECT COUNT(*) INTO rowcount FROM role_modules WHERE module_id = 'accounting-hub';
  RAISE NOTICE 'Nav id rename complete: accounting-queue → accounting-hub. % role_modules row(s) now reference the new id.', rowcount;
END $$;
