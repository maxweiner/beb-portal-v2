-- ── Pre-Event readiness overrides ────────────────────────────
-- Per-event manual "force green" toggles for the three readiness
-- chips that admins want to be able to bypass when reality is
-- handled outside the portal:
--
--   • travel    — buyer travel sometimes coordinated by phone /
--                 email rather than logged into Travel Share
--   • marketing — for events using a one-off marketing channel
--                 (or no marketing at all)
--   • assets    — events with no in-store assets needed
--
-- Buyers and Booking System chips are intentionally NOT
-- overrideable — those are hard prerequisites.
--
-- Setting an override timestamp forces the corresponding chip
-- green regardless of the underlying signal. NULL = no override
-- (chip uses its computed state). Each column also captures the
-- user who set it for audit, mirroring staff_briefed_at /
-- staff_briefed_by_user_id from PR 2.5a.
--
-- Safe to re-run.
-- ============================================================

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS travel_override_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS travel_override_by_user_id UUID
    REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS marketing_override_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS marketing_override_by_user_id UUID
    REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assets_override_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS assets_override_by_user_id UUID
    REFERENCES public.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.events.travel_override_at IS
  'When set, forces the Pre-Event ✈️ Travel readiness chip to green regardless of reservations / acks. Cleared = no override.';
COMMENT ON COLUMN public.events.marketing_override_at IS
  'When set, forces the Pre-Event 📣 Marketing readiness chip to green. Use for events with no marketing or a one-off channel.';
COMMENT ON COLUMN public.events.assets_override_at IS
  'When set, forces the Pre-Event 📦 In-store assets chip to green. Use for events with no physical asset orders required.';

DO $$ BEGIN
  RAISE NOTICE 'Readiness overrides installed: events.{travel,marketing,assets}_override_at + _by_user_id.';
END $$;
