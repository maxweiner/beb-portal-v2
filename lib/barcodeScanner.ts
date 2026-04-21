/**
 * Barcode Scanner Module — wraps zxing-wasm for PDF417 decoding
 * 
 * Privacy: All decoding happens client-side via WASM. Debug mode only
 * logs format/length, never barcode content.
 */

import { readBarcodes, prepareZXingModule, ZXING_WASM_VERSION, type ReaderOptions } from 'zxing-wasm/reader'

let wasmConfigured = false
function ensureWasm() {
  if (wasmConfigured) return
  prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) => {
        if (path.endsWith('.wasm')) {
          return `https://fastly.jsdelivr.net/npm/zxing-wasm@${ZXING_WASM_VERSION}/dist/reader/${path}`
        }
        return prefix + path
      },
    },
  })
  wasmConfigured = true
}

// PDF417-only for the actual scan
const PDF417_OPTIONS: ReaderOptions = {
  formats: ['PDF417', 'CompactPDF417'],
  tryHarder: true,
  maxNumberOfSymbols: 1,
}

// All formats for diagnostics — find ANY barcode on the card
const ALL_FORMAT_OPTIONS: ReaderOptions = {
  tryHarder: true,
  maxNumberOfSymbols: 5,
}

export interface ScanResult {
  text: string
  format: string
  isPDF417: boolean
}

function downscaleImageData(imageData: ImageData, targetWidth: number): ImageData {
  if (imageData.width <= targetWidth) return imageData
  const scale = targetWidth / imageData.width
  const nw = Math.round(imageData.width * scale)
  const nh = Math.round(imageData.height * scale)

  const srcCanvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(imageData.width, imageData.height)
    : (() => { const c = document.createElement('canvas'); c.width = imageData.width; c.height = imageData.height; return c })()
  ;(srcCanvas.getContext('2d') as any).putImageData(imageData, 0, 0)

  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(nw, nh)
    : (() => { const c = document.createElement('canvas'); c.width = nw; c.height = nh; return c })()
  ;(canvas.getContext('2d') as any).drawImage(srcCanvas as any, 0, 0, nw, nh)
  return (canvas.getContext('2d') as any).getImageData(0, 0, nw, nh)
}

/**
 * Scan for PDF417 barcode. In debug mode, also scan all formats
 * and return non-PDF417 results flagged as such (for diagnostics).
 */
export async function decodePDF417FromImageData(
  imageData: ImageData,
  debug = false
): Promise<ScanResult | null> {
  ensureWasm()
  try {
    const scaled = downscaleImageData(imageData, 1280)

    // Always try PDF417 first
    const pdf417Results = await readBarcodes(scaled, PDF417_OPTIONS)
    if (pdf417Results.length > 0 && pdf417Results[0].text) {
      return { text: pdf417Results[0].text, format: pdf417Results[0].format || 'PDF417', isPDF417: true }
    }

    // In debug mode, also try all formats to see what's on the card
    if (debug) {
      const allResults = await readBarcodes(scaled, ALL_FORMAT_OPTIONS)
      if (allResults.length > 0 && allResults[0].text) {
        return {
          text: allResults[0].text,
          format: allResults[0].format || 'unknown',
          isPDF417: false,
        }
      }
    }

    return null
  } catch (err) {
    if (typeof err === 'object' && err && 'message' in err) {
      const msg = (err as Error).message
      if (msg.includes('wasm') || msg.includes('Module') || msg.includes('fetch')) {
        console.error('Barcode WASM error:', msg)
      }
    }
    return null
  }
}

export async function decodePDF417FromBlob(blob: Blob, debug = false): Promise<ScanResult | null> {
  ensureWasm()
  try {
    // Try PDF417 first
    const pdf417Results = await readBarcodes(blob, PDF417_OPTIONS)
    if (pdf417Results.length > 0 && pdf417Results[0].text) {
      return { text: pdf417Results[0].text, format: pdf417Results[0].format || 'PDF417', isPDF417: true }
    }

    // In debug mode, try all formats
    if (debug) {
      const allResults = await readBarcodes(blob, ALL_FORMAT_OPTIONS)
      if (allResults.length > 0 && allResults[0].text) {
        return { text: allResults[0].text, format: allResults[0].format || 'unknown', isPDF417: false }
      }
    }

    return null
  } catch (err) {
    if (typeof err === 'object' && err && 'message' in err) {
      console.error('Barcode scanner error:', (err as Error).message)
    }
    return null
  }
}
