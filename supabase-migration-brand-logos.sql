-- ============================================================
-- Per-brand uploadable logos.
--
-- Stored in a private 'brand-logos' bucket; the path lives on a
-- per-brand row in `brand_logos`. The expense-report PDF (and other
-- branded surfaces later) read the file bytes via the service role
-- and embed them in the render. If no row exists for a brand, the
-- code falls back to the bundled public/beb-wordmark.png.
--
-- Read access is broad (every authenticated user can read the row to
-- find their brand's logo path); write access is superadmin only.
--
-- Safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS brand_logos (
  brand       TEXT PRIMARY KEY CHECK (brand IN ('beb', 'liberty')),
  logo_path   TEXT NOT NULL,
  mime_type   TEXT NOT NULL,
  uploaded_by UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE brand_logos IS
  'Per-brand uploadable logo. logo_path points at an object in the private brand-logos storage bucket. Service-role reads it at PDF render time.';
COMMENT ON COLUMN brand_logos.logo_path IS
  'Path within the brand-logos bucket (e.g., "beb/wordmark-2026.png"). Bucket is private — never construct a public URL.';

-- updated_at trigger (re-uses the marketing helper if present, else inline)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'marketing_set_updated_at') THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_brand_logos_updated_at ON brand_logos';
    EXECUTE 'CREATE TRIGGER trg_brand_logos_updated_at BEFORE UPDATE ON brand_logos FOR EACH ROW EXECUTE FUNCTION marketing_set_updated_at()';
  END IF;
END $$;

-- ── Storage bucket ──────────────────────────────────────────
-- Private bucket; reads happen via service role from server code only.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('brand-logos', 'brand-logos', false, 5242880)  -- 5MB cap
ON CONFLICT (id) DO NOTHING;

-- ── RLS ─────────────────────────────────────────────────────
ALTER TABLE brand_logos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS brand_logos_read_all ON brand_logos;
CREATE POLICY brand_logos_read_all ON brand_logos
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS brand_logos_write_superadmin ON brand_logos;
CREATE POLICY brand_logos_write_superadmin ON brand_logos
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
       JOIN auth.users au ON au.email = u.email
      WHERE au.id = auth.uid() AND u.role = 'superadmin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users u
       JOIN auth.users au ON au.email = u.email
      WHERE au.id = auth.uid() AND u.role = 'superadmin'
    )
  );

-- Storage RLS — superadmin uploads/updates; reads happen via service role only.
DROP POLICY IF EXISTS brand_logos_storage_superadmin_all ON storage.objects;
CREATE POLICY brand_logos_storage_superadmin_all ON storage.objects
  FOR ALL
  USING (
    bucket_id = 'brand-logos' AND EXISTS (
      SELECT 1 FROM public.users u
       JOIN auth.users au ON au.email = u.email
      WHERE au.id = auth.uid() AND u.role = 'superadmin'
    )
  )
  WITH CHECK (
    bucket_id = 'brand-logos' AND EXISTS (
      SELECT 1 FROM public.users u
       JOIN auth.users au ON au.email = u.email
      WHERE au.id = auth.uid() AND u.role = 'superadmin'
    )
  );

DO $$ BEGIN
  RAISE NOTICE 'brand_logos table + brand-logos bucket installed.';
END $$;
