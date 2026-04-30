-- ============================================================
-- Marketing module rebuild — Phase 1: Schema + RLS
--
-- Lays the data model for the new flow-based architecture (VDP +
-- Postcard, with Newspaper as a future flow). All tables, enums,
-- indexes, foreign keys, helper function, RLS policies, and the
-- per-user marketing_access flag.
--
-- Decisions confirmed before writing:
--   - users.marketing_access boolean gates who can use the module
--   - role = 'superadmin' gates marketing-admin actions (managing
--     access, approvers, payment methods, templates, lead times)
--   - ROI hookup deferred (no marketing_campaign_id on buyer_checks
--     yet; revisit when v2 reporting lands)
--
-- Safe to re-run.
-- ============================================================

-- ── 1. users.marketing_access flag ──────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS marketing_access BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN users.marketing_access IS
  'Per-user gate for the Marketing module. Granted independently of role; true for internal staff who should see Marketing + for external Collected Concepts users (no other portal access required).';

-- ── 2. Helper: has_marketing_access() ───────────────────────
-- Mirrors the existing get_my_role() pattern (defined directly in
-- the Supabase project, not in repo SQL). Used in every RLS policy
-- below so the gate stays in one place.
CREATE OR REPLACE FUNCTION has_marketing_access() RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    (SELECT u.marketing_access
       FROM users u
       JOIN auth.users au ON au.email = u.email
      WHERE au.id = auth.uid()
      LIMIT 1),
    FALSE
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION has_marketing_access() IS
  'Returns true when the calling Supabase Auth user has marketing_access=true on their users row.';

-- ── 3. Enums ────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE marketing_flow_type AS ENUM ('vdp', 'postcard', 'newspaper');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE marketing_status AS ENUM ('setup', 'planning', 'proofing', 'payment', 'done');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE marketing_proof_status AS ENUM ('pending', 'approved', 'revision_requested');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE marketing_artifact_type AS ENUM (
    'proof', 'approved_proof', 'receipt', 'csv_upload', 'qr_code_reference', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 4. marketing_campaigns (base record) ────────────────────
CREATE TABLE IF NOT EXISTS marketing_campaigns (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id                    UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  flow_type                   marketing_flow_type NOT NULL,
  status                      marketing_status NOT NULL DEFAULT 'setup',
  sub_status                  TEXT NULL,
  marketing_budget            NUMERIC(10,2) NULL CHECK (marketing_budget IS NULL OR marketing_budget >= 0),
  budget_set_by               UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  budget_set_at               TIMESTAMPTZ NULL,
  team_notified_at            TIMESTAMPTZ NULL,
  mail_by_date                DATE NULL,
  payment_method_label        TEXT NULL,
  payment_method_note         TEXT NULL,
  payment_authorized_by       UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  payment_authorized_at       TIMESTAMPTZ NULL,
  paid_at                     TIMESTAMPTZ NULL,
  paid_by                     UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  accountant_receipt_sent_at  TIMESTAMPTZ NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One campaign per (event, flow) — auto-creation can ON CONFLICT skip
  UNIQUE (event_id, flow_type)
);
CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_event  ON marketing_campaigns(event_id);
CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_status ON marketing_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_flow   ON marketing_campaigns(flow_type);

COMMENT ON COLUMN marketing_campaigns.sub_status IS
  'Free-text finer-grained state within phase (e.g., awaiting_budget, awaiting_planning_approval, awaiting_proof_approval, awaiting_payment_method, awaiting_paid_mark, complete). TEXT instead of enum so workflow tweaks don''t need migrations.';
COMMENT ON COLUMN marketing_campaigns.payment_method_label IS
  'Label only. Card numbers are NEVER stored — actual charging happens outside the portal.';

-- updated_at trigger
CREATE OR REPLACE FUNCTION marketing_set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_marketing_campaigns_updated_at ON marketing_campaigns;
CREATE TRIGGER trg_marketing_campaigns_updated_at
  BEFORE UPDATE ON marketing_campaigns
  FOR EACH ROW EXECUTE FUNCTION marketing_set_updated_at();

-- ── 5. vdp_campaign_details ─────────────────────────────────
CREATE TABLE IF NOT EXISTS vdp_campaign_details (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id  UUID NOT NULL UNIQUE REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
  vdp_count    INTEGER NULL CHECK (vdp_count IS NULL OR vdp_count >= 0),
  submitted_at TIMESTAMPTZ NULL,
  submitted_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  approved_at  TIMESTAMPTZ NULL,
  approved_by  UUID NULL REFERENCES users(id) ON DELETE SET NULL
);

-- ── 6. vdp_zip_codes ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vdp_zip_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
  zip_code    TEXT NOT NULL CHECK (zip_code ~ '^[0-9]{5}$')
);
CREATE INDEX IF NOT EXISTS idx_vdp_zip_codes_campaign ON vdp_zip_codes(campaign_id);

