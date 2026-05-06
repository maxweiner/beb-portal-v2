-- ── Unify nav labels across desktop / mobile + rename four nav ids ──
-- Per the labels table the team agreed on (2026-05-06):
--   calendar     → appointments     (the buyer-appointments admin page)
--   schedule     → calendar         (the buyer time-off / event calendar — was mislabeled)
--   events       → buying-events    (kebab-case to match trade-shows / data-research)
--   libertyadmin → liberty-admin    (kebab-case)
--
-- IMPORTANT: 'calendar' → 'appointments' must run BEFORE 'schedule' →
-- 'calendar', otherwise the second update collides with the first
-- (both old rows would end up named 'calendar').
--
-- Affected tables:
--   - role_modules (CHECK constraint + module_id rows)
--   - users.pinned_pages (JSONB array of NavPage ids per user)
--
-- Safe to re-run: every UPDATE is idempotent on already-renamed values
-- because the WHERE / CASE only touches old strings.
-- ============================================================

-- 1. Drop the existing CHECK constraint so the renames can proceed
--    without bumping into the old enumeration.
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

-- 2. Rename rows in role_modules. Order matters for the calendar/schedule
--    swap.
UPDATE role_modules SET module_id = 'appointments'   WHERE module_id = 'calendar';
UPDATE role_modules SET module_id = 'calendar'       WHERE module_id = 'schedule';
UPDATE role_modules SET module_id = 'buying-events'  WHERE module_id = 'events';
UPDATE role_modules SET module_id = 'liberty-admin'  WHERE module_id = 'libertyadmin';

-- 3. Re-add the CHECK constraint with the new id list.
ALTER TABLE role_modules ADD CONSTRAINT role_modules_module_id_check
  CHECK (module_id IN (
    'dashboard',
    -- buying side
    'appointments',     -- (was 'calendar')   — buyer appointment schedule
    'buying-events',    -- (was 'events')     — buying event admin
    'calendar',         -- (was 'schedule')   — buyer time-off + event calendar
    'travel', 'dayentry',
    -- selling side
    'trade-shows', 'trunk-shows', 'trunk-show-stores',
    'trunk-communications', 'leads',
    -- ops
    'marketing', 'shipping', 'expenses', 'reports', 'customers',
    -- admin
    'admin', 'liberty-admin',  -- (was 'libertyadmin')
    'staff', 'stores', 'data-research', 'financials',
    'recipients', 'notification-templates'
  ));

-- 4. Rewrite users.pinned_pages — JSONB array of NavPage ids. CASE
--    against jsonb_array_elements_text so the comparison is pure text;
--    rebuild the array with jsonb_agg. Single CASE means the swap
--    works in one pass (every elem is rewritten from its ORIGINAL
--    value, not the post-rewrite value).
UPDATE users
   SET pinned_pages = (
     SELECT COALESCE(jsonb_agg(
       CASE elem
         WHEN 'calendar'     THEN 'appointments'
         WHEN 'schedule'     THEN 'calendar'
         WHEN 'events'       THEN 'buying-events'
         WHEN 'libertyadmin' THEN 'liberty-admin'
         ELSE elem
       END
     ), '[]'::jsonb)
       FROM jsonb_array_elements_text(pinned_pages) AS elem
   )
 WHERE pinned_pages IS NOT NULL
   AND jsonb_typeof(pinned_pages) = 'array'
   AND pinned_pages != '[]'::jsonb;

DO $$ BEGIN
  RAISE NOTICE 'Nav-id rename complete: calendar→appointments, schedule→calendar, events→buying-events, libertyadmin→liberty-admin.';
END $$;
