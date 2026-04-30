interface ProcessOpts {
  /** Max edge length in pixels — defaults to 2000 (manifest spec). */
  maxEdge?: number
  /** JPEG quality 0..1 — defaults to 0.8 (manifest spec). */
  quality?: number
  /** When true, applies grayscale + a contrast curve so the result
   *  reads like a document scan instead of a color photo. */
  scanStyle?: boolean
}

/**
 * Process an image for the manifest upload pipeline. Resizes to a
 * max edge, optionally applies a "scan-style" grayscale + contrast
 * curve, encodes as JPEG. Returns a Blob ready for upload + the
 * final byte size.
 *
 * Scan style: BT.709 luminance → grayscale, then a piecewise contrast
 * curve that pushes mid-greys to either black (text) or white (paper).
 * No adaptive thresholding in v1; that can come if results are poor on
 * shadowed photos.
 */
export async function processImageForUpload(
  source: File,
  opts: ProcessOpts = {},
): Promise<{ blob: Blob; bytes: number }> {
  const maxEdge = opts.maxEdge ?? 2000
  const quality = opts.quality ?? 0.8
  const dataUrl: string = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(source)
  })

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image()
    i.onload = () => resolve(i)
    i.onerror = () => reject(new Error('Failed to load image'))
    i.src = dataUrl
  })

  let { width, height } = img
  if (width > maxEdge || height > maxEdge) {
    const r = maxEdge / Math.max(width, height)
    width = Math.round(width * r)
    height = Math.round(height * r)
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0, width, height)

  if (opts.scanStyle) {
    const id = ctx.getImageData(0, 0, width, height)
    const d = id.data
    for (let i = 0; i < d.length; i += 4) {
      // BT.709 luminance.
      const y = (d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722) | 0
      // Contrast curve: stretch around the mid, clamp the tails.
      // Below 110 → darken aggressively; above 180 → push to white;
      // middle values bounce smoothly between.
      let v: number
      if (y <= 110)      v = Math.max(0, Math.round((y / 110) * 60))
      else if (y >= 180) v = 255
      else               v = Math.round(60 + ((y - 110) / 70) * 195)
      d[i] = d[i + 1] = d[i + 2] = v
    }
    ctx.putImageData(id, 0, 0)
  }

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      b => b ? resolve(b) : reject(new Error('Encode failed')),
      'image/jpeg', quality,
    )
  })
  return { blob, bytes: blob.size }
}

/**
 * Compress and resize an image from a File.
 * Returns a base64 data URL (image/jpeg).
 */
export async function compressImage(
  source: File | string,
  maxWidth = 1200,
  quality = 0.7
): Promise<string> {
  // If source is a File, read it first
  const dataUrl: string = await new Promise((resolve, reject) => {
    if (typeof source === 'string') {
      resolve(source)
    } else {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(new Error('Failed to read file'))
      reader.readAsDataURL(source)
    }
  })

  // Now load it as an image
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        let { width, height } = img

        if (width > maxWidth) {
          height = Math.round(height * (maxWidth / width))
          width = maxWidth
        }

        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0, width, height)

        const result = canvas.toDataURL('image/jpeg', quality)
        resolve(result)
      } catch (err) {
        reject(err)
      }
    }
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = dataUrl
  })
}

/**
 * Upload a base64 image to Supabase Storage and return the public URL.
 */
export async function uploadToStorage(
  supabase: any,
  base64DataUrl: string,
  folder: string,
  filename: string
): Promise<string> {
  const res = await fetch(base64DataUrl)
  const blob = await res.blob()

  const path = `${folder}/${filename}`
  const { error } = await supabase.storage
    .from('receipt-images')
    .upload(path, blob, {
      contentType: 'image/jpeg',
      upsert: true,
    })

  if (error) throw error

  const { data } = supabase.storage
    .from('receipt-images')
    .getPublicUrl(path)

  return data.publicUrl
}
