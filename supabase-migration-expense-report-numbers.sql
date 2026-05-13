-- ============================================================
-- Expense Reports — human-readable report numbers
--
-- Swaps out `report.id.slice(0, 8)` (8 hex chars of the UUID) for a
-- monotonic per-brand counter shown in PDFs + accountant emails:
--   BEB:     ER-B10001, ER-B10002, ...
--   Liberty: ER-L20001, ER-L20002, ...
--
-- Why per-brand:
--   - Accounting refers to reports by number when filing; two
--     prefixes prevent collisions when working across brands.
--   - Starts at 10001 / 20001 so the numbers always read as 5
--     digits — no awkward early ER-B1 / ER-B2 era.
--
-- Snapshot-at-insert semantic: once a report has a number, that
-- number never changes. Counter sits at MAX(existing) so future
-- inserts keep counting from where backfill ended.
--
-- What this migration adds:
--   1. expense_reports.brand TEXT
--   2. expense_reports.report_number TEXT (UNIQUE after backfill)
--   3. expense_report_counters(brand, last_number) — per-brand counter
--   4. next_expense_report_number(brand) — atomic increment + format
--      ('ER-B10001'). SECURITY DEFINER so it can write the counter
--      regardless of caller RLS.
--   5. Backfill brand from events.brand → users.last_active_brand
--      → 'beb' fallback.
--   6. Backfill report_number for existing rows in created_at order
--      so the earliest report becomes ER-B10001 / ER-L20001.
--   7. BEFORE INSERT trigger that fills both columns when omitted by
--      the app — keeps the existing INSERT call sites unchanged.
--
-- Idempotent. Safe to re-run (counter backfill skips rows that
-- already have a number; trigger is replaced; counter rows only
-- inserted ON CONFLICT DO NOTHING).
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. Columns
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.expense_reports
  ADD COLUMN IF NOT EXISTS brand TEXT,
  ADD COLUMN IF NOT EXISTS report_number TEXT;


-- ─────────────────────────────────────────────────────────────
-- 2. Per-brand counter table
-- ─────────────────────────────────────────────────────────────
-- One row per brand. last_number is the highest number ever
-- allocated for that brand. next_expense_report_number() does
-- UPDATE ... SET last_number = last_number + 1 RETURNING ...,
-- which is atomic and lock-safe under concurrent inserts.
CREATE TABLE IF NOT EXISTS public.expense_report_counters (
  brand       TEXT PRIMARY KEY,
  last_number INTEGER NOT NULL
);

-- Seed so the FIRST allocation for each brand yields the requested
-- starting number (10001 / 20001). last_number is the value JUST
-- allocated, so seeding at N-1 means the next allocation returns N.
INSERT INTO public.expense_report_counters (brand, last_number) VALUES
  ('beb',     10000),
  ('liberty', 20000)
ON CONFLICT (brand) DO NOTHING;


