-- ── Mark event as "ignored" for the marketing module ────────
-- Adds events.marketing_ignored_at — set when an admin/partner
-- decides this event isn't getting a marketing campaign.
--
-- Scope: marketing module only. The flag affects the New Campaign
-- modal's event picker (and any future "events needing a campaign"
-- surface). It does NOT affect:
--   • the buying calendar / event list
--   • the Daily Briefing email
--   • reports, financials, or event detail
--
-- This is intentionally weaker than cancellation — a cancelled
-- event also pauses campaigns and cascades; ignoring is a
-- pure UI filter.
--
-- Safe to re-run.
-- ============================================================

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS marketing_ignored_at TIMESTAMPTZ;

COMMENT ON COLUMN public.events.marketing_ignored_at IS
  'When an admin/partner marked this event as not getting a marketing campaign. NULL = active. Affects only the marketing module (hides the event from the New Campaign picker). Does not affect any other surface.';

DO $$ BEGIN
  RAISE NOTICE 'events.marketing_ignored_at column installed.';
END $$;
