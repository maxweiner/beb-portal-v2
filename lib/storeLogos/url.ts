// Render-time disambiguator for the value stored in
// stores.store_image_url / trunk_show_stores.store_image_url.
//
// The DB trigger writes the active default logo's `path` verbatim
// into store_image_url. That `path` can be one of three shapes:
//
//   1. A Supabase Storage object key under the `store-logos` bucket
//      → prefix with the bucket's public URL and serve.
//   2. A legacy `data:` URL from the pre-multi-logo era → use as-is.
//   3. An absolute http(s) URL (rare, supported for completeness)
//      → use as-is.
//
// All 8 consumer surfaces wrap their `store_image_url` reads in this
// helper so the disambiguation lives in one place.

const STORAGE_PREFIX = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/store-logos/`

export function publicLogoUrl(value: string | null | undefined): string | null {
  if (!value) return null
  // Legacy data URLs and any pre-existing absolute URLs pass through
  // unchanged. Anything else is a Storage object key that needs the
  // bucket prefix.
  if (value.startsWith('data:') || value.startsWith('http://') || value.startsWith('https://')) {
    return value
  }
  return STORAGE_PREFIX + value
}
