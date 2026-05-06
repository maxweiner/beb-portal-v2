-- ── Rename nav id 'stores' → 'buying-event-stores' for clarity ──
-- The 'stores' nav item shows the buying-event store list (where
-- BEB hosts buying events). The label was ambiguous next to the
-- selling-side 'trunk-show-stores' module, so the team renamed it
-- to "Buying Event Stores" and moved it to the Buying section of
-- the sidebar (2026-05-06).
--
-- Important: this is a NAV ID rename (role_modules.module_id) only.
-- The actual public.stores database TABLE keeps its name —
-- renaming that would touch hundreds of FKs across the schema.
--
-- Affected:
--   - role_modules CHECK constraint + module_id rows
--   - users.pinned_pages JSONB array
--
-- Safe to re-run.
-- ============================================================

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

UPDATE role_modules SET module_id = 'buying-event-stores' WHERE module_id = 'stores';

ALTER TABLE role_modules ADD CONSTRAINT role_modules_module_id_check
  CHECK (module_id IN (
    'dashboard',
    -- buying side
    'appointments', 'buying-events', 'calendar', 'travel', 'dayentry',
    'buying-event-stores',  -- (was 'stores') — buying-side store master list
    -- selling side
    'trade-shows', 'trunk-shows', 'trunk-show-stores',
    'trunk-communications', 'leads',
    -- ops
    'marketing', 'shipping', 'expenses', 'reports', 'customers',
    -- admin
    'admin', 'liberty-admin',
    'staff', 'data-research', 'financials',
    'recipients', 'notification-templates'
  ));

UPDATE users
   SET pinned_pages = (
     SELECT COALESCE(jsonb_agg(
       CASE elem
         WHEN 'stores' THEN 'buying-event-stores'
         ELSE elem
       END
     ), '[]'::jsonb)
       FROM jsonb_array_elements_text(pinned_pages) AS elem
   )
 WHERE pinned_pages IS NOT NULL
   AND jsonb_typeof(pinned_pages) = 'array'
   AND pinned_pages != '[]'::jsonb
   AND pinned_pages @> '"stores"'::jsonb;

DO $$ BEGIN
  RAISE NOTICE 'Nav id rename complete: stores → buying-event-stores.';
END $$;
