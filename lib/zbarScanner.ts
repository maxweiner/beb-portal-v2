/**
 * ZBar Scanner — alternative to zxing-wasm for PDF417.
 *
 * ZBar's C decoder handles dense / damaged PDF417 differently than zxing.
 * Running both engines on alternating frames gives us coverage neither
 * one alone provides — especially helpful for state licenses (PA, NJ)
 * that pack more data into the same physical barcode area.
 *
 * Privacy: pure WASM, runs entirely client-side, never uploads.
 */

import { scanImageData, setModuleArgs, ZBarSymbolType } from '@undecaf/zbar-wasm'

// Match the URL pattern used by lib/barcodeScanner.ts so both wasms come
// from the same CDN. Pinned to the package version we installed.
const ZBAR_VERSION = '0.11.0'
let wasmConfigured = false
function ensureWasm() {
  if (wasmConfigured) return
  setModuleArgs({
    locateFile: (filename: string) => {
      if (filename.endsWith('.wasm')) {
        return `https://fastly.jsdelivr.net/npm/@undecaf/zbar-wasm@${ZBAR_VERSION}/dist/${filename}`
      }
      return filename
    },
  })
  wasmConfigured = true
}

export interface ZBarScanResult {
  text: string
  format: string
  isPDF417: boolean
}

/**
 * Scan an ImageData for a PDF417 barcode using ZBar.
 * Returns the first PDF417 hit, or — if `debug` is true — the first
 * non-PDF417 symbol seen (so callers can surface "saw QR" diagnostics).
 */
export async function decodePDF417FromImageDataZbar(
  imageData: ImageData,
  debug = false,
): Promise<ZBarScanResult | null> {
  ensureWasm()
  try {
    const symbols = await scanImageData(imageData)
    if (!symbols || symbols.length === 0) return null

    // PDF417 first — that's what we actually want.
    for (const sym of symbols) {
      if (sym.type === ZBarSymbolType.ZBAR_PDF417) {
        const text = sym.decode()
        if (text) {
          return { text, format: 'PDF417', isPDF417: true }
        }
      }
    }

    // In debug mode, surface anything else for diagnostics.
    if (debug) {
      const first = symbols[0]
      const text = first.decode()
      return { text: text || '', format: first.typeName || 'unknown', isPDF417: false }
    }

    return null
  } catch (err) {
    if (typeof err === 'object' && err && 'message' in err) {
      const msg = (err as Error).message
      if (msg.includes('wasm') || msg.includes('Module') || msg.includes('fetch')) {
        console.error('ZBar WASM error:', msg)
      }
    }
    return null
  }
}
