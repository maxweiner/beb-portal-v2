-- ============================================================
-- DESTRUCTIVE: drop the To-Do List module entirely.
--
-- Removes the four todo tables (and all their data), the helper
-- functions + diagnostic leftovers, the 'todo' grants in role_modules,
-- and 'todo' from the module_id CHECK constraint.
--
-- After this migration, code references to module_id='todo' don't
-- exist anywhere in the codebase either (Sidebar entry, page route,
-- RoleManagerPanel option all removed).
--
-- Order matters: drop tables first (CASCADE removes triggers + RLS
-- policies that reference the helper functions), THEN drop the
-- functions (which would otherwise still be considered in-use).
--
-- Safe to re-run.
-- ============================================================

-- 1. Drop tables. CASCADE picks up triggers, policies, and any FK
--    references inside the schema (none currently exist).
DROP TABLE IF EXISTS todo_notifications CASCADE;
DROP TABLE IF EXISTS todos              CASCADE;
DROP TABLE IF EXISTS todo_list_members  CASCADE;
DROP TABLE IF EXISTS todo_lists         CASCADE;

-- 2. Drop helper + trigger + RPC functions. Includes diagnostic
--    leftovers from the earlier debug rounds, in case any survived.
DROP FUNCTION IF EXISTS todo_add_owner_as_member()    CASCADE;
DROP FUNCTION IF EXISTS todo_assign_task(uuid, uuid)  CASCADE;
DROP FUNCTION IF EXISTS todo_current_user_id()        CASCADE;
DROP FUNCTION IF EXISTS todo_is_list_member(uuid)     CASCADE;
DROP FUNCTION IF EXISTS todo_is_list_owner(uuid)      CASCADE;
DROP FUNCTION IF EXISTS todo_touch_updated_at()       CASCADE;
DROP FUNCTION IF EXISTS todo_debug_insert_check()     CASCADE;

-- 3. Remove 'todo' grants from role_modules + drop it from the
--    enum CHECK so future inserts can't reference a missing module.
DELETE FROM role_modules WHERE module_id = 'todo';

DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE  conrelid = 'public.role_modules'::regclass
      AND  contype  = 'c'
      AND  pg_get_constraintdef(oid) ILIKE '%module_id%'
  LOOP
    EXECUTE format('ALTER TABLE public.role_modules DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE role_modules
  ADD CONSTRAINT role_modules_module_id_check
  CHECK (module_id IN (
    'dashboard', 'calendar', 'events', 'schedule', 'travel',
    'dayentry', 'staff', 'admin', 'libertyadmin', 'stores',
    'data-research', 'reports', 'financials', 'marketing',
    'shipping', 'expenses', 'recipients', 'notification-templates',
    'customers'
  ));

DO $$ BEGIN
  RAISE NOTICE 'To-Do module dropped: tables, functions, role grants, and CHECK enum cleaned up.';
END $$;
