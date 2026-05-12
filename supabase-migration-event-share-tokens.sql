-- ============================================================
-- Event Share Tokens — public dashboard at /e/[token]
--
-- The store-owner-facing public event dashboard (live KPIs +
-- appointments + buyer roster + today's buys + waitlist) is reached
-- via an unguessable per-event token. Staff mint the token from the
-- internal event view, send the URL to the store owner via SMS/email,
-- and can rotate or revoke it if it leaks.
--
-- Distinct from `store_portal_tokens` (which gates the booking
-- surface used by store EMPLOYEES) — different audience, different
-- read-only scope. Store owners get this token; employees keep using
-- the store portal token.
--
-- Schema changes
-- --------------
-- 1. NEW TABLE `event_share_tokens`
-- 2. `buyer_checks.commission_note` — captured at the check register
--    when the user picks 5% or 0% (override reason). Renders under
--    the customer on the public dashboard.
-- 3. `buyer_checks.customer_name` — denormalized so the dashboard
--    can show whose buy each check belongs to without a fragile
--    join. Optional; legacy rows stay NULL.
-- 4. `buyer_checks.buyer_id` — which BEB buyer recorded the check.
--    Drives the Buyer initials column on the dashboard. Optional;
--    legacy rows stay NULL.
--
-- Idempotent. Safe to re-run.
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. event_share_tokens table
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.event_share_tokens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  -- ~24-char URL-safe random string. App-minted so we don't depend
  -- on pgcrypto for the slug; just a UNIQUE constraint here.
  token           TEXT NOT NULL UNIQUE,
  created_by      UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_by_email TEXT,                    -- frozen so deleted users don't blank
  -- Revocation: set non-null to kill the URL without deleting the row
  -- (audit + the ability to see "this used to be active").
  revoked_at      TIMESTAMPTZ,
  revoked_reason  TEXT,
  -- Tracking
  first_viewed_at TIMESTAMPTZ,
  last_viewed_at  TIMESTAMPTZ,
  view_count      INTEGER NOT NULL DEFAULT 0,
  -- Last time we texted/emailed the URL to the store (so the staff
  -- view can show "sent 2 hours ago").
  last_sent_at    TIMESTAMPTZ,
  last_sent_to    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One active token per event (you can rotate; the old one becomes
-- revoked, the new one becomes the active one).
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_share_tokens_one_active
  ON public.event_share_tokens (event_id)
  WHERE revoked_at IS NULL;

-- Fast lookup by token (the public route hits this on every page load).
CREATE INDEX IF NOT EXISTS idx_event_share_tokens_lookup
  ON public.event_share_tokens (token)
  WHERE revoked_at IS NULL;

-- Listing in the staff event view (most recent first).
CREATE INDEX IF NOT EXISTS idx_event_share_tokens_event_created
  ON public.event_share_tokens (event_id, created_at DESC);


-- ─────────────────────────────────────────────────────────────
-- 2. buyer_checks columns (commission_note, customer_name, buyer_id)
-- ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF to_regclass('public.buyer_checks') IS NULL THEN
    RAISE NOTICE 'skip buyer_checks alters (table missing)';
    RETURN;
  END IF;

  -- 2a. commission_note — the "why we picked 5% or 0%" string from
  --     the check register input.
  BEGIN
    ALTER TABLE public.buyer_checks
      ADD COLUMN IF NOT EXISTS commission_note TEXT;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'buyer_checks.commission_note add skipped: %', SQLERRM;
  END;

  -- 2b. customer_name — denormalized so the dashboard's buys table
  --     can show whose buy each check belongs to. Optional; populated
  --     by the check register going forward.
  BEGIN
    ALTER TABLE public.buyer_checks
      ADD COLUMN IF NOT EXISTS customer_name TEXT;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'buyer_checks.customer_name add skipped: %', SQLERRM;
  END;

  -- 2c. buyer_id — which BEB buyer recorded the check (drives the
  --     buyer-initials column on the dashboard).
  BEGIN
    ALTER TABLE public.buyer_checks
      ADD COLUMN IF NOT EXISTS buyer_id UUID
        REFERENCES public.users(id) ON DELETE SET NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'buyer_checks.buyer_id add skipped: %', SQLERRM;
  END;

  -- Index buyer_id for "show this buyer's checks" lookups.
  BEGIN
    CREATE INDEX IF NOT EXISTS idx_buyer_checks_buyer
      ON public.buyer_checks (buyer_id, event_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'buyer_checks.buyer index skipped: %', SQLERRM;
  END;
END $$;


-- ─────────────────────────────────────────────────────────────
-- 3. RLS — event_share_tokens
-- ─────────────────────────────────────────────────────────────
--
-- Staff (admin / superadmin / partner) read+write. Public dashboard
-- reads with the service-role client (mirrors how /edge/[token] and
-- /store-portal/[token] work) so no public-anon policy is needed.
ALTER TABLE public.event_share_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS event_share_tokens_read ON public.event_share_tokens;
CREATE POLICY event_share_tokens_read
  ON public.event_share_tokens FOR SELECT TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
  );

DROP POLICY IF EXISTS event_share_tokens_write ON public.event_share_tokens;
CREATE POLICY event_share_tokens_write
  ON public.event_share_tokens FOR ALL TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
  )
  WITH CHECK (
    public.has_any_role('admin', 'superadmin')
    OR public.is_my_partner()
  );


-- ─────────────────────────────────────────────────────────────
-- 4. updated_at touch trigger on event_share_tokens
-- ─────────────────────────────────────────────────────────────
--
-- Reuse the existing wholesale_touch_updated_at() helper from the
-- wholesale schema migration (already defined in this DB).
DO $$ BEGIN
  IF to_regprocedure('public.wholesale_touch_updated_at()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_event_share_tokens_touch ON public.event_share_tokens;
    CREATE TRIGGER trg_event_share_tokens_touch
      BEFORE UPDATE ON public.event_share_tokens
      FOR EACH ROW EXECUTE FUNCTION public.wholesale_touch_updated_at();
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  RAISE NOTICE 'event_share_tokens table + buyer_checks (commission_note/customer_name/buyer_id) columns ready.';
END $$;
