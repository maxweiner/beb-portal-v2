-- ============================================================
-- Intake → Purchase, Phase 1
--
-- Adds the schema that the photo-first intake flow needs:
--   • New columns on customer_intakes for buy-form #, purchase $,
--     check #, commission %, photos beyond the front, processing
--     state (used by Phase 2's background worker).
--   • intake_photos — 0..5 jewelry photos per intake.
--   • intake_audit_log — every create/update logged for the
--     3-day-edit-lock + audit trail (Phase 8).
--
-- Phase 1 has NO background worker — every new row is saved with
-- processing_state = 'parsed' (manually entered fields are the
-- source of truth). Phase 2 will flip the default to 'processing'
-- and start the worker.
--
-- Spec: docs/intake-purchase-spec.md
-- Safe to re-run.
-- ============================================================

-- ── customer_intakes new columns ────────────────────────────

ALTER TABLE public.customer_intakes
  ADD COLUMN IF NOT EXISTS buy_form_number          text,
  ADD COLUMN IF NOT EXISTS check_number             text,
  ADD COLUMN IF NOT EXISTS purchase_amount          numeric(12, 2),
  ADD COLUMN IF NOT EXISTS commission_pct           numeric(4, 2)  DEFAULT 10.00,
  ADD COLUMN IF NOT EXISTS commission_bucket        text           DEFAULT 'rate_10',
  ADD COLUMN IF NOT EXISTS customer_id              uuid           REFERENCES public.customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS appointment_id           uuid           REFERENCES public.appointments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS intake_kind              text           DEFAULT 'purchase',
  ADD COLUMN IF NOT EXISTS phone                    text,
  ADD COLUMN IF NOT EXISTS email                    text,
  ADD COLUMN IF NOT EXISTS back_photo_url           text,
  ADD COLUMN IF NOT EXISTS invoice_photo_url        text,
  ADD COLUMN IF NOT EXISTS processing_state         text           DEFAULT 'parsed',
  ADD COLUMN IF NOT EXISTS processing_started_at    timestamptz,
  ADD COLUMN IF NOT EXISTS processed_at             timestamptz,
  ADD COLUMN IF NOT EXISTS parse_error_message      text,
  ADD COLUMN IF NOT EXISTS submitted_to_day_entry_at timestamptz;

-- Domain checks. Drop-then-add so re-runs pick up new constraint
-- definitions cleanly.

ALTER TABLE public.customer_intakes
  DROP CONSTRAINT IF EXISTS customer_intakes_commission_bucket_chk;
ALTER TABLE public.customer_intakes
  ADD  CONSTRAINT customer_intakes_commission_bucket_chk
       CHECK (commission_bucket IN ('rate_10', 'rate_5', 'rate_0', 'store'));

ALTER TABLE public.customer_intakes
  DROP CONSTRAINT IF EXISTS customer_intakes_intake_kind_chk;
ALTER TABLE public.customer_intakes
  ADD  CONSTRAINT customer_intakes_intake_kind_chk
       CHECK (intake_kind IN ('check_in', 'purchase', 'check_in_then_purchase'));

ALTER TABLE public.customer_intakes
  DROP CONSTRAINT IF EXISTS customer_intakes_processing_state_chk;
ALTER TABLE public.customer_intakes
  ADD  CONSTRAINT customer_intakes_processing_state_chk
       CHECK (processing_state IN ('processing', 'parsed', 'parse_failed'));

-- Buy form # is globally unique forever (pre-printed pads, voided
-- = burned). Partial index because check-in-only rows have no form #.
CREATE UNIQUE INDEX IF NOT EXISTS customer_intakes_buy_form_number_uniq
  ON public.customer_intakes (buy_form_number)
  WHERE buy_form_number IS NOT NULL;

