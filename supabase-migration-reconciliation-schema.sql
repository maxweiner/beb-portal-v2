-- ── Wells Fargo cleared-check reconciliation: schema ──
--
-- Four new tables back the /reconciliation page:
--
--   cleared_checks            One row per CSV-imported clearing.
--                             Brand-scoped (each brand has its own
--                             account). Unique on
--                             (brand, check_number, cleared_date,
--                             cleared_amount) so re-imports are
--                             idempotent but a real second clearing
--                             on a different date / amount creates
--                             a second row (the duplicate-clearing
--                             flag relies on that).
--
--   cleared_check_imports     One row per CSV upload. Filename, who,
--                             when, plus row-count diagnostics.
--
--   reconciliation_findings   One row per finding (matched / amount
--                             mismatch / duplicate clearing / orphan
--                             cleared / outstanding). Keyed by
--                             (brand, check_number, finding_type) so
--                             re-running the matcher preserves user-
--                             set status (disputed / resolved /
--                             ignored / open).
--
--   non_event_check_numbers   Allowlist of check numbers that are
--                             NOT event-related (rent, payroll,
--                             vendors). One click on an orphan
--                             finding adds the row here; future
--                             imports auto-classify the same number
--                             as ignored, not orphan.
--
-- All tables RLS-gated to accounting + admin + superadmin + partners
-- via the auth.jwt()->>'email' pattern used elsewhere.
--
-- Safe to re-run.
-- ============================================================

-- 1. enums
DO $$ BEGIN
  CREATE TYPE reconciliation_finding_type AS ENUM
    ('matched', 'amount_mismatch', 'duplicate_clearing', 'orphan_cleared', 'outstanding');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE reconciliation_finding_status AS ENUM
    ('open', 'disputed', 'resolved', 'ignored');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. cleared_check_imports — parent of cleared_checks via import_batch_id
CREATE TABLE IF NOT EXISTS public.cleared_check_imports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand           TEXT NOT NULL CHECK (brand IN ('beb', 'liberty')),
  filename        TEXT NOT NULL,
  uploaded_by     TEXT NOT NULL,            -- user email
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  row_count       INT  NOT NULL DEFAULT 0,  -- total CSV rows seen
  imported_count  INT  NOT NULL DEFAULT 0,  -- check rows actually inserted
  skipped_count   INT  NOT NULL DEFAULT 0,  -- non-check rows
  duplicate_count INT  NOT NULL DEFAULT 0,  -- rows that hit the unique constraint
  notes           TEXT
);
CREATE INDEX IF NOT EXISTS idx_cleared_check_imports_brand_uploaded
  ON public.cleared_check_imports (brand, uploaded_at DESC);

-- 3. cleared_checks
CREATE TABLE IF NOT EXISTS public.cleared_checks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand             TEXT NOT NULL CHECK (brand IN ('beb', 'liberty')),
  check_number      TEXT NOT NULL,
  cleared_date      DATE NOT NULL,
  cleared_amount    NUMERIC(12, 2) NOT NULL CHECK (cleared_amount > 0),
  description       TEXT NOT NULL,           -- raw WF description
  status            TEXT,                    -- raw WF status field
  import_batch_id   UUID REFERENCES public.cleared_check_imports(id) ON DELETE SET NULL,
  raw_row           JSONB,                   -- full original row, for audit
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cleared_checks_unique_clearing
  ON public.cleared_checks (brand, check_number, cleared_date, cleared_amount);
CREATE INDEX IF NOT EXISTS idx_cleared_checks_brand_check_num
  ON public.cleared_checks (brand, check_number);
CREATE INDEX IF NOT EXISTS idx_cleared_checks_brand_date
  ON public.cleared_checks (brand, cleared_date DESC);

