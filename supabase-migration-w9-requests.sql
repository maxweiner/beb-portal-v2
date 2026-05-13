-- ============================================================
-- W-9 Requests — Diane's "Send W-9" flow
--
-- Adds the data foundation for collecting IRS Form W-9 from new
-- payees (1099 vendors, contractors, staff). Two flows:
--   - Internal: an existing public.users row receives a hard-blocking
--     prompt on their next portal login.
--   - External: a vendor without a portal account gets an email with
--     a token-only link to a public W-9 form.
--
-- What's here
-- -----------
-- 1. `w9_requests` table — one row per send (internal OR external).
--    Carries the token URL, recipient name/email, requester (Diane),
--    status, signed-PDF storage path, and form_data JSONB snapshot.
--    Internal recipients link via `recipient_user_id`; external rows
--    leave it NULL and rely on the typed-in name + email.
-- 2. `settings` row `w9.requester_info` — BEB-side data that
--    pre-fills the "person requesting information" box on the form
--    (name, address, phone, etc). Editable by Diane via Settings →
--    Accounting Settings (UI in PR 3).
-- 3. RLS — admin / superadmin / partner / accounting can read+write.
--    Public form lookup hits this via the service-role client
--    (mirrors /edge/[token] + /e/[token]).
--
-- Idempotent. Safe to re-run.
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. enums
-- ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE w9_request_status AS ENUM
    ('pending', 'opened', 'completed', 'expired', 'revoked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ─────────────────────────────────────────────────────────────
-- 2. w9_requests table
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.w9_requests (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand               TEXT NOT NULL CHECK (brand IN ('beb', 'liberty')),

  -- Recipient identity. recipient_user_id is set for internal users
  -- (existing portal accounts → hard-block on login). External
  -- recipients leave it NULL and rely on name + email only.
  recipient_user_id   UUID REFERENCES public.users(id) ON DELETE SET NULL,
  recipient_name      TEXT NOT NULL,
  recipient_email     TEXT NOT NULL,

  -- Token URL slug — public form lives at /w9/[token]. App-minted
  -- (Node crypto), ~24 url-safe chars.
  token               TEXT NOT NULL UNIQUE,

  requested_by        UUID REFERENCES public.users(id) ON DELETE SET NULL,
  requested_by_email  TEXT,  -- frozen so deleted users don't blank
  requested_by_name   TEXT,  -- ditto, for the "from" in the email

  -- Lifecycle.
  status              w9_request_status NOT NULL DEFAULT 'pending',
  expires_at          TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  revoked_at          TIMESTAMPTZ,
  revoked_reason      TEXT,

  -- Tracking.
  first_opened_at     TIMESTAMPTZ,
  last_opened_at      TIMESTAMPTZ,
  open_count          INTEGER NOT NULL DEFAULT 0,
  last_sent_at        TIMESTAMPTZ,  -- last time we emailed the link
  last_sent_to        TEXT,
  send_count          INTEGER NOT NULL DEFAULT 0,

  -- Submission. form_data is a JSONB snapshot of the form fields
  -- (NOT including the TIN/SSN — that's only in the PDF). signed_pdf
  -- is the storage path of the filled+signed IRS form.
  form_data           JSONB,
  signed_pdf_path     TEXT,
  signed_at           TIMESTAMPTZ,
  delivered_pdf_to    TEXT,        -- email address the signed PDF was sent to
  delivered_at        TIMESTAMPTZ,

  -- Audit. created_by mirrors requested_by for now; kept separate so
  -- a future "auto-request on user creation" path can attribute
  -- system-initiated rows distinctly.
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Public-form lookup (every page hit) — fast index over token.
CREATE INDEX IF NOT EXISTS idx_w9_requests_token_active
  ON public.w9_requests (token)
  WHERE revoked_at IS NULL AND status <> 'expired';

-- Sidebar "pending W-9?" check on every page load.
CREATE INDEX IF NOT EXISTS idx_w9_requests_user_pending
  ON public.w9_requests (recipient_user_id, status)
  WHERE recipient_user_id IS NOT NULL AND status IN ('pending', 'opened');

-- Recent-history listing for the accountant.
CREATE INDEX IF NOT EXISTS idx_w9_requests_brand_created
  ON public.w9_requests (brand, created_at DESC);


-- ─────────────────────────────────────────────────────────────
-- 3. RLS — accountant + admins + partners can read+write
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.w9_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS w9_requests_read ON public.w9_requests;
CREATE POLICY w9_requests_read
  ON public.w9_requests FOR SELECT TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin', 'accounting')
    OR public.is_my_partner()
    -- A user can read their OWN pending W-9 row (so the in-portal
    -- modal can fetch it without an API round-trip).
    OR recipient_user_id = public.get_effective_user_id()
  );

DROP POLICY IF EXISTS w9_requests_write ON public.w9_requests;
CREATE POLICY w9_requests_write
  ON public.w9_requests FOR ALL TO authenticated
  USING (
    public.has_any_role('admin', 'superadmin', 'accounting')
    OR public.is_my_partner()
  )
  WITH CHECK (
    public.has_any_role('admin', 'superadmin', 'accounting')
    OR public.is_my_partner()
  );


-- ─────────────────────────────────────────────────────────────
-- 4. updated_at touch trigger (reuse wholesale helper)
-- ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF to_regprocedure('public.wholesale_touch_updated_at()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_w9_requests_touch ON public.w9_requests;
    CREATE TRIGGER trg_w9_requests_touch
      BEFORE UPDATE ON public.w9_requests
      FOR EACH ROW EXECUTE FUNCTION public.wholesale_touch_updated_at();
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────
-- 5. Seed BEB's W-9 Requester Info (settings row)
-- ─────────────────────────────────────────────────────────────
--
-- This populates the "Name and address of person requesting
-- information" box on the form (top right of IRS W-9). Diane edits
-- via the Settings → Accounting UI in PR 3. Placeholder values now;
-- safe to overwrite via UPSERT in code.
INSERT INTO public.settings (key, value)
SELECT 'w9.requester_info', jsonb_build_object(
  'name', 'Beneficial Estate Buyers, LLC',
  'address', '— set in Settings → Accounting →',
  'city', '',
  'state', '',
  'zip', '',
  'phone', '',
  'tin', '',
  'contact_name', '',
  'contact_email', ''
)
WHERE NOT EXISTS (
  SELECT 1 FROM public.settings WHERE key = 'w9.requester_info'
);


-- ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  RAISE NOTICE 'w9_requests table ready. PR 2 wires the public form + PDF + email; PR 3 adds the Send W-9 button to Accounting Queue; PR 4 adds the portal hard-block prompt + documents section.';
END $$;
