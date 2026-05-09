-- ── users.preferences  (JSONB cross-device prefs blob)
--
-- Adds a single JSONB column for arbitrary per-user UI preferences
-- that don't deserve their own column. Updates are RLS-allowed via
-- the existing users_update self-row policy (set in the
-- tighten-permissive-policies migration), so the client can write
-- straight to it with supabase.from('users').update().
--
-- First consumer: Buying Events Hub view stores the array of
-- launcher button keys the user has hidden:
--   { "buying_events_hub_hidden_launchers": ["marketing", "ad_spend"] }
--
-- Safe to re-run.
-- ============================================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS preferences JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$ BEGIN
  RAISE NOTICE 'users.preferences (jsonb) installed.';
END $$;
