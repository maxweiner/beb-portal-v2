-- ============================================================
-- Expense Delegates — Ryan submits expense reports on Alan's behalf
--
-- Alan (age 65) is computer-illiterate and won't log in, but he
-- HAS a portal account. Ryan files expenses for him. The resulting
-- reports are owned by Alan (reimbursement to Alan, approval through
-- Alan's normal path, PDF labelled "Alan — Expense Report"); Ryan
-- appears only on a small "Submitted by Ryan on his behalf" audit
-- line.
--
-- Scope is *narrower* than impersonation:
--   - Only inside the Expenses module (top-of-page picker
--     "Submitting for: [Me ▼ / Alan]")
--   - Outside Expenses, Ryan stays Ryan
--   - Configured by Max only (max@bebllp.com), enforced at the
--     API layer in Phase 2 — same pattern as impersonation
--     (see supabase-migration-impersonation-phase-1.sql, which
--     also keeps single-actor enforcement out of RLS so a
--     re-invite of Max doesn't break the gate).
--
-- Soft-delete revocation: revocation sets revoked_at = now() so
-- the row stays for audit. Active delegations = revoked_at IS NULL.
-- Question "who could have filed under Alan in May?" is always
-- answerable from this table.
--
-- Many-to-many shape: today only one row (Ryan → Alan), but no
-- schema change needed if it ever fans out (e.g. Alan gets a
-- second delegate, or Ryan gains a second principal).
--
-- What this migration adds:
--   1. expense_delegates table + indexes
--   2. Partial unique index preventing duplicate ACTIVE rows for
--      the same (delegate, principal) pair (historical revoked
--      rows are still allowed for audit)
--   3. RLS:
--      - READ: admins, partners, accounting, OR the delegate
--        themselves (so the Expenses module knows whom they can
--        submit for), OR the principal themselves (so Alan can
--        see "who is authorized to file on my behalf?" in his
--        Settings — even though Alan doesn't log in, this leaves
--        the door open for him or any future principal)
--      - WRITE: no policies — service-role only. The Phase 2 API
--        route gates writes to max@bebllp.com only, mirroring the
--        impersonation pattern.
--
-- Idempotent. Safe to re-run.
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. expense_delegates table
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.expense_delegates (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The user who can file expense reports on behalf of someone else.
  delegate_user_id   uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  -- The user being filed for — the owner of the resulting report.
  principal_user_id  uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  created_at         timestamptz NOT NULL DEFAULT now(),

  -- Who configured this row (Max). ON DELETE SET NULL so deleting
  -- Max's user row doesn't FK-break the history; audit still
  -- contains delegate/principal/timestamp.
  created_by         uuid        REFERENCES public.users(id) ON DELETE SET NULL,

  -- Soft-delete. NULL = active; non-null = revoked at this time.
  revoked_at         timestamptz NULL,

  -- A user can't delegate to themselves.
  CONSTRAINT expense_delegates_distinct
    CHECK (delegate_user_id <> principal_user_id)
);


-- ─────────────────────────────────────────────────────────────
-- 2. Indexes
-- ─────────────────────────────────────────────────────────────

-- "Which principals can Ryan submit for right now?" — every page
-- load in the Expenses module hits this to populate the picker.
CREATE INDEX IF NOT EXISTS idx_expense_delegates_delegate_active
  ON public.expense_delegates (delegate_user_id)
  WHERE revoked_at IS NULL;

-- "Who can submit on Alan's behalf right now?" — used by Settings
-- → Expense Delegates card and by the audit line on submission.
CREATE INDEX IF NOT EXISTS idx_expense_delegates_principal_active
  ON public.expense_delegates (principal_user_id)
  WHERE revoked_at IS NULL;

-- Prevent two ACTIVE rows for the same (delegate, principal)
-- pair. Re-adding a revoked pairing creates a new row (so the
-- audit trail keeps the original revoked_at timestamp).
CREATE UNIQUE INDEX IF NOT EXISTS uq_expense_delegates_active_pair
  ON public.expense_delegates (delegate_user_id, principal_user_id)
  WHERE revoked_at IS NULL;


-- ─────────────────────────────────────────────────────────────
-- 3. RLS
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.expense_delegates ENABLE ROW LEVEL SECURITY;

-- READ: admins/superadmins/accounting/partners see all rows;
-- the delegate sees rows naming them (so the picker can render);
-- the principal sees rows naming them.
--
-- All identity checks go through get_effective_user_id() so
-- impersonation is honored transparently (per RLS conventions
-- locked in PR #582, see CLAUDE.md memory on auth_id-first).
DROP POLICY IF EXISTS expense_delegates_read ON public.expense_delegates;
CREATE POLICY expense_delegates_read
  ON public.expense_delegates FOR SELECT TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin', 'accounting')
    OR public.is_my_partner()
    OR delegate_user_id  = public.get_effective_user_id()
    OR principal_user_id = public.get_effective_user_id()
  );

-- WRITE: no INSERT/UPDATE/DELETE policies. Only service-role can
-- write. The Phase 2 API route reads auth.jwt()->>'email', checks
-- it equals max@bebllp.com (case-insensitive), and only then uses
-- the service-role client to mutate.
--
-- Why this pattern (vs. an RLS gate on max@bebllp.com directly):
--   - Misconfiguring delegation lets someone file under another
--     user's name. Keeping the gate in app code makes it easier
--     to audit, test, and change without an RLS migration.
--   - Mirrors impersonation_sessions, which also has no write
--     policies for the same reason.


-- ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  RAISE NOTICE 'expense_delegates table ready. Phase 2 wires Settings → 🤝 Expense Delegates card + Max-only API. Phase 3 adds the top-of-page Submitting for: picker inside the Expenses module.';
END $$;
