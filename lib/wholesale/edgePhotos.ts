// Photo bundling for Edge wholesale-export batches.
//
// At send time we copy each selected item's photos out of the live
// `wholesale-photos` bucket into a frozen, predictably-named layout
// inside `edge-batches/{batch_code}/`. Two reasons to copy rather than
// link directly to the live paths:
//
//   1. The CSV references filenames like `EDGE-20260512-A4F2_L-1042_1.jpg`.
//      Mary's downloader expects that naming on disk.
//   2. The live photo for an item can change after send. A batch must
//      remain reproducible — the copied files are immutable artifacts.
//
// Photos are stored in the same `wholesale-photos` bucket under a
// distinct prefix to keep RLS / storage policy simple (no new bucket
// to provision). The public batch page reads them with the service-
// role client, so users don't need direct bucket access.

import { pdfAdmin, PHOTO_BUCKET } from './pdfHelpers'

export interface ItemPhotoCopyInput {
  itemId: string
  /** Frozen item_number as it appears in the batch (used for filename). */
  itemNumberFrozen: string
}

export interface ItemPhotoCopyResult {
  itemId: string
  /** Storage paths INSIDE the bucket, e.g.
   *  'edge-batches/EDGE-20260512-A4F2/EDGE-20260512-A4F2_L-1042_1.jpg' */
  copiedPaths: string[]
  /** Just the filenames (no folder), for the CSV `photo_filenames` cell. */
  filenames: string[]
}

export interface BundleResult {
  perItem: ItemPhotoCopyResult[]
  totalPhotos: number
  /** Folder path inside the bucket. */
  mediaFolder: string
}

/**
 * Copy each item's photos into the batch folder with friendly names.
 * Best-effort: a single failed photo is logged but doesn't fail the
 * whole batch.
 */
export async function bundleBatchPhotos(
  batchCode: string,
  items: ItemPhotoCopyInput[],
): Promise<BundleResult> {
  const sb = pdfAdmin()
  const mediaFolder = `edge-batches/${batchCode}`

  // Pull every photo for every item in a single query.
  const itemIds = items.map(i => i.itemId)
  const { data: photos, error } = await sb.from('inventory_photos')
    .select('item_id, storage_path, is_primary, sort_order')
    .in('item_id', itemIds.length ? itemIds : ['00000000-0000-0000-0000-000000000000'])
    .order('is_primary', { ascending: false })
    .order('sort_order', { ascending: true })
  if (error) {
    console.warn('[edgePhotos] photo load failed:', error.message)
  }

  // Group + sort photos per item.
  const byItem = new Map<string, { storage_path: string }[]>()
  for (const p of (photos || []) as any[]) {
    const arr = byItem.get(p.item_id) || []
    arr.push({ storage_path: p.storage_path })
    byItem.set(p.item_id, arr)
  }

  const perItem: ItemPhotoCopyResult[] = []
  let totalPhotos = 0
  for (const it of items) {
    const itemPhotos = byItem.get(it.itemId) || []
    const copiedPaths: string[] = []
    const filenames: string[] = []
    let n = 0
    for (const p of itemPhotos) {
      n += 1
      const ext = extractExt(p.storage_path) || 'jpg'
      const safeSku = it.itemNumberFrozen.replace(/[^A-Za-z0-9._-]/g, '_')
      const filename = `${batchCode}_${safeSku}_${n}.${ext}`
      const dest = `${mediaFolder}/${filename}`
      const ok = await copyStorageObject(p.storage_path, dest)
      if (ok) {
        copiedPaths.push(dest)
        filenames.push(filename)
        totalPhotos += 1
      } else {
        console.warn(`[edgePhotos] failed to copy ${p.storage_path} -> ${dest}`)
      }
    }
    perItem.push({ itemId: it.itemId, copiedPaths, filenames })
  }

  return { perItem, totalPhotos, mediaFolder }
}

/** Supabase Storage doesn't have a server-side copy — we round-trip
 *  download → upload. Sizes here are jewelry photos (a few MB tops);
 *  no streaming complexity needed. */
async function copyStorageObject(srcPath: string, destPath: string): Promise<boolean> {
  const sb = pdfAdmin()
  try {
    const { data, error: dlErr } = await sb.storage.from(PHOTO_BUCKET).download(srcPath)
    if (dlErr || !data) return false
    const buf = Buffer.from(await data.arrayBuffer())
    const contentType = mimeFromPath(destPath)
    const { error: upErr } = await sb.storage.from(PHOTO_BUCKET).upload(destPath, buf, {
      contentType,
      upsert: true,           // idempotent rebundles
      cacheControl: '31536000',
    })
    return !upErr
  } catch (e) {
    console.warn('[edgePhotos] copy threw:', e)
    return false
  }
}

function extractExt(p: string): string | null {
  const m = /\.([A-Za-z0-9]{2,5})$/.exec(p)
  return m ? m[1].toLowerCase() : null
}

function mimeFromPath(p: string): string {
  const ext = extractExt(p)
  switch (ext) {
    case 'png':  return 'image/png'
    case 'webp': return 'image/webp'
    case 'gif':  return 'image/gif'
    case 'heic': return 'image/heic'
    case 'mp4':  return 'video/mp4'
    case 'mov':  return 'video/quicktime'
    default:     return 'image/jpeg'
  }
}

/** Mint a short-lived signed URL for a copied batch photo. Used by the
 *  public batch page so Mary can view + download without auth. */
export async function signBatchPhotoUrl(storagePath: string, expiresInSeconds = 60 * 60 * 24): Promise<string | null> {
  const sb = pdfAdmin()
  const { data, error } = await sb.storage.from(PHOTO_BUCKET).createSignedUrl(storagePath, expiresInSeconds, {
    download: storagePath.split('/').pop() || undefined,
  })
  if (error || !data?.signedUrl) return null
  return data.signedUrl
}
