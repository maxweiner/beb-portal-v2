/**
 * Canvas-based image enhancement pipeline for barcode decoding.
 *
 * Operates on ImageData — no DOM. Callers draw a video frame or image to a
 * hidden canvas, pull ImageData via getImageData, pass it through the pipeline,
 * and putImageData back before handing to the decoder.
 *
 * The transforms are tuned for dense, laminated PDF417 symbols under harsh
 * retail lighting (fluorescent overheads, glass case glare). They are NOT
 * general-purpose photo filters.
 */

/** Convert RGBA ImageData to luminance-equivalent grayscale, in-place. */
function toGrayscale(imageData: ImageData): ImageData {
  const d = imageData.data
  for (let i = 0; i < d.length; i += 4) {
    // BT.709 luminance weights — matches how humans perceive brightness.
    const y = (d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722) | 0
    d[i] = d[i + 1] = d[i + 2] = y
  }
  return imageData
}

/**
 * Contrast stretch (percentile-clipped linear histogram stretch).
 * Maps the 2nd–98th percentile of pixel values to 0–255, dropping the
 * extreme 2% tails to avoid getting wrecked by a single specular highlight.
 *
 * Assumes `imageData` is already grayscale (R === G === B).
 */
function enhanceContrast(imageData: ImageData, clip = 0.02): ImageData {
  const d = imageData.data
  const hist = new Uint32Array(256)
  for (let i = 0; i < d.length; i += 4) hist[d[i]]++

  const totalPixels = d.length / 4
  const lowCount = totalPixels * clip
  const highCount = totalPixels * (1 - clip)

  let lo = 0, hi = 255
  let acc = 0
  for (let v = 0; v < 256; v++) {
    acc += hist[v]
    if (acc >= lowCount) { lo = v; break }
  }
  acc = 0
  for (let v = 0; v < 256; v++) {
    acc += hist[v]
    if (acc >= highCount) { hi = v; break }
  }
  if (hi <= lo) return imageData // degenerate — don't touch

  const scale = 255 / (hi - lo)
  for (let i = 0; i < d.length; i += 4) {
    let v = (d[i] - lo) * scale
    if (v < 0) v = 0
    else if (v > 255) v = 255
    d[i] = d[i + 1] = d[i + 2] = v | 0
  }
  return imageData
}

/**
 * 3×3 unsharp-mask convolution kernel. Emphasizes bar edges by subtracting
 * a softened copy of the center pixel's neighborhood.
 *
 *   0  -1   0
 *  -1   5  -1
 *   0  -1   0
 */
function sharpen(imageData: ImageData): ImageData {
  const { width: w, height: h, data: src } = imageData
  const out = new Uint8ClampedArray(src.length)
  const rowStride = w * 4

  // Copy borders through untouched (convolution undefined at edges).
  for (let i = 0; i < rowStride; i++) out[i] = src[i]
  for (let i = src.length - rowStride; i < src.length; i++) out[i] = src[i]

  for (let y = 1; y < h - 1; y++) {
    const rowStart = y * rowStride
    out[rowStart] = src[rowStart]
    out[rowStart + 1] = src[rowStart + 1]
    out[rowStart + 2] = src[rowStart + 2]
    out[rowStart + 3] = src[rowStart + 3]

    for (let x = 1; x < w - 1; x++) {
      const i = rowStart + x * 4
      // Only need one channel — grayscale input means R === G === B
      const c  = src[i]
      const n  = src[i - rowStride]
      const s  = src[i + rowStride]
      const e  = src[i + 4]
      const wp = src[i - 4]
      let v = 5 * c - n - s - e - wp
      if (v < 0) v = 0
      else if (v > 255) v = 255
      out[i] = out[i + 1] = out[i + 2] = v
      out[i + 3] = src[i + 3]
    }

    // Right-edge pixel — copy through
    const rx = rowStart + (w - 1) * 4
    out[rx] = src[rx]
    out[rx + 1] = src[rx + 1]
    out[rx + 2] = src[rx + 2]
    out[rx + 3] = src[rx + 3]
  }

  src.set(out)
  return imageData
}

/**
 * Otsu's method threshold — computes the intensity that best separates the
 * histogram into two classes (ink and paper) by maximizing between-class
 * variance.
 */
function otsuThreshold(imageData: ImageData): number {
  const d = imageData.data
  const hist = new Uint32Array(256)
  let total = 0
  for (let i = 0; i < d.length; i += 4) { hist[d[i]]++; total++ }

  let sumAll = 0
  for (let v = 0; v < 256; v++) sumAll += v * hist[v]

  let sumB = 0
  let wB = 0
  let maxVar = 0
  let threshold = 127
  for (let v = 0; v < 256; v++) {
    wB += hist[v]
    if (wB === 0) continue
    const wF = total - wB
    if (wF === 0) break
    sumB += v * hist[v]
    const mB = sumB / wB
    const mF = (sumAll - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > maxVar) {
      maxVar = between
      threshold = v
    }
  }
  return threshold
}

/** Binarize to pure black/white. `threshold` defaults to Otsu-computed. */
function binarize(imageData: ImageData, threshold?: number): ImageData {
  const d = imageData.data
  const t = threshold ?? otsuThreshold(imageData)
  for (let i = 0; i < d.length; i += 4) {
    const bw = d[i] >= t ? 255 : 0
    d[i] = d[i + 1] = d[i + 2] = bw
  }
  return imageData
}

interface PipelineOptions {
  /** Apply binarize step as the final pass. Off by default — many decoders
   *  prefer grayscale-contrast-sharpened input; binarize can erase fine
   *  bars if the threshold is wrong. Flip on for the upload/retry path. */
  binarize?: boolean
  /** Skip contrast stretching — useful if caller pre-stretches. */
  skipContrast?: boolean
  /** Skip sharpening — useful on very low-res inputs where sharpening
   *  amplifies noise more than signal. */
  skipSharpen?: boolean
}

/**
 * Full preprocessing pipeline: grayscale → contrast stretch → sharpen →
 * (optional) binarize.
 *
 * Mutates and returns the input ImageData.
 */
export function processForBarcode(
  imageData: ImageData,
  opts: PipelineOptions = {},
): ImageData {
  toGrayscale(imageData)
  if (!opts.skipContrast) enhanceContrast(imageData)
  if (!opts.skipSharpen)  sharpen(imageData)
  if (opts.binarize)      binarize(imageData)
  return imageData
}
