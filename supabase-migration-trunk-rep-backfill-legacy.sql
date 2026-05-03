-- ── Backfill placeholder users for every legacy trunk rep ────────────
-- The trunk-rep migration only auto-linked stores whose ts_reps text
-- matched exactly ONE existing public.users row. Anything else (typo
-- mismatches, reps who never had a login, multi-rep cells) was left
-- with trunk_rep_user_id = NULL.
--
-- This migration:
--   1. Splits every ts_reps cell on / , ; to surface every distinct rep name.
--   2. For each distinct name with no existing user match, creates a
--      placeholder users row (role=pending, is_trunk_rep=TRUE, active=TRUE,
--      placeholder email) so the admin can fill in real contact info later.
--   3. Auto-links each unlinked store to the user matching its first-token
--      rep name.
--
-- Safe to re-run.
-- ====================================================================

-- 1. Create placeholder users for every distinct unmatched rep name.
WITH raw AS (
  SELECT trim(unnest(regexp_split_to_array(ts_reps, '[/,;]'))) AS name
    FROM public.trunk_show_stores
   WHERE ts_reps IS NOT NULL
     AND length(trim(ts_reps)) > 0
),
distinct_names AS (
  SELECT DISTINCT name FROM raw WHERE length(name) > 0
),
unmatched AS (
  SELECT dn.name
    FROM distinct_names dn
   WHERE NOT EXISTS (
     SELECT 1 FROM public.users u
      WHERE u.active = TRUE
        AND (u.name ILIKE dn.name || '%' OR u.name ILIKE '% ' || dn.name || '%')
   )
)
INSERT INTO public.users (name, email, role, active, is_trunk_rep, notify, phone)
SELECT u.name,
       'legacy-trunk-rep-' || lower(regexp_replace(u.name, '[^a-zA-Z0-9]+', '-', 'g')) || '@placeholder.bebllp.local',
       'pending',
       TRUE,
       TRUE,
       FALSE,
       ''
  FROM unmatched u
 WHERE NOT EXISTS (
   SELECT 1 FROM public.users existing
    WHERE existing.email = 'legacy-trunk-rep-' || lower(regexp_replace(u.name, '[^a-zA-Z0-9]+', '-', 'g')) || '@placeholder.bebllp.local'
 );

-- 2. Link each unlinked store to the user matching its first-token rep name.
--    Match against the (possibly newly created) placeholder OR an existing
--    user, case-insensitive on the leading token. If the token still has
--    multiple matches we leave it NULL — the admin will resolve in the GUI.
WITH first_token AS (
  SELECT id, trim(regexp_replace(ts_reps, '[/,;].*$', '')) AS token
    FROM public.trunk_show_stores
   WHERE ts_reps IS NOT NULL
     AND length(trim(ts_reps)) > 0
     AND trunk_rep_user_id IS NULL
),
unique_match AS (
  SELECT ft.id AS store_id, (array_agg(u.id))[1] AS user_id
    FROM first_token ft
    JOIN public.users u
      ON u.active = TRUE
     AND (u.name ILIKE ft.token || '%' OR u.name ILIKE '% ' || ft.token || '%')
   GROUP BY ft.id
  HAVING COUNT(DISTINCT u.id) = 1
)
UPDATE public.trunk_show_stores tss
   SET trunk_rep_user_id = m.user_id
  FROM unique_match m
 WHERE tss.id = m.store_id;

-- 3. Make sure every linked rep has the is_trunk_rep flag set.
UPDATE public.users u
   SET is_trunk_rep = TRUE
 WHERE is_trunk_rep = FALSE
   AND EXISTS (
     SELECT 1 FROM public.trunk_show_stores tss
      WHERE tss.trunk_rep_user_id = u.id
   );

-- 4. Report what's left so the admin knows the cleanup queue size.
DO $$
DECLARE
  v_unlinked INT;
  v_total    INT;
BEGIN
  SELECT COUNT(*) INTO v_total
    FROM public.trunk_show_stores
   WHERE ts_reps IS NOT NULL AND length(trim(ts_reps)) > 0;
  SELECT COUNT(*) INTO v_unlinked
    FROM public.trunk_show_stores
   WHERE ts_reps IS NOT NULL
     AND length(trim(ts_reps)) > 0
     AND trunk_rep_user_id IS NULL;
  RAISE NOTICE 'Trunk-rep backfill done: % stores still unlinked of % with ts_reps.', v_unlinked, v_total;
END $$;