-- ─────────────────────────────────────────────────────────────
-- 3. Allocation function
-- ─────────────────────────────────────────────────────────────
-- Atomically increments the counter for the given brand and
-- returns the formatted report number ('ER-B10001').
--
-- SECURITY DEFINER lets the trigger call this regardless of the
-- inserting user's RLS posture against expense_report_counters.
-- The trigger is the only intended caller; the function is not
-- granted to authenticated/anon directly.
CREATE OR REPLACE FUNCTION public.next_expense_report_number(p_brand TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next   INTEGER;
  v_letter TEXT;
BEGIN
  -- Normalize: unknown brands collapse to 'beb' so we never insert
  -- a counter row for typos / future brands without an explicit
  -- starting number.
  IF p_brand NOT IN ('beb', 'liberty') THEN
    p_brand := 'beb';
  END IF;

  -- Atomic increment. The row-level lock held by this UPDATE
  -- serializes concurrent inserts for the same brand.
  UPDATE public.expense_report_counters
  SET last_number = last_number + 1
  WHERE brand = p_brand
  RETURNING last_number INTO v_next;

  IF v_next IS NULL THEN
    -- Shouldn't happen since we seeded both brands above, but
    -- defend in case a brand row is missing.
    v_next := CASE WHEN p_brand = 'liberty' THEN 20001 ELSE 10001 END;
    INSERT INTO public.expense_report_counters (brand, last_number)
    VALUES (p_brand, v_next)
    ON CONFLICT (brand) DO UPDATE SET last_number = EXCLUDED.last_number
    RETURNING last_number INTO v_next;
  END IF;

  v_letter := CASE WHEN p_brand = 'liberty' THEN 'L' ELSE 'B' END;
  RETURN 'ER-' || v_letter || v_next::TEXT;
END;
$$;


-- ─────────────────────────────────────────────────────────────
-- 4. Backfill: brand
-- ─────────────────────────────────────────────────────────────
-- Resolve brand from the linked event first (the authoritative
-- source for buying-event reports), then fall back to the report
-- owner's last_active_brand, then 'beb'.
UPDATE public.expense_reports er
SET brand = COALESCE(
  (SELECT e.brand FROM public.events e WHERE e.id = er.event_id LIMIT 1),
  (SELECT u.last_active_brand FROM public.users u WHERE u.id = er.user_id LIMIT 1),
  'beb'
)
WHERE er.brand IS NULL;


-- ─────────────────────────────────────────────────────────────
-- 5. Backfill: report_number
-- ─────────────────────────────────────────────────────────────
-- Iterate in created_at order per brand so the earliest report
-- becomes ER-B10001 / ER-L20001 and subsequent ones count up.
-- Skips rows that already have a number → safe to re-run if a
-- partial backfill failed mid-way.
--
-- Counter advances naturally via next_expense_report_number(), so
-- after this block finishes the counter row reads MAX(existing)
-- for each brand and new inserts continue from there.
DO $$
DECLARE
  r RECORD;
  v_num TEXT;
BEGIN
  FOR r IN
    SELECT id, brand
    FROM public.expense_reports
    WHERE report_number IS NULL
    ORDER BY created_at ASC
  LOOP
    v_num := public.next_expense_report_number(r.brand);
    UPDATE public.expense_reports SET report_number = v_num WHERE id = r.id;
  END LOOP;
END $$;


-- ─────────────────────────────────────────────────────────────
-- 6. UNIQUE constraint on report_number
-- ─────────────────────────────────────────────────────────────
-- Now that every existing row has a unique number, lock it in.
-- Index over the column (not partial) — NULLs would be a bug
-- post-trigger, so we'd want the constraint to scream if one
-- ever slipped through.
CREATE UNIQUE INDEX IF NOT EXISTS uq_expense_reports_report_number
  ON public.expense_reports (report_number);


-- ─────────────────────────────────────────────────────────────
-- 7. BEFORE INSERT trigger
-- ─────────────────────────────────────────────────────────────
-- Fills brand + report_number on insert when the app omits them.
-- Keeps existing INSERT call sites in the app unchanged (today
-- ExpensesList inserts with just { event_id, user_id } and a
-- couple of optional fields — both new columns are auto-filled
-- here).
--
-- If the caller provides report_number explicitly (e.g. a future
-- restore-from-backup script), the trigger doesn't overwrite it.
CREATE OR REPLACE FUNCTION public.assign_expense_report_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.brand IS NULL THEN
    NEW.brand := COALESCE(
      (SELECT e.brand FROM public.events e WHERE e.id = NEW.event_id LIMIT 1),
      (SELECT u.last_active_brand FROM public.users u WHERE u.id = NEW.user_id LIMIT 1),
      'beb'
    );
  END IF;
  IF NEW.report_number IS NULL THEN
    NEW.report_number := public.next_expense_report_number(NEW.brand);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_expense_report_number ON public.expense_reports;
CREATE TRIGGER trg_assign_expense_report_number
  BEFORE INSERT ON public.expense_reports
  FOR EACH ROW EXECUTE FUNCTION public.assign_expense_report_number();


-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_beb_max INTEGER;
  v_lib_max INTEGER;
BEGIN
  SELECT last_number INTO v_beb_max FROM public.expense_report_counters WHERE brand = 'beb';
  SELECT last_number INTO v_lib_max FROM public.expense_report_counters WHERE brand = 'liberty';
  RAISE NOTICE 'Expense report numbers ready. Counter state: beb=%, liberty=%. Existing reports backfilled in created_at order; new inserts auto-assign via trigger.', v_beb_max, v_lib_max;
END $$;
