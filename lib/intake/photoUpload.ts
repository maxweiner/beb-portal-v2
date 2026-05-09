/**
 * Photo upload helpers for the intake → purchase flow.
 *
 * Reuses the existing `license-photos` Supabase Storage bucket. Path scheme:
 *
 *   {event_id}/{intake_id}/front.jpg
 *   {event_id}/{intake_id}/back.jpg
 *   {event_id}/{intake_id}/invoice.jpg
 *   {event_id}/{intake_id}/jewelry-1.jpg ... jewelry-5.jpg
 *
 * Compression mirrors lib/licensePhotoUtils — max 1200px on the long edge,
 * JPEG quality 0.8. Server-side processing in Phase 2 will pull the original
 * stored file (not the signed URL) so this compression isn't a problem for
 * downstream OCR / PDF417 decode.
 */

import { supabase } from '@/lib/supabase'
import { compressLicensePhoto } from '@/lib/licensePhotoUtils'

export type IntakePhotoKind = 'front' | 'back' | 'invoice' | 'jewelry'

const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 365  // 1 year

interface UploadOptions {
  eventId: string
  intakeId: string
  kind: IntakePhotoKind
  /** 1..5 — only meaningful for kind='jewelry'. Ignored otherwise. */
  index?: number
}

export async function uploadIntakePhoto(blob: Blob, opts: UploadOptions): Promise<string> {
  const compressed = await compressLicensePhoto(blob)
  const filename = opts.kind === 'jewelry'
    ? `jewelry-${opts.index ?? 1}.jpg`
    : `${opts.kind}.jpg`
  const path = `${opts.eventId}/${opts.intakeId}/${filename}`

  const { error: uploadError } = await supabase.storage
    .from('license-photos')
    .upload(path, compressed, {
      contentType: 'image/jpeg',
      upsert: true,
    })
  if (uploadError) throw new Error(`Upload failed (${opts.kind}): ${uploadError.message}`)

  const { data, error } = await supabase.storage
    .from('license-photos')
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
  if (error || !data?.signedUrl) {
    throw new Error(`Sign failed (${opts.kind}): ${error?.message || 'no URL'}`)
  }
  return data.signedUrl
}
