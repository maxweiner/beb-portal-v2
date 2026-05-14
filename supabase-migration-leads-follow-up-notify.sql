-- ============================================================
-- Leads — follow-up date notifications
--
-- Adds the plumbing for:
--   1. A red badge on the Leads sidebar nav whenever the operator
--      has leads with a follow_up_date due today or overdue.
--   2. A daily email digest cron that emails each owner a list
--      of their due / overdue leads.
--
-- The recipient model is "assigned rep, falling back to whoever
-- last set the follow-up date" — covers the case where Teri
-- sets a follow-up on an unassigned lead and still wants the
-- reminder.
--
-- Schema additions:
--   • follow_up_set_by_user_id  — stamped automatically when
--     follow_up_date is set or changed (trigger below). Used as
--     the fallback recipient when assigned_rep_id IS NULL.
--   • follow_up_email_last_sent_on — guards against duplicate
--     emails on the same day. Reset by the trigger whenever
--     follow_up_date changes (a new date earns a fresh reminder).
--
-- The trigger is BEFORE INSERT OR UPDATE on leads so the stamp
-- happens during normal write flow without requiring application
-- code changes. Service-role writes (cron, admin tools) skip the
-- stamp since get_effective_user_id() returns NULL for them.
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. Columns
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS follow_up_set_by_user_id UUID NULL
    REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS follow_up_email_last_sent_on DATE NULL;

COMMENT ON COLUMN public.leads.follow_up_set_by_user_id IS
  'Who last set or changed follow_up_date. Stamped automatically by trg_leads_follow_up_changed. Used as the reminder recipient when assigned_rep_id IS NULL.';
COMMENT ON COLUMN public.leads.follow_up_email_last_sent_on IS
  'Date the most recent follow-up reminder email was sent for this lead. Reset to NULL when follow_up_date changes so a new email fires for the new date. Prevents the daily cron from double-sending.';


-- ─────────────────────────────────────────────────────────────
-- 2. Index for the cron worker
-- ─────────────────────────────────────────────────────────────
-- Partial index — only the actionable rows. Cron filters by
-- follow_up_date <= today AND non-terminal status; this index
-- covers the common path. Terminal statuses (converted, dead)
-- and soft-deleted rows fall out.
CREATE INDEX IF NOT EXISTS idx_leads_due_follow_up
  ON public.leads (follow_up_date)
  WHERE follow_up_date IS NOT NULL
    AND status NOT IN ('converted', 'dead')
    AND deleted_at IS NULL;


-- ─────────────────────────────────────────────────────────────
-- 3. Trigger — auto-stamp set_by + reset email-sent guard
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_lead_follow_up_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid UUID;
BEGIN
  -- Only act when follow_up_date is being set or actually changed.
  -- Avoids touching the stamp on every unrelated UPDATE (e.g.
  -- status flips, notes edits).
  IF (TG_OP = 'INSERT' AND NEW.follow_up_date IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND NEW.follow_up_date IS DISTINCT FROM OLD.follow_up_date)
  THEN
    -- Reset the email guard so a new email fires for the new
    -- date. (If the operator pushes the date forward, they want
    -- to be reminded on the new date — not have it suppressed
    -- because we already sent for the old date.)
    NEW.follow_up_email_last_sent_on := NULL;

    -- Stamp who did it — only if we can identify the actor.
    -- Service-role writes (cron, admin scripts) have no user
    -- context; in that case we leave the existing value alone
    -- so a programmatic backfill doesn't blow away an operator-
    -- set ownership.
    BEGIN
      uid := public.get_effective_user_id();
    EXCEPTION WHEN OTHERS THEN
      uid := NULL;
    END;
    IF uid IS NOT NULL THEN
      NEW.follow_up_set_by_user_id := uid;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_leads_follow_up_changed ON public.leads;
CREATE TRIGGER trg_leads_follow_up_changed
  BEFORE INSERT OR UPDATE ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_lead_follow_up_change();


-- ─────────────────────────────────────────────────────────────
-- 4. Backfill follow_up_set_by_user_id for existing rows
-- ─────────────────────────────────────────────────────────────
-- For leads that already have a follow_up_date set but no
-- set_by_user_id (because they predate the trigger), seed the
-- column from captured_by_user_id so the email cron has SOMEONE
-- to send to. captured_by is the second-best fallback — the
-- operator who entered the lead is most likely the same person
-- who set its follow-up date. If they're not, the lead can be
-- re-saved to refresh the stamp.
UPDATE public.leads
   SET follow_up_set_by_user_id = captured_by_user_id
 WHERE follow_up_date IS NOT NULL
   AND follow_up_set_by_user_id IS NULL
   AND captured_by_user_id IS NOT NULL
   AND status NOT IN ('converted', 'dead')
   AND deleted_at IS NULL;


-- ─────────────────────────────────────────────────────────────
-- 5. Done
-- ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  RAISE NOTICE 'leads follow-up notifications: columns + trigger + index installed; backfill complete.';
END $$;
