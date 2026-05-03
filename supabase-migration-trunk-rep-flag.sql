-- ── Trunk Rep flag + ts_reps → user FK migration ─────────────────
-- Adds users.is_trunk_rep so admins can mark which users are
-- available to staff trunk shows (parallel to is_buyer for buying
-- events). Adds trunk_show_stores.trunk_rep_user_id and best-effort
-- populates it from the existing free-text `ts_reps` column.
--
-- Default: FALSE for everyone, EXCEPT users with role=sales_rep
-- (single-role) or with sales_rep in user_roles (multi-role) — those
-- get TRUE on the backfill.
--
-- Idempotent. Safe to re-run.

-- ── 1. users.is_trunk_rep ──────────────────────────────────────
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_trunk_rep BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.users.is_trunk_rep IS
  'When TRUE the user is available to staff trunk shows. Toggled via AdminPanel by superadmin / trunk_admin only. Parallel to is_buyer.';

-- ── 2. Backfill: sales_reps default to TRUE ────────────────────
-- Single-role: users.role = 'sales_rep'.
-- Multi-role:  user_roles join row.
UPDATE public.users
   SET is_trunk_rep = TRUE
 WHERE role = 'sales_rep'
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
       WHERE ur.user_id = users.id AND ur.role_id = 'sales_rep'
    );

-- ── 3. Extend users update RLS to include trunk_admin ──────────
-- Pre-existing users_admin_update only allows admin/superadmin.
-- trunk_admin needs write access on users to flip is_trunk_rep.
DROP POLICY IF EXISTS users_admin_update ON public.users;
CREATE POLICY users_admin_update ON public.users
  FOR UPDATE TO public
  USING (public.has_any_role('admin', 'superadmin', 'trunk_admin'));

-- ── 4. trunk_show_stores.trunk_rep_user_id ─────────────────────
ALTER TABLE public.trunk_show_stores
  ADD COLUMN IF NOT EXISTS trunk_rep_user_id UUID
    REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS trunk_show_stores_trunk_rep_user_id_idx
  ON public.trunk_show_stores (trunk_rep_user_id);

COMMENT ON COLUMN public.trunk_show_stores.trunk_rep_user_id IS
  'FK to users.id — the assigned trunk rep. Replaces the legacy free-text ts_reps. Old text column kept for now as historical reference.';

-- ── 5. Best-effort migrate ts_reps text → trunk_rep_user_id ───
-- Strategy: take the first whitespace-separated token from ts_reps
-- (e.g. "Tanya", "Ann"; multi-rep entries like "Tanya/Ann" pick up
-- the first segment via the regex). Match it case-insensitively to
-- a single active user. Ambiguous matches (>1 user) and zero-match
-- rows are left NULL — a superadmin/trunk_admin can finish them in
-- the GUI.
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

-- Mark every matched user as a trunk rep (they were referenced by
-- name in the import sheet, so the spreadsheet author considered
-- them trunk reps).
UPDATE public.users u
   SET is_trunk_rep = TRUE
 WHERE EXISTS (
   SELECT 1 FROM public.trunk_show_stores tss WHERE tss.trunk_rep_user_id = u.id
 );

-- ── 6. Surface unmatched names so the admin can clean up ───────
DO $$
DECLARE
  unmatched_count INT;
  example TEXT;
BEGIN
  SELECT COUNT(*) INTO unmatched_count
    FROM public.trunk_show_stores
   WHERE ts_reps IS NOT NULL
     AND length(trim(ts_reps)) > 0
     AND trunk_rep_user_id IS NULL;

  SELECT string_agg(DISTINCT trim(regexp_replace(ts_reps, '[/,;].*$', '')), ', ')
    INTO example
    FROM public.trunk_show_stores
   WHERE ts_reps IS NOT NULL
     AND length(trim(ts_reps)) > 0
     AND trunk_rep_user_id IS NULL;

  RAISE NOTICE 'Trunk Rep migration complete. % store rows have a ts_reps name that did not match a unique user. Unmatched name tokens: %', unmatched_count, COALESCE(example, '(none)');
  RAISE NOTICE 'To inspect: SELECT id, name, ts_reps FROM trunk_show_stores WHERE trunk_rep_user_id IS NULL AND ts_reps IS NOT NULL;';
END $$;
