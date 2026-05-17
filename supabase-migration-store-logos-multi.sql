-- ============================================================
-- Multi-logo store management
--
-- Replaces the single inline-base64 `store_image_url` column on
-- both public.stores and public.trunk_show_stores with a JSONB
-- array. The single string column survives as a synced mirror
-- of the active default (kept up to date by a BEFORE trigger),
-- so the 8 existing consumer surfaces keep rendering whatever
-- value is there — only the SOURCE of that value changes.
--
-- Spec
-- ─────
--   store_logos JSONB[] of {path, mime, uploaded_at, uploaded_by, legacy_data_url?}
--   default_logo_index INT — auto-clamped to a valid range
--   store_image_url    — auto-synced to store_logos[default].path
--
-- Path semantics
-- ──────────────
-- `path` holds either:
--   1. A Supabase Storage object key under the new `store-logos`
--      bucket (e.g. `buying/<store-id>/<uuid>.png`), OR
--   2. A legacy `data:` URL inherited from the pre-multi-logo
--      era (flagged with `legacy_data_url: true`), OR
--   3. Any other absolute http(s) URL (rare, but supported).
--
-- The lib/storeLogos/url.ts helper (`publicLogoUrl`) interprets
-- these at render time — Storage keys get prefixed with the
-- bucket's public URL; data/http URLs pass through unchanged.
--
-- New uploads go to the public store-logos bucket. Existing rows
-- are backfilled with legacy_data_url=TRUE so they keep rendering
-- as-is until they're re-uploaded.
--
-- Safe to re-run.
-- ============================================================

-- ── Columns ─────────────────────────────────────────────────
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS store_logos JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS default_logo_index INT NOT NULL DEFAULT 0;

ALTER TABLE public.trunk_show_stores
  ADD COLUMN IF NOT EXISTS store_logos JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS default_logo_index INT NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.stores.store_logos IS
  'Array of {path, mime, uploaded_at, uploaded_by, legacy_data_url?}. The active default is at default_logo_index; the legacy store_image_url is auto-synced from this by trg_stores_sync_image_url.';
COMMENT ON COLUMN public.stores.default_logo_index IS
  'Which entry in store_logos is the active default. Auto-clamped to [0, len) by the sync trigger.';
COMMENT ON COLUMN public.trunk_show_stores.store_logos IS
  'See public.stores.store_logos.';
COMMENT ON COLUMN public.trunk_show_stores.default_logo_index IS
  'See public.stores.default_logo_index.';

-- ── Sync trigger ────────────────────────────────────────────
-- Keeps store_image_url in sync with store_logos[default_logo_index].path.
-- Empty array → store_image_url := NULL. Out-of-range default_logo_index
-- gets silently clamped to 0 so the trigger can never "wedge" the row.
--
-- The trigger writes the path *verbatim*; the lib/storeLogos/url.ts
-- helper handles bucket-prefix vs data-URL vs http-URL at render time.
-- This keeps the trigger free of any deployment-specific URLs.
CREATE OR REPLACE FUNCTION public.sync_store_image_url() RETURNS TRIGGER AS $$
DECLARE
  arr_len INT;
  idx     INT;
  active  JSONB;
BEGIN
  arr_len := jsonb_array_length(COALESCE(NEW.store_logos, '[]'::jsonb));
  IF arr_len = 0 THEN
    NEW.store_image_url    := NULL;
    NEW.default_logo_index := 0;
    RETURN NEW;
  END IF;

  idx := COALESCE(NEW.default_logo_index, 0);
  IF idx < 0 OR idx >= arr_len THEN
    idx := 0;
    NEW.default_logo_index := 0;
  END IF;

  active := NEW.store_logos -> idx;
  NEW.store_image_url := active ->> 'path';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.sync_store_image_url() IS
  'BEFORE INSERT/UPDATE trigger on stores + trunk_show_stores. Writes the path of the active default logo into store_image_url, clamps default_logo_index to a valid range, and NULLs store_image_url when the array is empty.';

DROP TRIGGER IF EXISTS trg_stores_sync_image_url ON public.stores;
CREATE TRIGGER trg_stores_sync_image_url
  BEFORE INSERT OR UPDATE OF store_logos, default_logo_index ON public.stores
  FOR EACH ROW EXECUTE FUNCTION public.sync_store_image_url();

