-- ============================================================
-- White Sheet OCR — PHASE 1: schema + storage bucket + RLS
--
-- Plumbing only. Builds the three tables that the upload + worker
-- pipeline will write to in subsequent phases, the private storage
-- bucket that holds source PDFs + per-page PNGs, the new
-- customer_dedup_source enum value, the brand-scoped Settings row
-- for the "Review every page" admin toggle, and the AFTER INSERT
-- trigger on buyer_checks that auto-relinks orphan white_sheet_pages
-- when a forgotten Day Entry row gets added later.
--
-- No UI in this PR. No worker. No OCR. Phases 2-9 layer on top.
--
-- Spec: docs/white-sheet-ocr-spec.md
-- Safe to re-run. Every CREATE / ALTER is idempotent; the relink
-- trigger drop+create is unconditional.
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. customer_dedup_source += 'white_sheet_upload'
-- ─────────────────────────────────────────────────────────────
-- Used by Phase 3 when the OCR worker creates a customers row from a
-- confirmed white sheet. Lets future audit/dedup tooling identify
-- which records came from this pipeline vs. import / appointment /
-- manual entry.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'customer_dedup_source'
      AND e.enumlabel = 'white_sheet_upload'
  ) THEN
    ALTER TYPE customer_dedup_source ADD VALUE 'white_sheet_upload';
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────
-- 2. Private storage bucket: white-sheets
-- ─────────────────────────────────────────────────────────────
-- Holds:
--   - source PDFs at white-sheets/{brand}/{event_id}/{upload_id}/source.pdf
--   - per-page PNGs at white-sheets/{brand}/{event_id}/{upload_id}/page-{n}.png
--   - cropped buyer-initials samples for the user_signature_samples
--     library
--
-- Private; all access goes through Supabase Storage signed-URL +
-- server routes that use the service role. Direct authenticated
-- access is gated by the storage.objects policies below.
INSERT INTO storage.buckets (id, name, public)
VALUES ('white-sheets', 'white-sheets', false)
ON CONFLICT (id) DO NOTHING;


-- ─────────────────────────────────────────────────────────────
-- 3. storage.objects policies for the white-sheets bucket
-- ─────────────────────────────────────────────────────────────
-- All-hands access: every internal role can upload + read + delete.
-- We deliberately gate via has_any_role() rather than touching
-- auth.users — per the 2026-05-13 migration that fixed the
-- FOR-ALL parse-time auth.users trap, joining auth.users in a
-- FOR-ALL WITH CHECK breaks every storage write regardless of
-- bucket. Stay with the helper.
--
-- 'pending' and 'marketing_partner' are NOT in the role list:
--   - pending users haven't been onboarded
--   - marketing_partner is the external Collected Concepts role
--     and shouldn't see buying-side compliance scans.

DROP POLICY IF EXISTS white_sheets_storage_all ON storage.objects;
CREATE POLICY white_sheets_storage_all ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id = 'white-sheets'
    AND public.has_any_role(
      'admin', 'superadmin', 'buyer', 'accounting',
      'sales_rep', 'trunk_admin', 'marketing'
    )
  )
  WITH CHECK (
    bucket_id = 'white-sheets'
    AND public.has_any_role(
      'admin', 'superadmin', 'buyer', 'accounting',
      'sales_rep', 'trunk_admin', 'marketing'
    )
  );


