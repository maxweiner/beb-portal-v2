-- ============================================================
-- Clean up duplicate buyer_entries created by a race condition in
-- MobileDayEntry.tsx, then add a UNIQUE index so it can't happen
-- again. Run top-to-bottom in the Supabase SQL Editor.
-- ============================================================

-- 1. INSPECT: which (event_id, day_number, buyer_id) groups have dupes?
SELECT event_id, day_number, buyer_id, buyer_name, COUNT(*) AS dupes
FROM buyer_entries
GROUP BY event_id, day_number, buyer_id, buyer_name
HAVING COUNT(*) > 1
ORDER BY dupes DESC;

-- 2. DELETE older duplicates — keep the latest row per unique key.
--    "Latest" = most recent submitted_at, falling back to created_at.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY event_id, day_number, buyer_id
           ORDER BY COALESCE(submitted_at, created_at) DESC
         ) AS rn
  FROM buyer_entries
)
DELETE FROM buyer_entries
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- 3. Remove orphaned buyer_checks that pointed at deleted entries.
DELETE FROM buyer_checks
WHERE entry_id NOT IN (SELECT id FROM buyer_entries);

-- 4. Prevent future duplicates at the DB layer. Belt-and-braces —
--    the app's mutex stops it; this catches anything the app misses.
CREATE UNIQUE INDEX IF NOT EXISTS idx_buyer_entries_unique
  ON buyer_entries(event_id, day_number, buyer_id);

-- 5. Verify — this should now always return 0 rows.
SELECT event_id, day_number, buyer_id, COUNT(*) AS dupes
FROM buyer_entries
GROUP BY event_id, day_number, buyer_id
HAVING COUNT(*) > 1;
