// QR-center logo helper: rectangular store logos look squished when
// dropped into the QR center (qrcode.react squeezes the source image
// to whatever width × height we give it). This module produces a
// SQUARE data URL by either:
//   1. Letterboxing the source logo on a white background, OR
//   2. Rendering the store's initials on the store's primary color
//      (used as a fallback when no logo exists)
//
// Output is a base64 data URL safe to embed in the SVG/PNG downloads
// without CORS taint. Cached in module-scope by source URL so we
// don't redraw on every render.

const cache = new Map<string, string>()

/** "ABC Jewelers" → "AJ"; "Smith" → "S"; "AAA Diamond Buyers" → "AD" (skips first if it duplicates) */
export function makeInitials(name: string): string {
  if (!name) return '?'
  const words = name
    .replace(/[^A-Za-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  if (words.length === 0) return name.slice(0, 2).toUpperCase()
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  // Two-word default. For longer names, take first + last word.
  const first = words[0][0]
  const last = (words.length >= 3 ? words[words.length - 1] : words[1])[0]
  return (first + last).toUpperCase()
}

/**
 * Returns a square data URL for the QR center.
 * - If logoUrl is set: load the image and letterbox it onto a white
 *   square so wide logos don't get squeezed vertically.
 * - If no logoUrl: render initials in white on the store's color.
 *
 * Returns null until the source image loads (or immediately for the
 * initials path). Pass the result to qrcode.react's imageSettings.src.
 */
export async function makeSquareLogoDataUrl(opts: {
  logoUrl: string | null | undefined
  storeName: string
  color: string  // store primary color hex, e.g. "#1D6B44"
  size?: number  // output square dimension in px (default 256)
}): Promise<string> {
  const size = opts.size ?? 256
  const cacheKey = `${opts.logoUrl ?? ''}::${opts.storeName}::${opts.color}::${size}`
  const hit = cache.get(cacheKey)
  if (hit) return hit

  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!

  if (opts.logoUrl) {
    // Try to load + letterbox
    try {
      const img = await loadImage(opts.logoUrl)
      // White background so transparent PNGs read clean
      ctx.fillStyle = '#FFFFFF'
      ctx.fillRect(0, 0, size, size)
      const ratio = img.naturalWidth / img.naturalHeight
      let drawW = size, drawH = size, dx = 0, dy = 0
      if (ratio > 1) {
        // Wider than tall — fit to width
        drawH = size / ratio
        dy = (size - drawH) / 2
      } else if (ratio < 1) {
        // Taller than wide — fit to height
        drawW = size * ratio
        dx = (size - drawW) / 2
      }
      ctx.drawImage(img, dx, dy, drawW, drawH)
      const url = canvas.toDataURL('image/png')
      cache.set(cacheKey, url)
      return url
    } catch {
      // Fall through to initials path on load failure (CORS, 404, etc.)
    }
  }

  // Initials path
  const initials = makeInitials(opts.storeName)
  ctx.fillStyle = opts.color || '#1D6B44'
  ctx.fillRect(0, 0, size, size)
  ctx.fillStyle = '#FFFFFF'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  // Font size scales with initials length so 2-char fits comfortably
  const fontSize = initials.length === 1 ? size * 0.6 : size * 0.42
  ctx.font = `900 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
  ctx.fillText(initials, size / 2, size / 2 + size * 0.04)  // tiny optical-center nudge
  const url = canvas.toDataURL('image/png')
  cache.set(cacheKey, url)
  return url
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    // Cross-origin handling for non-data URLs. Data URLs (the common
    // case here, since stores.store_image_url is stored as a data URL)
    // don't trigger CORS so this is a no-op for them.
    if (!src.startsWith('data:')) img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Image load failed'))
    img.src = src
  })
}