-- ─────────────────────────────────────────────────────────────
-- 4. white_sheet_uploads
-- ─────────────────────────────────────────────────────────────
-- One row per uploaded PDF. Tracks upload-level status + running
-- counts so the Hub launcher card can show progress without
-- having to aggregate the per-page rows on every refresh.
CREATE TABLE IF NOT EXISTS public.white_sheet_uploads (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id                 UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  brand                    TEXT NOT NULL,
  uploaded_by_user_id      UUID REFERENCES public.users(id) ON DELETE SET NULL,
  source_pdf_path          TEXT NOT NULL,
  original_filename        TEXT,

  pages_total              INT NOT NULL DEFAULT 0,
  pages_auto_committed     INT NOT NULL DEFAULT 0,
  pages_in_review          INT NOT NULL DEFAULT 0,
  pages_errored            INT NOT NULL DEFAULT 0,

  -- status flow: splitting → processing → complete
  -- (Phase 2 sets splitting/processing; Phase 3 flips to complete
  --  when the last page settles.)
  status                   TEXT NOT NULL DEFAULT 'splitting'
                           CHECK (status IN ('splitting', 'processing', 'complete')),

  -- Running sum of per-page Anthropic API cost (in cents). Lets
  -- Settings panel show a 30-day rolling spend for monitoring.
  estimated_cost_cents     INT NOT NULL DEFAULT 0,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at             TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_white_sheet_uploads_event
  ON public.white_sheet_uploads(event_id);
CREATE INDEX IF NOT EXISTS idx_white_sheet_uploads_brand_status
  ON public.white_sheet_uploads(brand, status);
CREATE INDEX IF NOT EXISTS idx_white_sheet_uploads_uploader
  ON public.white_sheet_uploads(uploaded_by_user_id);

COMMENT ON TABLE public.white_sheet_uploads IS
  'One row per uploaded PDF. Header for a set of white_sheet_pages. The Hub launcher card reads from here for live progress and completion summaries.';
COMMENT ON COLUMN public.white_sheet_uploads.estimated_cost_cents IS
  'Running sum of per-page Anthropic Vision API spend, in cents. Aggregated from white_sheet_pages by the worker as each page settles.';


-- ─────────────────────────────────────────────────────────────
-- 5. white_sheet_pages
-- ─────────────────────────────────────────────────────────────
-- One row per page of the source PDF. Per-page status drives the
-- review pile + auto-commit flow.
CREATE TABLE IF NOT EXISTS public.white_sheet_pages (
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id                       UUID NOT NULL REFERENCES public.white_sheet_uploads(id) ON DELETE CASCADE,
  -- Denormalized so the per-event review pile can index without a
  -- two-hop join through white_sheet_uploads. Trigger keeps this
  -- in sync (Phase 2; for now we just rely on inserts setting it
  -- correctly).
  event_id                        UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  page_number                     INT  NOT NULL,
  image_path                      TEXT,

  status                          TEXT NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending', 'processing', 'auto_committed', 'needs_review', 'errored')),
  -- One reason badge per check that failed. Examples:
  --   'unmatched_form'           — buy_form_number_ocr has no matching buyer_checks row
  --   'amount_mismatch'          — OCR'd $ disagrees with entered amount
  --   'check_mismatch'           — OCR'd check # disagrees with entered check_number
  --   'low_confidence_phone'     — could not parse 10 digits
  --   'initials_ambiguous'       — buyer-initials classifier returned a close call
  --   'initials_pending'         — Phase 5 not yet run for this page
  -- New reasons can be added without a migration; the UI labels them
  -- via a TS lookup so unknown values render as the raw key.
  review_reasons                  TEXT[] NOT NULL DEFAULT '{}',

  ocr_raw                         JSONB,
  buy_form_number_ocr             TEXT,
  check_number_ocr                TEXT,
  amount_ocr                      NUMERIC(12, 2),

  buyer_check_id                  UUID REFERENCES public.buyer_checks(id) ON DELETE SET NULL,
  customer_id                     UUID REFERENCES public.customers(id) ON DELETE SET NULL,

  buyer_user_id                   UUID REFERENCES public.users(id) ON DELETE SET NULL,
  initials_classifier_confidence  NUMERIC(4, 3),
  initials_crop_path              TEXT,

  -- DL # / ID number — stays ONLY on this row, never copied to
  -- customers (per the spec's PII isolation decision).
  id_number_raw                   TEXT,
  items_raw                       TEXT,

  attempts                        INT NOT NULL DEFAULT 0,
  last_error                      TEXT,
  processed_at                    TIMESTAMPTZ NULL,

  reviewed_by_user_id             UUID REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_at                     TIMESTAMPTZ NULL,

  created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (upload_id, page_number)
);

CREATE INDEX IF NOT EXISTS idx_white_sheet_pages_upload
  ON public.white_sheet_pages(upload_id);
CREATE INDEX IF NOT EXISTS idx_white_sheet_pages_event_status
  ON public.white_sheet_pages(event_id, status);
-- The auto-relink trigger looks up orphan pages by
-- (event_id, buy_form_number_ocr) when a new buyer_checks row is
-- inserted. Partial index — only the rows that need to be matched.
CREATE INDEX IF NOT EXISTS idx_white_sheet_pages_relink_lookup
  ON public.white_sheet_pages(event_id, buy_form_number_ocr)
  WHERE status = 'needs_review' AND buyer_check_id IS NULL;
-- The worker claims pending rows; partial index keeps drains fast.
CREATE INDEX IF NOT EXISTS idx_white_sheet_pages_pending
  ON public.white_sheet_pages(created_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_white_sheet_pages_buyer_check
  ON public.white_sheet_pages(buyer_check_id);
CREATE INDEX IF NOT EXISTS idx_white_sheet_pages_customer
  ON public.white_sheet_pages(customer_id);

COMMENT ON TABLE public.white_sheet_pages IS
  'One row per page of a white_sheet_uploads PDF. Per-page status drives the auto-commit vs. review-pile flow. ocr_raw is the full Claude vision response for debugging / re-running classification.';
COMMENT ON COLUMN public.white_sheet_pages.review_reasons IS
  'Array of soft flags explaining why the page needs review. The page lands in the review pile if length(review_reasons) > 0 OR status = ''errored''. Auto-commit only when this is empty AND all 5 obvious-clean checks pass.';
COMMENT ON COLUMN public.white_sheet_pages.id_number_raw IS
  'Driver''s license / ID number from the form. Compliance paper trail — intentionally NOT copied to customers.id_number; PII isolation per spec.';


-- ─────────────────────────────────────────────────────────────
-- 6. user_signature_samples
-- ─────────────────────────────────────────────────────────────
-- Reference library for the closed-set buyer-initials classifier.
-- Bootstraps from operator-confirmed pages in the review pile —
-- no Settings training UI. Each confirmed page contributes its
-- initials_crop_path image as a new row here for the matched
-- buyer.
CREATE TABLE IF NOT EXISTS public.user_signature_samples (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  image_path      TEXT NOT NULL,
  source_page_id  UUID REFERENCES public.white_sheet_pages(id) ON DELETE SET NULL,
  -- Lets an admin retire a sample that turned out to be a
  -- misclassification (e.g., operator picked the wrong buyer in the
  -- review pile, the bad crop ended up in the library, now misleads
  -- future classifications). Soft-delete instead of hard delete so
  -- we can audit which samples were retired.
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Classifier pulls active samples by user; partial index covers
-- the hot path.
CREATE INDEX IF NOT EXISTS idx_user_signature_samples_active
  ON public.user_signature_samples(user_id)
  WHERE is_active = TRUE;

COMMENT ON TABLE public.user_signature_samples IS
  'Per-user buyer-initials reference library. Populated by operator confirmations in the white-sheet review pile (Phase 5). Used by the closed-set classifier as few-shot vision anchors when identifying which assigned buyer initialed a page.';


-- ─────────────────────────────────────────────────────────────
-- 7. RLS — permissive at the table level
-- ─────────────────────────────────────────────────────────────
-- Mirrors the existing buyer_checks / event_days RLS pattern.
-- App-level role gating (the Hub launcher visibility + review-pile
-- guards) does the work; the DB stays permissive for authenticated
-- users. The marketing_partner / pending exclusion happens
-- exclusively at the UI layer — those users don't have access to
-- the launcher in the first place.

ALTER TABLE public.white_sheet_uploads      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.white_sheet_pages        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_signature_samples   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS white_sheet_uploads_all ON public.white_sheet_uploads;
CREATE POLICY white_sheet_uploads_all ON public.white_sheet_uploads
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS white_sheet_pages_all ON public.white_sheet_pages;
CREATE POLICY white_sheet_pages_all ON public.white_sheet_pages
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS user_signature_samples_all ON public.user_signature_samples;
CREATE POLICY user_signature_samples_all ON public.user_signature_samples
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ─────────────────────────────────────────────────────────────
-- 8. Settings row for the brand-scoped admin toggle
-- ─────────────────────────────────────────────────────────────
-- key:   white_sheets.review_every_page
-- value: { beb: false, liberty: false }
--
-- Defaults off so the auto-commit flow is the day-1 experience.
-- Admin/superadmin toggle in Settings → White Sheet Upload
-- (Phase 7). When true for a brand, every page lands in the review
-- pile regardless of the 5-check criteria — useful for stress-
-- testing a new model version.
INSERT INTO public.settings (key, value)
SELECT 'white_sheets.review_every_page', jsonb_build_object('beb', false, 'liberty', false)
WHERE NOT EXISTS (
  SELECT 1 FROM public.settings WHERE key = 'white_sheets.review_every_page'
);


-- ─────────────────────────────────────────────────────────────
-- 9. Auto-relink trigger — AFTER INSERT on buyer_checks
-- ─────────────────────────────────────────────────────────────
-- When a buyer types a Day Entry row AFTER a white sheet for the
-- same form # already landed in the review pile (orphan,
-- 'unmatched_form'), this trigger pulls the orphan(s) out and
-- links them to the new check.
--
-- The trigger ONLY does the link + flag-clear here. The auto-
-- commit recheck (verify $ / check #) re-runs the next time the
-- worker (Phase 3) touches the page, so we don't duplicate that
-- logic in PL/pgSQL. Result: as soon as a forgotten Day Entry row
-- is entered, the orphan moves out of the 'unmatched_form' bucket
-- and either auto-commits or surfaces a different (more accurate)
-- review reason.
--
-- NOTE: This is AFTER INSERT (not BEFORE INSERT as the early
-- spec draft said) — we need NEW.id to be available so the orphan
-- pages can FK to it. The spec body has been updated accordingly.

CREATE OR REPLACE FUNCTION public.relink_orphan_white_sheets()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- No-op if the new check has no form # (free-form buys without a
  -- paper sheet). The partial index on white_sheet_pages keeps this
  -- branch cheap.
  IF NEW.buy_form_number IS NULL OR length(trim(NEW.buy_form_number)) = 0 THEN
    RETURN NEW;
  END IF;

  UPDATE public.white_sheet_pages
     SET buyer_check_id  = NEW.id,
         review_reasons  = array_remove(review_reasons, 'unmatched_form'),
         -- If 'unmatched_form' was the only reason, clear the page
         -- back to 'pending' so the worker re-runs the auto-commit
         -- checks (it'll either flip to auto_committed or surface a
         -- different reason). Otherwise leave it in needs_review with
         -- the remaining flags.
         status          = CASE
                             WHEN array_length(array_remove(review_reasons, 'unmatched_form'), 1) IS NULL
                               THEN 'pending'
                             ELSE status
                           END,
         processed_at    = NULL
   WHERE event_id            = NEW.event_id
     AND buy_form_number_ocr = NEW.buy_form_number
     AND buyer_check_id      IS NULL
     AND status              = 'needs_review'
     AND 'unmatched_form'    = ANY(review_reasons);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_relink_orphan_white_sheets ON public.buyer_checks;
CREATE TRIGGER trg_relink_orphan_white_sheets
  AFTER INSERT ON public.buyer_checks
  FOR EACH ROW
  EXECUTE FUNCTION public.relink_orphan_white_sheets();


-- ─────────────────────────────────────────────────────────────
-- 10. Done
-- ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  RAISE NOTICE 'White Sheet OCR Phase 1: schema + storage bucket + RLS + auto-relink trigger installed. No UI / worker / OCR yet — Phases 2-9 layer on top. Spec: docs/white-sheet-ocr-spec.md.';
END $$;
