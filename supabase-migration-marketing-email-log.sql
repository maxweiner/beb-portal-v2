-- ============================================================
-- Marketing: log every vendor proof-request email we send.
--
-- Why: today the "Email Vendors" button is fire-and-forget — admins
-- get a one-time alert and that's it. No record of who was emailed,
-- when, what message was attached, or whether the send succeeded.
-- A simple append-only log gives us:
--   - "Last reached out 4 days ago" hints in the admin event view
--   - Per-vendor history when triaging "did Vendor X get the proof?"
--   - Audit trail for failed sends
--
-- Snapshot vendor_name + vendor_email so the row stays meaningful
-- after a vendor is renamed or deactivated.
--
-- Safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS marketing_emails_sent (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     UUID        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  vendor_id    UUID        NULL REFERENCES marketing_vendors(id) ON DELETE SET NULL,
  vendor_name  TEXT        NULL,
  vendor_email TEXT        NULL,
  message      TEXT        NULL,
  sent_by      TEXT        NULL,
  status       TEXT        NOT NULL CHECK (status IN ('sent', 'failed')),
  error_message TEXT       NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_marketing_emails_sent_event_created
  ON marketing_emails_sent(event_id, created_at DESC);

COMMENT ON TABLE marketing_emails_sent IS
  'Append-only log of vendor proof-request emails sent from the Marketing module.';
COMMENT ON COLUMN marketing_emails_sent.vendor_name IS
  'Snapshot at send time. Survives vendor rename / deactivation.';

-- RLS: read for any authed admin, no client-side writes (the API
-- route uses the service role).
ALTER TABLE marketing_emails_sent ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read marketing email log" ON marketing_emails_sent;
CREATE POLICY "Admins can read marketing email log"
  ON marketing_emails_sent FOR SELECT
  USING (get_my_role() IN ('admin', 'superadmin'));

DO $$ BEGIN
  RAISE NOTICE 'marketing_emails_sent installed.';
END $$;
