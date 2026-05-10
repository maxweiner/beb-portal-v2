// Shared server-side helpers for wholesale PDFs.
// Two responsibilities:
//  - Pull brand-display details (full name + address from settings).
//  - Convert Supabase Storage paths to data URLs so @react-pdf/renderer
//    can embed them without us standing up a second HTTP fetch in the
//    Vercel function.

import { createClient } from '@supabase/supabase-js'

export const PHOTO_BUCKET = 'wholesale-photos'
export const BRAND_LOGOS_BUCKET = 'brand-logos'

export const BRAND_FULL_NAME: Record<string, string> = {
  beb:     'Beneficial Estate Buyers, LLC',
  liberty: 'Liberty Estate Buyers, LLC',
}

export const BRAND_SHORT_NAME: Record<string, string> = {
  beb:     'BEB',
  liberty: 'LIBERTY',
}

export function pdfAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

export interface BrandDisplay {
  brand: string
  brandFullName: string
  brandAddress: string | null
  brandPhone: string | null
  brandEmail: string | null
  termsAndConditions: string | null
  appraiserName: string | null
}

export async function loadBrandDisplay(brand: string): Promise<BrandDisplay> {
  const sb = pdfAdmin()
  const keys = [
    `wholesale.${brand}.address`,
    `wholesale.${brand}.phone`,
    `wholesale.${brand}.email`,
    `wholesale.${brand}.memo_terms`,
    `wholesale.${brand}.appraiser_name`,
  ]
  const { data } = await sb.from('settings').select('key, value').in('key', keys)
  const byKey = new Map<string, any>(((data || []) as any[]).map(r => [r.key, r.value]))
  const stripQuotes = (v: any) => typeof v === 'string' ? v.replace(/^"|"$/g, '') : (typeof v === 'string' ? v : null)
  return {
    brand,
    brandFullName: BRAND_FULL_NAME[brand] || brand.toUpperCase(),
    brandAddress: stripQuotes(byKey.get(`wholesale.${brand}.address`)) || null,
    brandPhone:   stripQuotes(byKey.get(`wholesale.${brand}.phone`))   || null,
    brandEmail:   stripQuotes(byKey.get(`wholesale.${brand}.email`))   || null,
    termsAndConditions: stripQuotes(byKey.get(`wholesale.${brand}.memo_terms`)) || null,
    appraiserName:      stripQuotes(byKey.get(`wholesale.${brand}.appraiser_name`)) || null,
  }
}

/** Download a storage object and return a data: URL for embedding. */
export async function storagePathToDataUrl(bucket: string, path: string): Promise<string | null> {
  const sb = pdfAdmin()
  const { data, error } = await sb.storage.from(bucket).download(path)
  if (error || !data) return null
  const buf = Buffer.from(await data.arrayBuffer())
  // crude content-type sniff — react-pdf only needs png/jpg
  const mime = path.toLowerCase().endsWith('.png') ? 'image/png'
    : path.toLowerCase().endsWith('.webp') ? 'image/webp'
    : 'image/jpeg'
  return `data:${mime};base64,${buf.toString('base64')}`
}

/** For a list of item ids, return primary-photo data URLs keyed by item_id. */
export async function loadPrimaryPhotoDataUrls(itemIds: string[]): Promise<Record<string, string>> {
  if (itemIds.length === 0) return {}
  const sb = pdfAdmin()
  const { data: photos } = await sb.from('inventory_photos')
    .select('item_id, storage_path').eq('is_primary', true).in('item_id', itemIds)
  const out: Record<string, string> = {}
  await Promise.all(((photos || []) as any[]).map(async p => {
    const url = await storagePathToDataUrl(PHOTO_BUCKET, p.storage_path)
    if (url) out[p.item_id] = url
  }))
  return out
}

/** Brand logo as a data URL for embedding in a PDF header.
 *  Reads brand_logos table → storage path → file → base64.
 *  Returns null if the brand has no configured logo. */
export async function loadBrandLogoDataUrl(brand: string): Promise<string | null> {
  const sb = pdfAdmin()
  const { data } = await sb.from('brand_logos').select('logo_path').eq('brand', brand).maybeSingle()
  const path = (data as any)?.logo_path
  if (!path) return null
  return storagePathToDataUrl(BRAND_LOGOS_BUCKET, path)
}

/** All photos (in sort order) for a single item, as data URLs. */
export async function loadAllPhotoDataUrls(itemId: string, max = 4): Promise<string[]> {
  const sb = pdfAdmin()
  const { data: photos } = await sb.from('inventory_photos')
    .select('storage_path').eq('item_id', itemId)
    .order('is_primary', { ascending: false }).order('sort_order').limit(max)
  const out: string[] = []
  for (const p of (photos || []) as any[]) {
    const url = await storagePathToDataUrl(PHOTO_BUCKET, p.storage_path)
    if (url) out.push(url)
  }
  return out
}
