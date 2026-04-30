-- ============================================================
-- Defense-in-depth: prevent users with role='marketing' from
-- updating fields that belong to the Buyers/Approvers side of
-- the workflow on marketing_campaigns.
--
-- The existing RLS policy (`FOR ALL USING (has_marketing_access())`)
-- is intentionally broad so the marketing team can do their parts
-- of the workflow (planning submit, payment request, mark paid).
-- But it doesn't distinguish columns — so a marketing-role user
-- could PATCH marketing_budget directly, even though the UI hides
-- that control. This trigger closes that hole.
--
-- Buyer-only columns:
--   marketing_budget, budget_set_by, budget_set_at,
--   team_notified_at
--
-- Approver-only columns are guarded by the existing
-- `marketing_approvers.is_active` check at the API layer
-- (request-payment / authorize-payment / approve-planning /
-- approve-proof routes), so this trigger only covers the
-- buyer-side fields that have no API-route choke point.
--
-- Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION marketing_campaigns_block_buyer_fields_for_marketing_role()
RETURNS TRIGGER AS $$
DECLARE
  v_role TEXT;
BEGIN
  -- Resolve current actor's portal role
  SELECT u.role INTO v_role
    FROM public.users u
    JOIN auth.users au ON au.email = u.email
   WHERE au.id = auth.uid()
   LIMIT 1;

  -- Only restrict the marketing role. Buyer/admin/superadmin pass through.
  IF v_role IS DISTINCT FROM 'marketing' THEN
    RETURN NEW;
  END IF;

  IF NEW.marketing_budget IS DISTINCT FROM OLD.marketing_budget THEN
    RAISE EXCEPTION 'Marketing role cannot edit marketing_budget (Buyers-only field).';
  END IF;
  IF NEW.budget_set_by IS DISTINCT FROM OLD.budget_set_by THEN
    RAISE EXCEPTION 'Marketing role cannot edit budget_set_by (Buyers-only field).';
  END IF;
  IF NEW.budget_set_at IS DISTINCT FROM OLD.budget_set_at THEN
    RAISE EXCEPTION 'Marketing role cannot edit budget_set_at (Buyers-only field).';
  END IF;
  IF NEW.team_notified_at IS DISTINCT FROM OLD.team_notified_at THEN
    RAISE EXCEPTION 'Marketing role cannot edit team_notified_at (Buyers-only field).';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_marketing_campaigns_buyer_fields_guard ON public.marketing_campaigns;
CREATE TRIGGER trg_marketing_campaigns_buyer_fields_guard
  BEFORE UPDATE ON public.marketing_campaigns
  FOR EACH ROW
  EXECUTE FUNCTION marketing_campaigns_block_buyer_fields_for_marketing_role();

DO $$ BEGIN
  RAISE NOTICE 'Marketing role can no longer modify budget / team_notified fields on campaigns.';
END $$;
