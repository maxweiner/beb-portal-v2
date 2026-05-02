-- ============================================================
-- Impersonation ("View As") — PHASE 1: server-side scaffolding
--
-- Single user — max@bebllp.com — gets a "View As" switcher to
-- experience the app as any other user. This phase lays the DB
-- foundation; the API routes and UI land in subsequent phases.
--
-- What this migration adds:
--
--   1. impersonation_sessions  — one row per active impersonation.
--      Hard-expires 4h after started_at (no inactivity tracking
--      to keep the session simple; if forgotten, hook checks
--      expires_at and stops injecting the claim). ended_at NULL
--      = currently active.
--
--   2. impersonation_log       — append-only audit trail of every
--      impersonation Max has done. Visible to him in his own
--      review page (Phase 5). Outlives session rows.
--
--   3. get_effective_user_id() — RLS helper. Returns the JWT's
--      impersonating_user_id claim if present, else falls back
--      to the user resolved by email. Use this in any new RLS
--      policy that gates on user identity.
--
--   4. get_my_role() — REPLACED to call get_effective_user_id().
--      Every existing policy using get_my_role() inherits
--      impersonation behavior for free.
--
--   5. impersonation_auth_hook(event jsonb) — Custom Access
--      Token Auth Hook. Reads auth.users.app_metadata and
--      injects the impersonating_user_id claim into the minted
--      JWT (only when the impersonation hasn't expired).
--
-- POST-MIGRATION MANUAL STEP (one-time):
--
--   In Supabase Dashboard → Authentication → Hooks → "Custom
--   Access Token (Auth)" hook, point it at:
--       public.impersonation_auth_hook
--   Until that's wired up, calling /api/impersonation/start will
--   write app_metadata, but the JWT won't carry the claim, and
--   RLS won't honor impersonation. (The server-side restriction
--   gate will still detect impersonation via the session row.)
--
-- KNOWN GAP — Phase 1.5 follow-up:
--
--   RLS policies that look users up by email directly (pattern
--   `WHERE u.email = auth.jwt()->>'email'`) do NOT auto-honor
--   impersonation. They need to be patched to use
--   get_effective_user_id() instead. Audit + patch in a follow-up
--   once the basic infra is verified end-to-end.
--
-- HARDCODED ACTOR — max@bebllp.com only:
--
--   Enforcement of "only Max can impersonate" lives in the API
--   route layer, not this migration. The hook itself is generic
--   so it doesn't have to be re-deployed if Max's user-row id
--   ever changes (e.g., re-invite).
--
-- Safe to re-run.
-- ============================================================

-- ── 1. impersonation_sessions ──────────────────────────────────

CREATE TABLE IF NOT EXISTS public.impersonation_sessions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  target_id   uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  started_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT now() + interval '4 hours',
  ended_at    timestamptz NULL,
  CONSTRAINT impersonation_sessions_distinct CHECK (actor_id <> target_id)
);

-- Lookup: "is there an active impersonation for this actor right now?"
CREATE INDEX IF NOT EXISTS idx_impersonation_sessions_active
  ON public.impersonation_sessions (actor_id)
  WHERE ended_at IS NULL;

ALTER TABLE public.impersonation_sessions ENABLE ROW LEVEL SECURITY;

-- Read: only the actor sees his own sessions. Use the *real* user
-- id here (auth.jwt()->>'email' lookup, not get_effective_user_id)
-- so that an impersonated session doesn't accidentally hide
-- Max's own session list from him.
DROP POLICY IF EXISTS impersonation_sessions_self_read ON public.impersonation_sessions;
CREATE POLICY impersonation_sessions_self_read ON public.impersonation_sessions
  FOR SELECT TO authenticated
  USING (
    actor_id = (
      SELECT id FROM public.users
      WHERE lower(email) = lower(auth.jwt()->>'email')
      LIMIT 1
    )
  );

-- No INSERT / UPDATE / DELETE policies — service role manages writes.

-- ── 2. impersonation_log ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.impersonation_log (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  target_id   uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  started_at  timestamptz NOT NULL DEFAULT now(),
  ended_at    timestamptz NULL,
  ip_address  inet        NULL
);

CREATE INDEX IF NOT EXISTS idx_impersonation_log_actor
  ON public.impersonation_log (actor_id, started_at DESC);

ALTER TABLE public.impersonation_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS impersonation_log_self_read ON public.impersonation_log;
CREATE POLICY impersonation_log_self_read ON public.impersonation_log
  FOR SELECT TO authenticated
  USING (
    actor_id = (
      SELECT id FROM public.users
      WHERE lower(email) = lower(auth.jwt()->>'email')
      LIMIT 1
    )
  );

-- ── 3. get_effective_user_id() ─────────────────────────────────
-- Returns the user id that RLS should treat as the current user.
-- Honors impersonation: if the JWT has impersonating_user_id,
-- return that (already validated as an extant user by the hook).
-- Otherwise resolve the user by email like before.

CREATE OR REPLACE FUNCTION public.get_effective_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    NULLIF(auth.jwt() ->> 'impersonating_user_id', '')::uuid,
    (
      SELECT id FROM public.users
      WHERE lower(email) = lower(auth.jwt() ->> 'email')
      LIMIT 1
    )
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_effective_user_id() TO authenticated, anon;

-- ── 4. get_my_role() — replaced to use effective id ────────────
-- Existing definition resolved by email. New definition resolves
-- by get_effective_user_id() so all role-gated policies inherit
-- impersonation transparently.

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT role
  FROM public.users
  WHERE id = public.get_effective_user_id()
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_role() TO authenticated, anon;

-- ── 5. Auth Hook function ──────────────────────────────────────
-- Supabase calls this with `event` shaped like:
--   {
--     "user_id": "<uuid>",
--     "claims": { ...standard claims... },
--     ...
--   }
-- We return { "claims": <updated> }. The hook must return ALL
-- claims (Supabase replaces, doesn't merge), so we mutate-and-
-- return.

CREATE OR REPLACE FUNCTION public.impersonation_auth_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  claims     jsonb;
  imp_id     text;
  imp_expiry timestamptz;
  user_uuid  uuid;
BEGIN
  claims := COALESCE(event -> 'claims', '{}'::jsonb);
  user_uuid := (event ->> 'user_id')::uuid;

  -- Pull the in-band impersonation marker the API writes to
  -- auth.users.app_metadata when starting a session.
  SELECT app_metadata ->> 'impersonating_user_id',
         (app_metadata ->> 'impersonating_expires_at')::timestamptz
    INTO imp_id, imp_expiry
    FROM auth.users
    WHERE id = user_uuid;

  -- Inject only if non-null and not expired. Expired tokens are
  -- ignored so a forgotten session quietly stops working without
  -- needing a cron sweep.
  IF imp_id IS NOT NULL AND (imp_expiry IS NULL OR imp_expiry > now()) THEN
    claims := jsonb_set(claims, '{impersonating_user_id}', to_jsonb(imp_id));
  END IF;

  RETURN jsonb_build_object('claims', claims);
END;
$$;

-- Auth Hooks are invoked by the supabase_auth_admin role.
GRANT EXECUTE ON FUNCTION public.impersonation_auth_hook(jsonb) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.impersonation_auth_hook(jsonb) FROM authenticated, anon, public;

-- The hook needs to read auth.users.app_metadata. Service role
-- bypasses RLS; supabase_auth_admin already has access. No extra
-- grants needed.

DO $$ BEGIN
  RAISE NOTICE 'Impersonation Phase 1 schema installed. Remember to wire impersonation_auth_hook in Dashboard → Auth → Hooks (Custom Access Token).';
END $$;