-- Lookup-tool indexes. Phone/email/check# get their own so the
-- buy-form lookup tool (Phase 6) doesn't seq-scan.
CREATE INDEX IF NOT EXISTS customer_intakes_phone_idx
  ON public.customer_intakes (phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS customer_intakes_email_idx
  ON public.customer_intakes (lower(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS customer_intakes_check_number_idx
  ON public.customer_intakes (check_number) WHERE check_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS customer_intakes_customer_idx
  ON public.customer_intakes (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS customer_intakes_appointment_idx
  ON public.customer_intakes (appointment_id) WHERE appointment_id IS NOT NULL;

-- ── intake_photos (jewelry, 0..5 per intake) ────────────────

CREATE TABLE IF NOT EXISTS public.intake_photos (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  intake_id   uuid        NOT NULL REFERENCES public.customer_intakes(id) ON DELETE CASCADE,
  photo_url   text        NOT NULL,
  sort_order  int         NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS intake_photos_intake_idx
  ON public.intake_photos (intake_id);

ALTER TABLE public.intake_photos ENABLE ROW LEVEL SECURITY;

-- Row visibility mirrors the parent intake:
--   • the buyer who created it
--   • admin / superadmin / partner
DROP POLICY IF EXISTS intake_photos_select ON public.intake_photos;
CREATE POLICY intake_photos_select ON public.intake_photos
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.customer_intakes ci
      WHERE ci.id = intake_photos.intake_id
        AND (
          ci.buyer_id = public.get_effective_user_id()
          OR public.has_any_role('admin', 'superadmin')
          OR public.is_my_partner()
        )
    )
  );

DROP POLICY IF EXISTS intake_photos_insert ON public.intake_photos;
CREATE POLICY intake_photos_insert ON public.intake_photos
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.customer_intakes ci
      WHERE ci.id = intake_photos.intake_id
        AND (
          ci.buyer_id = public.get_effective_user_id()
          OR public.has_any_role('admin', 'superadmin')
          OR public.is_my_partner()
        )
    )
  );

DROP POLICY IF EXISTS intake_photos_delete ON public.intake_photos;
CREATE POLICY intake_photos_delete ON public.intake_photos
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.customer_intakes ci
      WHERE ci.id = intake_photos.intake_id
        AND (
          ci.buyer_id = public.get_effective_user_id()
          OR public.has_any_role('admin', 'superadmin')
          OR public.is_my_partner()
        )
    )
  );

-- ── intake_audit_log ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.intake_audit_log (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  intake_id       uuid        NOT NULL REFERENCES public.customer_intakes(id) ON DELETE CASCADE,
  actor_user_id   uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  action          text        NOT NULL,
  changed_fields  jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS intake_audit_log_intake_idx
  ON public.intake_audit_log (intake_id);
CREATE INDEX IF NOT EXISTS intake_audit_log_actor_idx
  ON public.intake_audit_log (actor_user_id);

ALTER TABLE public.intake_audit_log ENABLE ROW LEVEL SECURITY;

-- Audit-log visibility: anyone who can read the intake can read its log;
-- only superadmins should be able to delete (we only insert in code).
DROP POLICY IF EXISTS intake_audit_log_select ON public.intake_audit_log;
CREATE POLICY intake_audit_log_select ON public.intake_audit_log
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.customer_intakes ci
      WHERE ci.id = intake_audit_log.intake_id
        AND (
          ci.buyer_id = public.get_effective_user_id()
          OR public.has_any_role('admin', 'superadmin')
          OR public.is_my_partner()
        )
    )
  );

DROP POLICY IF EXISTS intake_audit_log_insert ON public.intake_audit_log;
CREATE POLICY intake_audit_log_insert ON public.intake_audit_log
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.customer_intakes ci
      WHERE ci.id = intake_audit_log.intake_id
        AND (
          ci.buyer_id = public.get_effective_user_id()
          OR public.has_any_role('admin', 'superadmin')
          OR public.is_my_partner()
        )
    )
  );

DO $$ BEGIN
  RAISE NOTICE 'Intake → Purchase Phase 1 schema installed.';
END $$;
