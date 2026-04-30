// Client-side helpers for shipping manifest photos. Calls the server
// routes that wrap the storage bucket + DB inserts. Image processing
// happens client-side via lib/imageUtils.processImageForUpload before
// the upload is sent.

import { supabase } from '@/lib/supabase'

export interface ShippingManifest {
  id: string
  box_id: string
  file_path: string
  file_size_bytes: number
  is_scan_style: boolean
  uploaded_by: string | null
  uploaded_at: string
  deleted_at: string | null
}

const COLS = 'id, box_id, file_path, file_size_bytes, is_scan_style, uploaded_by, uploaded_at, deleted_at'

/** All live (non-deleted) manifests across a list of box ids. */
export async function fetchManifestsForBoxes(boxIds: string[]): Promise<ShippingManifest[]> {
  if (boxIds.length === 0) return []
  const { data, error } = await supabase
    .from('shipping_manifests')
    .select(COLS)
    .in('box_id', boxIds)
    .is('deleted_at', null)
    .order('uploaded_at', { ascending: false })
  if (error) throw error
  return (data || []) as ShippingManifest[]
}

/** Sign a storage path for viewing. TTL = 1 hour. */
export async function signManifestUrl(filePath: string, ttlSeconds = 3600): Promise<string> {
  const { data, error } = await supabase.storage
    .from('manifests')
    .createSignedUrl(filePath, ttlSeconds)
  if (error || !data) throw error || new Error('No signed URL')
  return data.signedUrl
}

/** Soft-delete (sets deleted_at). 30-day cron will hard-purge later. */
export async function softDeleteManifest(id: string): Promise<void> {
  const { error } = await supabase.from('shipping_manifests')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

/**
 * POST a processed JPEG blob to the upload route. The server uploads
 * to the private bucket via service role and inserts the manifest row.
 * Returns the new row.
 */
export async function uploadManifest(input: {
  boxId: string
  blob: Blob
  isScanStyle: boolean
}): Promise<ShippingManifest> {
  const { data: session } = await supabase.auth.getSession()
  const token = session.session?.access_token
  const fd = new FormData()
  fd.append('file', input.blob, 'manifest.jpg')
  fd.append('is_scan_style', String(input.isScanStyle))
  const res = await fetch(`/api/shipping/boxes/${input.boxId}/manifests/upload`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: fd,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json?.manifest) {
    throw new Error(json?.error || `Upload failed (${res.status})`)
  }
  return json.manifest as ShippingManifest
}
