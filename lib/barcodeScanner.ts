/**
 * Barcode Scanner Module — wraps zxing-wasm for PDF417 decoding
 * 
 * Privacy: All decoding happens client-side via WASM. No barcode data
 * is sent to any external service. Debug mode logs format/length only,
 * never barcode content.
 */

import { readBarcodes, prepareZXingModule, ZXING_WASM_VERSION, type ReaderOptions } from 'zxing-wasm/reader'

// Ensure WASM binary loads from CDN
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

// Accept PDF417 and CompactPDF417 — driver's licenses use both
const READER_OPTIONS: ReaderOptions = {
  formats: ['PDF417', 'CompactPDF417'],
  tryHarder: true,
  maxNumberOfSymbols: 1,
}

// Broader options for debug — try ALL formats to confirm scanner works
const DEBUG_READER_OPTIONS: ReaderOptions = {
  tryHarder: true,
  maxNumberOfSymbols: 3,
}

export interface ScanResult {
  text: string
  format: string
}

/**
 * Downscale ImageData to improve decode speed and reliability.
 * Returns a new ImageData at the target width.
 */
function downscaleImageData(imageData: ImageData, targetWidth: number): ImageData {
  if (imageData.width <= targetWidth) return imageData

  const scale = targetWidth / imageData.width
  const newWidth = Math.round(imageData.width * scale)
  const newHeight = Math.round(imageData.height * scale)

  // Use OffscreenCanvas if available, otherwise regular canvas
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(newWidth, newHeight)
    : (() => { const c = document.createElement('canvas'); c.width = newWidth; c.height = newHeight; return c })()

  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  
  // Draw original ImageData to a temp canvas first
  const srcCanvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(imageData.width, imageData.height)
    : (() => { const c = document.createElement('canvas'); c.width = imageData.width; c.height = imageData.height; return c })()
  const srcCtx = srcCanvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  srcCtx.putImageData(imageData, 0, 0)

  ctx.drawImage(srcCanvas as any, 0, 0, newWidth, newHeight)
  return ctx.getImageData(0, 0, newWidth, newHeight)
}

/**
 * Decode PDF417 barcode from ImageData (canvas frame).
 * Downscales to ~1280px width for better performance.
 */
export async function decodePDF417FromImageData(
  imageData: ImageData, 
  debug = false
): Promise<ScanResult | null> {
  ensureWasm()
  try {
    // Downscale for speed — 1280px is enough for PDF417
    const scaled = downscaleImageData(imageData, 1280)
    
    const options = debug ? DEBUG_READER_OPTIONS : READER_OPTIONS
    const results = await readBarcodes(scaled, options)

    if (results.length > 0 && results[0].text) {
      if (debug) {
        // Log format and text length only — NEVER log content
        console.log(`[barcode-debug] Found: format=${results[0].format}, length=${results[0].text.length}`)
      }
      return {
        text: results[0].text,
        format: results[0].format || 'unknown',
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

/**
 * Decode PDF417 from Blob/File (upload fallback).
 */
export async function decodePDF417FromBlob(blob: Blob, debug = false): Promise<ScanResult | null> {
  ensureWasm()
  try {
    const options = debug ? DEBUG_READER_OPTIONS : READER_OPTIONS
    const results = await readBarcodes(blob, options)

    if (results.length > 0 && results[0].text) {
      if (debug) {
        console.log(`[barcode-debug] Found in upload: format=${results[0].format}, length=${results[0].text.length}`)
      }
      return {
        text: results[0].text,
        format: results[0].format || 'unknown',
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
