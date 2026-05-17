// Shape of one entry in the store_logos JSONB array on both
// public.stores and public.trunk_show_stores. Matches the Postgres
// trigger contract in supabase-migration-store-logos-multi.sql —
// the trigger writes `path` into store_image_url, so the helper at
// lib/storeLogos/url.ts handles bucket-prefix vs data-URL vs http
// at render time.

export interface StoreLogoEntry {
  /** Storage path under the `store-logos` bucket
   *  (e.g. `buying/<store-id>/<uuid>.png`), OR a legacy `data:`
   *  URL, OR an absolute http(s) URL. The publicLogoUrl helper
   *  disambiguates. */
  path: string
  /** MIME of the file as uploaded (post-rasterization for PDFs). */
  mime: string
  /** ISO timestamp written by the upload API. */
  uploaded_at: string
  /** users.id of the uploader, or null for backfilled rows. */
  uploaded_by: string | null
  /** True iff the path is a pre-multi-logo `data:` URL preserved
   *  by the backfill — the publicLogoUrl helper renders these
   *  verbatim so old rows keep working until they're re-uploaded. */
  legacy_data_url?: boolean
}

/** Which parent table a logo belongs to. Drives the storage path
 *  prefix and the table the API route updates. */
export type StoreLogoParentKind = 'buying' | 'trunk'