-- 4. reconciliation_findings
CREATE TABLE IF NOT EXISTS public.reconciliation_findings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand               TEXT NOT NULL CHECK (brand IN ('beb', 'liberty')),
  check_number        TEXT NOT NULL,
  finding_type        reconciliation_finding_type NOT NULL,
  status              reconciliation_finding_status NOT NULL DEFAULT 'open',
  -- Snapshot fields populated by the matcher each run (so the UI
  -- doesn't have to re-join on every render). Kept in sync via the
  -- upsert key below.
  written_amount      NUMERIC(12, 2),
  cleared_amount_total NUMERIC(12, 2),       -- sum across clearings (matters for duplicate_clearing)
  cleared_count       INT NOT NULL DEFAULT 0,
  amount_delta        NUMERIC(12, 2),        -- written - cleared_amount_total; signed
  written_date        DATE,                  -- date the check was written (event start_date + day-1)
  cleared_dates       DATE[],                -- array of clearing dates
  payee_label         TEXT,                  -- store name or seller name
  event_id            UUID,
  event_label         TEXT,
  -- User-set fields
  note                TEXT,
  resolved_by         TEXT,
  resolved_at         TIMESTAMPTZ,
  -- Housekeeping
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_matched_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Upsert key: at most one finding per (brand, check_number, finding_type).
-- duplicate_clearing rolls all clearings of one check into a single row.
CREATE UNIQUE INDEX IF NOT EXISTS idx_reconciliation_findings_upsert_key
  ON public.reconciliation_findings (brand, check_number, finding_type);
CREATE INDEX IF NOT EXISTS idx_reconciliation_findings_brand_status
  ON public.reconciliation_findings (brand, status, finding_type);

-- 5. non_event_check_numbers — allowlist of "not an event check"
CREATE TABLE IF NOT EXISTS public.non_event_check_numbers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand         TEXT NOT NULL CHECK (brand IN ('beb', 'liberty')),
  check_number  TEXT NOT NULL,
  marked_by     TEXT NOT NULL,
  marked_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  note          TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_non_event_check_numbers_brand_num
  ON public.non_event_check_numbers (brand, check_number);

-- 6. RLS: accounting + admin + superadmin + partners can do everything
ALTER TABLE public.cleared_check_imports     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cleared_checks            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reconciliation_findings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.non_event_check_numbers   ENABLE ROW LEVEL SECURITY;

-- Common WHERE clause: caller is accounting / admin / superadmin / partner.
-- Inlined per policy to avoid a SQL function dependency.
DO $$ BEGIN
  -- cleared_check_imports
  EXECUTE 'DROP POLICY IF EXISTS reconciliation_imports_rw ON public.cleared_check_imports';
  EXECUTE $p$
    CREATE POLICY reconciliation_imports_rw ON public.cleared_check_imports
      FOR ALL TO authenticated
      USING (EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.email = auth.jwt()->>'email'
          AND (u.role IN ('accounting','admin','superadmin') OR u.is_partner IS TRUE)
      ))
      WITH CHECK (EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.email = auth.jwt()->>'email'
          AND (u.role IN ('accounting','admin','superadmin') OR u.is_partner IS TRUE)
      ))
  $p$;

  -- cleared_checks
  EXECUTE 'DROP POLICY IF EXISTS reconciliation_cleared_rw ON public.cleared_checks';
  EXECUTE $p$
    CREATE POLICY reconciliation_cleared_rw ON public.cleared_checks
      FOR ALL TO authenticated
      USING (EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.email = auth.jwt()->>'email'
          AND (u.role IN ('accounting','admin','superadmin') OR u.is_partner IS TRUE)
      ))
      WITH CHECK (EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.email = auth.jwt()->>'email'
          AND (u.role IN ('accounting','admin','superadmin') OR u.is_partner IS TRUE)
      ))
  $p$;

  -- reconciliation_findings
  EXECUTE 'DROP POLICY IF EXISTS reconciliation_findings_rw ON public.reconciliation_findings';
  EXECUTE $p$
    CREATE POLICY reconciliation_findings_rw ON public.reconciliation_findings
      FOR ALL TO authenticated
      USING (EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.email = auth.jwt()->>'email'
          AND (u.role IN ('accounting','admin','superadmin') OR u.is_partner IS TRUE)
      ))
      WITH CHECK (EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.email = auth.jwt()->>'email'
          AND (u.role IN ('accounting','admin','superadmin') OR u.is_partner IS TRUE)
      ))
  $p$;

  -- non_event_check_numbers
  EXECUTE 'DROP POLICY IF EXISTS reconciliation_allowlist_rw ON public.non_event_check_numbers';
  EXECUTE $p$
    CREATE POLICY reconciliation_allowlist_rw ON public.non_event_check_numbers
      FOR ALL TO authenticated
      USING (EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.email = auth.jwt()->>'email'
          AND (u.role IN ('accounting','admin','superadmin') OR u.is_partner IS TRUE)
      ))
      WITH CHECK (EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.email = auth.jwt()->>'email'
          AND (u.role IN ('accounting','admin','superadmin') OR u.is_partner IS TRUE)
      ))
  $p$;
END $$;

-- 7. Updated-at trigger for findings
CREATE OR REPLACE FUNCTION public.reconciliation_findings_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_reconciliation_findings_set_updated_at ON public.reconciliation_findings;
CREATE TRIGGER trg_reconciliation_findings_set_updated_at
  BEFORE UPDATE ON public.reconciliation_findings
  FOR EACH ROW EXECUTE FUNCTION public.reconciliation_findings_set_updated_at();

DO $$ BEGIN
  RAISE NOTICE 'Reconciliation schema installed: cleared_checks, cleared_check_imports, reconciliation_findings, non_event_check_numbers + RLS + indexes.';
END $$;