-- ── 7. postcard_campaign_details ────────────────────────────
CREATE TABLE IF NOT EXISTS postcard_campaign_details (
  id                                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id                          UUID NOT NULL UNIQUE REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
  postcard_count                       INTEGER NULL CHECK (postcard_count IS NULL OR postcard_count >= 0),
  submitted_at                         TIMESTAMPTZ NULL,
  submitted_by                         UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  approved_at                          TIMESTAMPTZ NULL,
  approved_by                          UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  selected_filter_max_record_age_days  INTEGER NULL,
  selected_filter_max_proximity_miles  INTEGER NULL
);

-- ── 8. store_postcard_lists (per-store additive master list) ──
CREATE TABLE IF NOT EXISTS store_postcard_lists (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  first_name      TEXT NULL,
  last_name       TEXT NULL,
  address_line_1  TEXT NOT NULL,
  address_line_2  TEXT NULL,
  city            TEXT NULL,
  state           TEXT NULL,
  zip             TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_via     TEXT NULL,  -- e.g., upload_id or 'manual'
  -- When a duplicate is detected on import, the new row points back to
  -- the canonical row so dedup tooling can reconcile / merge later.
  is_duplicate_of UUID NULL REFERENCES store_postcard_lists(id) ON DELETE SET NULL
);
-- The (store_id, address_line_1, zip) combo drives upload-time dedup.
CREATE INDEX IF NOT EXISTS idx_store_postcard_lists_address
  ON store_postcard_lists(store_id, address_line_1, zip);
CREATE INDEX IF NOT EXISTS idx_store_postcard_lists_store
  ON store_postcard_lists(store_id);

-- ── 9. postcard_uploads (audit trail) ───────────────────────
CREATE TABLE IF NOT EXISTS postcard_uploads (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id       UUID NOT NULL REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
  store_id          UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  uploaded_by       UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  original_filename TEXT NULL,
  total_rows        INTEGER NULL,
  new_rows          INTEGER NULL,
  duplicate_rows    INTEGER NULL,
  file_url          TEXT NULL  -- Supabase Storage path of the original CSV
);
CREATE INDEX IF NOT EXISTS idx_postcard_uploads_campaign ON postcard_uploads(campaign_id);

-- ── 10. marketing_proofs (versioned, multi-file) ────────────
CREATE TABLE IF NOT EXISTS marketing_proofs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     UUID NOT NULL REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
  version_number  INTEGER NOT NULL,
  is_latest       BOOLEAN NOT NULL DEFAULT TRUE,
  uploaded_by     UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Supports multi-file proofs (e.g., front + back) without needing a
  -- separate proof_files table.
  file_urls       TEXT[] NOT NULL DEFAULT '{}',
  status          marketing_proof_status NOT NULL DEFAULT 'pending',
  approved_by     UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  approved_at     TIMESTAMPTZ NULL,
  UNIQUE (campaign_id, version_number)
);
CREATE INDEX IF NOT EXISTS idx_marketing_proofs_campaign ON marketing_proofs(campaign_id);
CREATE INDEX IF NOT EXISTS idx_marketing_proofs_latest
  ON marketing_proofs(campaign_id) WHERE is_latest = TRUE;

-- ── 11. marketing_proof_comments ────────────────────────────
CREATE TABLE IF NOT EXISTS marketing_proof_comments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proof_id      UUID NOT NULL REFERENCES marketing_proofs(id) ON DELETE CASCADE,
  commenter_id  UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  -- Email-reply commenters may not exist as portal users; capture name
  -- snapshot for those cases.
  commenter_name TEXT NULL,
  comment       TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_marketing_proof_comments_proof ON marketing_proof_comments(proof_id, created_at);