DROP TRIGGER IF EXISTS trg_trunk_show_stores_sync_image_url ON public.trunk_show_stores;
CREATE TRIGGER trg_trunk_show_stores_sync_image_url
  BEFORE INSERT OR UPDATE OF store_logos, default_logo_index ON public.trunk_show_stores
  FOR EACH ROW EXECUTE FUNCTION public.sync_store_image_url();

-- ── Backfill ────────────────────────────────────────────────
-- For every existing row with a non-empty store_image_url, populate
-- store_logos with one entry tagged legacy_data_url so the helper
-- knows to render it as-is. Re-running is safe — the empty-array
-- check prevents double-backfill.
UPDATE public.stores
   SET store_logos = jsonb_build_array(jsonb_build_object(
     'path',            store_image_url,
     'mime',            CASE
                          WHEN store_image_url LIKE 'data:image/jpeg%' THEN 'image/jpeg'
                          WHEN store_image_url LIKE 'data:image/webp%' THEN 'image/webp'
                          WHEN store_image_url LIKE 'data:image/svg%'  THEN 'image/svg+xml'
                          ELSE 'image/png'
                        END,
     'uploaded_at',     NOW(),
     'uploaded_by',     NULL,
     'legacy_data_url', TRUE
   ))
 WHERE store_image_url IS NOT NULL
   AND store_image_url <> ''
   AND store_logos = '[]'::jsonb;

UPDATE public.trunk_show_stores
   SET store_logos = jsonb_build_array(jsonb_build_object(
     'path',            store_image_url,
     'mime',            CASE
                          WHEN store_image_url LIKE 'data:image/jpeg%' THEN 'image/jpeg'
                          WHEN store_image_url LIKE 'data:image/webp%' THEN 'image/webp'
                          WHEN store_image_url LIKE 'data:image/svg%'  THEN 'image/svg+xml'
                          ELSE 'image/png'
                        END,
     'uploaded_at',     NOW(),
     'uploaded_by',     NULL,
     'legacy_data_url', TRUE
   ))
 WHERE store_image_url IS NOT NULL
   AND store_image_url <> ''
   AND store_logos = '[]'::jsonb;

-- ── Storage bucket ──────────────────────────────────────────
-- Public-read bucket. Store logos are shown on public booking pages
-- and the OG-image endpoint anyway, so there's no privacy value in
-- making the bucket private — and going public lets the consumer
-- surfaces use plain <img src=...> without signed-URL plumbing.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('store-logos', 'store-logos', TRUE, 10485760)  -- 10MB cap
ON CONFLICT (id) DO NOTHING;

-- Storage RLS — admin / superadmin / partner can upload/update/delete.
-- Reads are public (bucket is public — no SELECT policy needed).
DROP POLICY IF EXISTS store_logos_storage_admin_write ON storage.objects;
CREATE POLICY store_logos_storage_admin_write ON storage.objects
  FOR ALL
  USING (
    bucket_id = 'store-logos' AND (
      public.has_any_role('admin', 'superadmin')
      OR EXISTS (
        SELECT 1 FROM public.users u
         WHERE u.id = public.get_effective_user_id() AND u.is_partner = TRUE
      )
    )
  )
  WITH CHECK (
    bucket_id = 'store-logos' AND (
      public.has_any_role('admin', 'superadmin')
      OR EXISTS (
        SELECT 1 FROM public.users u
         WHERE u.id = public.get_effective_user_id() AND u.is_partner = TRUE
      )
    )
  );

DO $$ BEGIN
  RAISE NOTICE 'multi-logo store management installed.';
  RAISE NOTICE '  - stores.store_logos / default_logo_index added';
  RAISE NOTICE '  - trunk_show_stores.store_logos / default_logo_index added';
  RAISE NOTICE '  - sync trigger installed; store_image_url auto-tracks the active default';
  RAISE NOTICE '  - store-logos public bucket created (10MB cap, admin/superadmin/partner write)';
  RAISE NOTICE '  - existing single-logo rows backfilled with legacy_data_url=TRUE';
END $$;
