-- ============================================================
-- Impersonation — HOTFIX for Phase 1 Auth Hook
--
-- Phase 1 migration referenced auth.users.app_metadata, but the
-- actual table column is raw_app_meta_data. (The JS auth-admin
-- client maps app_metadata → raw_app_meta_data on the way in,
-- but SQL has to use the real column name.)
--
-- Without this hotfix the hook errors with
--   "column app_metadata does not exist"
-- when the dashboard tries to mint a token, which prevents login
-- entirely. Apply this BEFORE wiring the hook in the dashboard.
--
-- Safe to re-run.
-- ============================================================

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

  SELECT raw_app_meta_data ->> 'impersonating_user_id',
         (raw_app_meta_data ->> 'impersonating_expires_at')::timestamptz
    INTO imp_id, imp_expiry
    FROM auth.users
    WHERE id = user_uuid;

  IF imp_id IS NOT NULL AND (imp_expiry IS NULL OR imp_expiry > now()) THEN
    claims := jsonb_set(claims, '{impersonating_user_id}', to_jsonb(imp_id));
  END IF;

  RETURN jsonb_build_object('claims', claims);
END;
$$;

GRANT EXECUTE ON FUNCTION public.impersonation_auth_hook(jsonb) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.impersonation_auth_hook(jsonb) FROM authenticated, anon, public;

DO $$ BEGIN
  RAISE NOTICE 'Auth Hook function fixed (raw_app_meta_data column). Now safe to wire in Dashboard.';
END $$;
