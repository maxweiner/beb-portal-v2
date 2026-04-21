/**
 * License Photo Utilities
 * 
 * Handles compression and upload of license front-side photos
 * to Supabase Storage (private bucket).
 */

import { supabase } from '@/lib/supabase'

const MAX_DIMENSION = 1200
const JPEG_QUALITY = 0.8

export async function compressLicensePhoto(file: File | Blob): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)

    img.onload = () => {
      URL.revokeObjectURL(url)
      let w = img.width
      let h = img.height

      if (w > MAX_DIMENSION || h > MAX_DIMENSION) {
        if (w > h) {
          h = Math.round(h * MAX_DIMENSION / w)
          w = MAX_DIMENSION
        } else {
          w = Math.round(w * MAX_DIMENSION / h)
          h = MAX_DIMENSION
        }
      }

      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)

      canvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error('Compression failed')),
        'image/jpeg',
        JPEG_QUALITY
      )
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load image'))
    }

    img.src = url
  })
}

export function dataURLtoBlob(dataURL: string): Blob {
  const parts = dataURL.split(',')
  const mime = parts[0].match(/:(.*?);/)?.[1] || 'image/jpeg'
  const binary = atob(parts[1])
  const array = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    array[i] = binary.charCodeAt(i)
  }
  return new Blob([array], { type: mime })
}

/**
 * Upload license front photo to Supabase Storage.
 * Path: {event_id}/{intake_id}.jpg
 */
export async function uploadLicensePhoto(
  blob: Blob,
  eventId: string,
  intakeId: string
): Promise<string> {
  const path = `${eventId}/${intakeId}.jpg`

  const { error: uploadError } = await supabase.storage
    .from('license-photos')
    .upload(path, blob, {
      contentType: 'image/jpeg',
      upsert: true,
    })

  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`)

  // Private bucket — use signed URL instead of public
  const { data: urlData, error: urlError } = await supabase.storage
    .from('license-photos')
    .createSignedUrl(path, 60 * 60 * 24 * 365) // 1 year signed URL

  if (urlError || !urlData?.signedUrl) {
    throw new Error('Failed to generate signed URL')
  }

  return urlData.signedUrl
}
