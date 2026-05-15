-- ============================================================
-- SMS opt-in: explicit per-row consent flag
--
-- Adds sms_opted_in BOOLEAN to every table where the public collects
-- a phone number through a form that surfaces an SMS consent
-- checkbox. Twilio rejected our toll-free verification (third pass)
-- with codes 30475 + 30498 + 30513 — all rooted in implicit
-- "by-providing-your-number-you-agree" consent. We're switching to
-- explicit, optional, standalone checkbox consent + storing the
-- per-record opt-in so SMS dispatch can gate on it.
--
-- Tables:
--   appointments              — customer-facing appointment booking
--   event_waitlist    — public waitlist signup
--   trade_show_appointments   — trade-show slot booking (token URL)
--   trunk_show_slot_bookings  — trunk-show slot booking (token URL)
--
-- Default FALSE — the new checkbox is unchecked by default; nobody
-- gets enrolled in SMS unless they explicitly opt in. Backfilling
-- pre-existing rows to FALSE means historical bookings stop
-- receiving SMS too, which is the legally-safe state (we can't
-- prove they opted in under the new flow).
--
-- Safe to re-run. Idempotent.
-- ============================================================

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS sms_opted_in BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.event_waitlist
  ADD COLUMN IF NOT EXISTS sms_opted_in BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.trade_show_appointments
  ADD COLUMN IF NOT EXISTS sms_opted_in BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.trunk_show_slot_bookings
  ADD COLUMN IF NOT EXISTS sms_opted_in BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.appointments.sms_opted_in IS
  'Did the customer explicitly check the SMS opt-in checkbox at booking? Twilio toll-free verification requires opt-in to be optional, standalone, and unchecked-by-default. SMS dispatch (lib/appointments/notifications.ts) ONLY texts numbers where this is TRUE.';
COMMENT ON COLUMN public.event_waitlist.sms_opted_in IS
  'Did the waitlist signup explicitly check the SMS opt-in checkbox? Twilio toll-free verification requires opt-in to be optional, standalone, and unchecked-by-default.';
COMMENT ON COLUMN public.trade_show_appointments.sms_opted_in IS
  'Did the trade-show appointment booking explicitly check the SMS opt-in checkbox? Twilio toll-free verification requires opt-in to be optional, standalone, and unchecked-by-default.';
COMMENT ON COLUMN public.trunk_show_slot_bookings.sms_opted_in IS
  'Did the trunk-show slot booking explicitly check the SMS opt-in checkbox? Twilio toll-free verification requires opt-in to be optional, standalone, and unchecked-by-default.';

DO $$ BEGIN
  RAISE NOTICE 'sms_opted_in columns installed on appointments / waitlist / trade-show / trunk-show booking tables. SMS dispatch gates on this flag from now on.';
END $$;
