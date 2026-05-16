-- ============================================================
-- Buying Events: migrate users from the Legacy view to Hub
--
-- Context: BuyingEventsView used to default to 'legacy' when a user
-- had no saved preference. As of 2026-05-15 we flipped the default
-- to 'hub' and removed the Legacy chip from the view picker. Anyone
-- who explicitly set 'legacy' as their preference would, after the
-- code change, still land on Legacy but have no way to switch off
-- it from the UI — they'd be stuck.
--
-- This UPDATE bumps every user whose saved preference is 'legacy'
-- over to 'hub'. Users with NULL preference don't need updating —
-- the new code default ('hub') applies automatically.
--
-- The Legacy route handler in BuyingEventsView.tsx is intentionally
-- still present. We're holding out ~30 days (≈2026-06-15) before
-- deleting that code in case anyone needs to go back. The view just
-- isn't reachable from the UI.
--
-- Safe to re-run. Idempotent — the WHERE clause only matches rows
-- still on 'legacy'.
-- ============================================================

UPDATE public.users
   SET preferences = jsonb_set(
     COALESCE(preferences, '{}'::jsonb),
     '{buying_events_view}',
     '"hub"'::jsonb
   )
 WHERE preferences->>'buying_events_view' = 'legacy';

DO $$
DECLARE
  v_remaining INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_remaining
    FROM public.users
   WHERE preferences->>'buying_events_view' = 'legacy';
  RAISE NOTICE 'Legacy → Hub migration done. % users still on Legacy (should be 0).', v_remaining;
END $$;