-- ── 12. marketing_payment_methods (LABELS ONLY) ─────────────
CREATE TABLE IF NOT EXISTS marketing_payment_methods (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label         TEXT NOT NULL UNIQUE,
  created_by    UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ NULL,
  is_archived   BOOLEAN NOT NULL DEFAULT FALSE
);

COMMENT ON TABLE marketing_payment_methods IS
  'Card LABELS only (e.g., "Max Amex 6006"). No card numbers ever stored. Charging happens outside the portal.';

-- Spec calls out these as default seeds.
INSERT INTO marketing_payment_methods (label) VALUES
  ('Max Amex 6006'),
  ('Max Citibank 6795')
ON CONFLICT (label) DO NOTHING;

-- ── 13. marketing_campaign_artifacts (per-campaign folder) ──
CREATE TABLE IF NOT EXISTS marketing_campaign_artifacts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id      UUID NOT NULL REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
  artifact_type    marketing_artifact_type NOT NULL,
  file_url         TEXT NULL,
  -- Optional pointer back to the source row (proofs/uploads/etc.) so
  -- the unified folder view can deep-link.
  linked_record_id UUID NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_marketing_campaign_artifacts_campaign
  ON marketing_campaign_artifacts(campaign_id, created_at);

-- ── 14. marketing_team_emails (admin-managed) ───────────────
CREATE TABLE IF NOT EXISTS marketing_team_emails (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT NOT NULL UNIQUE,
  name       TEXT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE marketing_team_emails IS
  'Recipients of "Notify Marketing Team" emails (Collected Concepts contacts, etc.). Managed in admin settings.';

-- ── 15. marketing_approvers (admin-managed) ─────────────────
CREATE TABLE IF NOT EXISTS marketing_approvers (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE marketing_approvers IS
  'Users who can approve marketing planning, proofs, and payment requests. Spec defaults: Max, Joe, Richie, Teri (seed via admin settings UI in Phase 2).';

-- ── 16. magic_link_tokens ───────────────────────────────────
CREATE TABLE IF NOT EXISTS magic_link_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   UUID NOT NULL REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  token         TEXT NOT NULL UNIQUE,
  expires_at    TIMESTAMPTZ NULL,
  last_used_at  TIMESTAMPTZ NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_magic_link_tokens_token    ON magic_link_tokens(token);
CREATE INDEX IF NOT EXISTS idx_magic_link_tokens_campaign ON magic_link_tokens(campaign_id);

COMMENT ON TABLE magic_link_tokens IS
  'No-login access tokens for external marketing partners (Collected). Per-campaign + per-email so revoking one recipient does not affect others. Routes that consume these use the service role and bypass RLS.';

-- ── 17. Lead-time settings keys (defaults from spec) ────────
INSERT INTO settings (key, value) VALUES
  ('marketing_vdp_lead_days', '14'),
  ('marketing_postcard_lead_days', '10')
ON CONFLICT (key) DO NOTHING;

-- ── 18. RLS — enable on every new table + policies ──────────
-- Pattern:
--   - Campaign / proof / zip / postcard / artifact / token tables:
--       SELECT + ALL gated by has_marketing_access().
--   - Admin-settings tables (approvers, team_emails, payment_methods):
--       SELECT for marketing_access; INSERT/UPDATE/DELETE for superadmin.
--   - magic_link_tokens: marketing_access read; service-role writes.

ALTER TABLE marketing_campaigns          ENABLE ROW LEVEL SECURITY;
ALTER TABLE vdp_campaign_details         ENABLE ROW LEVEL SECURITY;
ALTER TABLE vdp_zip_codes                ENABLE ROW LEVEL SECURITY;
ALTER TABLE postcard_campaign_details    ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_postcard_lists         ENABLE ROW LEVEL SECURITY;
ALTER TABLE postcard_uploads             ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_proofs             ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_proof_comments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_payment_methods    ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_campaign_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_team_emails        ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_approvers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE magic_link_tokens            ENABLE ROW LEVEL SECURITY;

-- ----- Campaign-data tables: marketing_access for read+write -----
DROP POLICY IF EXISTS marketing_access_rw ON marketing_campaigns;
CREATE POLICY marketing_access_rw ON marketing_campaigns
  FOR ALL USING (has_marketing_access()) WITH CHECK (has_marketing_access());

DROP POLICY IF EXISTS marketing_access_rw ON vdp_campaign_details;
CREATE POLICY marketing_access_rw ON vdp_campaign_details
  FOR ALL USING (has_marketing_access()) WITH CHECK (has_marketing_access());

DROP POLICY IF EXISTS marketing_access_rw ON vdp_zip_codes;
CREATE POLICY marketing_access_rw ON vdp_zip_codes
  FOR ALL USING (has_marketing_access()) WITH CHECK (has_marketing_access());

DROP POLICY IF EXISTS marketing_access_rw ON postcard_campaign_details;
CREATE POLICY marketing_access_rw ON postcard_campaign_details
  FOR ALL USING (has_marketing_access()) WITH CHECK (has_marketing_access());

DROP POLICY IF EXISTS marketing_access_rw ON store_postcard_lists;
CREATE POLICY marketing_access_rw ON store_postcard_lists
  FOR ALL USING (has_marketing_access()) WITH CHECK (has_marketing_access());

DROP POLICY IF EXISTS marketing_access_rw ON postcard_uploads;
CREATE POLICY marketing_access_rw ON postcard_uploads
  FOR ALL USING (has_marketing_access()) WITH CHECK (has_marketing_access());

DROP POLICY IF EXISTS marketing_access_rw ON marketing_proofs;
CREATE POLICY marketing_access_rw ON marketing_proofs
  FOR ALL USING (has_marketing_access()) WITH CHECK (has_marketing_access());

DROP POLICY IF EXISTS marketing_access_rw ON marketing_proof_comments;
CREATE POLICY marketing_access_rw ON marketing_proof_comments
  FOR ALL USING (has_marketing_access()) WITH CHECK (has_marketing_access());

DROP POLICY IF EXISTS marketing_access_rw ON marketing_campaign_artifacts;
CREATE POLICY marketing_access_rw ON marketing_campaign_artifacts
  FOR ALL USING (has_marketing_access()) WITH CHECK (has_marketing_access());

-- ----- Admin-settings tables: superadmin write, marketing_access read -----
DROP POLICY IF EXISTS marketing_access_read ON marketing_payment_methods;
CREATE POLICY marketing_access_read ON marketing_payment_methods
  FOR SELECT USING (has_marketing_access());
DROP POLICY IF EXISTS superadmin_write ON marketing_payment_methods;
CREATE POLICY superadmin_write ON marketing_payment_methods
  FOR ALL USING (get_my_role() = 'superadmin') WITH CHECK (get_my_role() = 'superadmin');

DROP POLICY IF EXISTS marketing_access_read ON marketing_team_emails;
CREATE POLICY marketing_access_read ON marketing_team_emails
  FOR SELECT USING (has_marketing_access());
DROP POLICY IF EXISTS superadmin_write ON marketing_team_emails;
CREATE POLICY superadmin_write ON marketing_team_emails
  FOR ALL USING (get_my_role() = 'superadmin') WITH CHECK (get_my_role() = 'superadmin');

DROP POLICY IF EXISTS marketing_access_read ON marketing_approvers;
CREATE POLICY marketing_access_read ON marketing_approvers
  FOR SELECT USING (has_marketing_access());
DROP POLICY IF EXISTS superadmin_write ON marketing_approvers;
CREATE POLICY superadmin_write ON marketing_approvers
  FOR ALL USING (get_my_role() = 'superadmin') WITH CHECK (get_my_role() = 'superadmin');

-- ----- magic_link_tokens: marketing_access read; client cannot write -----
DROP POLICY IF EXISTS marketing_access_read ON magic_link_tokens;
CREATE POLICY marketing_access_read ON magic_link_tokens
  FOR SELECT USING (has_marketing_access());
-- No client write policy. The mint-token API route uses the service role.

DO $$ BEGIN
  RAISE NOTICE 'Marketing Phase 1 schema installed: 13 tables, 4 enums, has_marketing_access() helper, RLS, lead-time settings, payment-method seeds.';
END $$;
