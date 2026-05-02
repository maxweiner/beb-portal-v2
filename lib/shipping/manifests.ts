// Client-side helpers for shipping manifest photos. Calls the server
// routes that wrap the storage bucket + DB inserts. Image processing
// happens client-side via lib/imageUtils.processImageForUpload before
// the upload is sent.

import { supabase } from '@/lib/supabase'

export interface ShippingManifest {
  id: string
  event_id: string
  box_id: string | null     // legacy, kept for future per-box pinning
  /** Handwritten box label the buyer associated this photo with
   *  (e.g. "J1", "S2", "J3"). Free-form so custom labels are OK. */
  box_label: string | null
  file_path: string
  file_size_bytes: number
  is_scan_style: boolean
  uploaded_by: string | null
  uploaded_at: string
  deleted_at: string | null
}

const COLS = 'id, event_id, box_id, box_label, file_path, file_size_bytes, is_scan_style, uploaded_by, uploaded_at, deleted_at'

export interface EventBoxCounts { jewelry: number; silver: number }

/**
 * Per-event jewelry / silver box counts, sourced from event_shipments.
 * Events without a shipment row (typically "no hold" stores) are
 * absent from the result map — callers should treat that as 0 / 0.
 */
export async function fetchEventBoxCounts(eventIds: string[]): Promise<Record<string, EventBoxCounts>> {
  if (eventIds.length === 0) return {}
  const { data, error } = await supabase
    .from('event_shipments')
    .select('event_id, jewelry_box_count, silver_box_count')
    .in('event_id', eventIds)
  if (error) throw error
  const out: Record<string, EventBoxCounts> = {}
  for (const r of (data || []) as Array<{ event_id: string; jewelry_box_count: number; silver_box_count: number }>) {
    out[r.event_id] = {
      jewelry: Math.max(0, Math.floor(r.jewelry_box_count || 0)),
      silver:  Math.max(0, Math.floor(r.silver_box_count  || 0)),
    }
  }
  return out
}

/** All live (non-deleted) manifests across a list of event ids. */
export async function fetchManifestsForEvents(eventIds: string[]): Promise<ShippingManifest[]> {
  if (eventIds.length === 0) return []
  const { data, error } = await supabase
    .from('shipping_manifests')
    .select(COLS)
    .in('event_id', eventIds)
    .is('deleted_at', null)
    .order('uploaded_at', { ascending: false })
  if (error) throw error
  return (data || []) as ShippingManifest[]
}

/**
 * Sign a manifest photo for viewing (1-hour TTL). Goes through the
 * server route so service-role does the signing and RLS doesn't depend
 * on the browser having a fresh Supabase Auth JWT — matches how every
 * other private bucket in this app issues signed URLs.
 */
export async function signManifestUrl(manifestId: string): Promise<string> {
  const { data: session } = await supabase.auth.getSession()
  const token = session.session?.access_token
  const res = await fetch(`/api/shipping/manifests/${manifestId}/sign`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json?.signedUrl) {
    throw new Error(json?.error || `Sign failed (${res.status})`)
  }
  return json.signedUrl as string
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
  eventId: string
  blob: Blob
  isScanStyle: boolean
  boxLabel: string
}): Promise<ShippingManifest> {
  const { data: session } = await supabase.auth.getSession()
  const token = session.session?.access_token
  const fd = new FormData()
  fd.append('file', input.blob, 'manifest.jpg')
  fd.append('is_scan_style', String(input.isScanStyle))
  fd.append('box_label', input.boxLabel)
  const res = await fetch(`/api/shipping/events/${input.eventId}/manifests/upload`, {
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
