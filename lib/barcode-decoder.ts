/**
 * Layered barcode decoder.
 *
 * Layer 1 — native BarcodeDetector API (Chromium only; uses OS-level ML
 *           decoder, dramatically better than anything JS can ship).
 * Layer 2 — zxing-wasm + canvas preprocessing pipeline (works everywhere
 *           with a camera; fallback for iOS Safari / Firefox).
 * Layer 3 — photo upload (handled in the LicenseScanner component).
 *
 * Privacy: both layers decode entirely client-side. No raw barcode content
 * is logged — callers receive a string and are expected to discard it after
 * parsing.
 */

import { decodePDF417FromImageData, decodePDF417FromBlob } from './barcodeScanner'
import { processForBarcode } from './image-processing'

export type DecoderStrategy = 'native' | 'zxing' | 'upload-only'

/** Lightweight diagnostic snapshot the decoder pushes to callers each
 *  attempt. Lets the scanner UI surface "we're scanning, this many frames
 *  attempted, last format detected (if any)" so a user staring at a stuck
 *  viewfinder knows whether the issue is the camera or the barcode. */
export interface ScanDiagnostics {
  attempts: number
  /** Last barcode format any decoder saw — even if it wasn't PDF417. Useful
   *  signal: if this stays empty, image quality / focus is the issue. If it
   *  shows a non-PDF417 format, the camera is fine but the PDF417 either
   *  isn't framed or its modules are too small. */
  lastFormatSeen?: string | null
}

export interface BarcodeDecoder {
  readonly strategy: 'native' | 'zxing'
  /** Continuously scan a live video element. Calls `onResult` on first
   *  successful decode. Caller is expected to invoke `stop()` afterwards.
   *  `onDiagnostic` (optional) fires once per attempt with progress info. */
  startScanning(
    video: HTMLVideoElement,
    onResult: (raw: string) => void,
    onDiagnostic?: (d: ScanDiagnostics) => void,
  ): void
  /** One-shot decode of a static image or blob (upload fallback). */
  decodeImage(image: HTMLImageElement | Blob): Promise<string | null>
  /** Halt the scanning loop and release any resources. */
  stop(): void
}

/**
 * Probe the current environment for the best decoder strategy.
 * Cheap, safe to call on every mount.
 */
export async function getDecoderStrategy(): Promise<DecoderStrategy> {
  if (typeof window === 'undefined') return 'upload-only'

  // Layer 1 — native BarcodeDetector with PDF417 support?
  const w = window as any
  if (typeof w.BarcodeDetector === 'function') {
    try {
      const formats: string[] = await w.BarcodeDetector.getSupportedFormats()
      if (formats.includes('pdf417')) return 'native'
    } catch {
      // Some browsers expose the constructor but throw on getSupportedFormats —
      // fall through to zxing.
    }
  }

  // Layer 2 — camera + zxing?
  if (typeof navigator !== 'undefined'
      && navigator.mediaDevices
      && typeof navigator.mediaDevices.getUserMedia === 'function') {
    return 'zxing'
  }

  // Layer 3 — nothing works live, caller must show upload UI.
  return 'upload-only'
}

/* ───────────────────────── Layer 1 ───────────────────────── */

class NativeBarcodeDecoder implements BarcodeDecoder {
  readonly strategy = 'native' as const
  private detector: any
  private rafId: number | null = null
  private running = false
  private lastAttempt = 0
  private attempts = 0

  constructor() {
    const w = window as any
    this.detector = new w.BarcodeDetector({ formats: ['pdf417'] })
  }

  startScanning(
    video: HTMLVideoElement,
    onResult: (raw: string) => void,
    onDiagnostic?: (d: ScanDiagnostics) => void,
  ) {
    this.running = true
    this.attempts = 0
    const MIN_INTERVAL_MS = 300

    const tick = async (t: number) => {
      if (!this.running) return
      if (t - this.lastAttempt < MIN_INTERVAL_MS) {
        this.rafId = requestAnimationFrame(tick)
        return
      }
      this.lastAttempt = t

      if (video.readyState < 2 || video.videoWidth === 0) {
        this.rafId = requestAnimationFrame(tick)
        return
      }

      try {
        this.attempts++
        const results = await this.detector.detect(video)
        if (!this.running) return
        if (results && results.length > 0 && results[0].rawValue) {
          const raw = results[0].rawValue as string
          this.stop()
          onResult(raw)
          return
        }
        onDiagnostic?.({ attempts: this.attempts, lastFormatSeen: null })
      } catch {
        // Detector may throw transiently on frame that isn't ready yet.
      }

      if (this.running) this.rafId = requestAnimationFrame(tick)
    }

    this.rafId = requestAnimationFrame(tick)
  }

  async decodeImage(image: HTMLImageElement | Blob): Promise<string | null> {
    try {
      let source: HTMLImageElement | ImageBitmap
      if (image instanceof Blob) {
        source = await createImageBitmap(image)
      } else {
        source = image
        if (!image.complete) await image.decode()
      }
      const results = await this.detector.detect(source)
      if (results && results.length > 0 && results[0].rawValue) {
        return results[0].rawValue as string
      }
    } catch {
      // fall through
    }
    return null
  }

  stop() {
    this.running = false
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
  }
}

/* ───────────────────────── Layer 2 ───────────────────────── */

/** Shared off-DOM canvas used to pull video frames and preprocess them. */
function getScratchCanvas(): HTMLCanvasElement {
  if (scratchCanvas) return scratchCanvas
  scratchCanvas = document.createElement('canvas')
  return scratchCanvas
}
let scratchCanvas: HTMLCanvasElement | null = null

class EnhancedZxingDecoder implements BarcodeDecoder {
  readonly strategy = 'zxing' as const
  private timer: number | null = null
  private running = false
  private inFlight = false
  /** Alternates 0/1 across attempts so we cover both contrast-stretched and
   *  binarized passes without doubling the per-frame cost. */
  private tick = 0
  private attempts = 0
  private lastFormatSeen: string | null = null

  startScanning(
    video: HTMLVideoElement,
    onResult: (raw: string) => void,
    onDiagnostic?: (d: ScanDiagnostics) => void,
  ) {
    this.running = true
    this.attempts = 0
    this.lastFormatSeen = null
    const INTERVAL_MS = 200

    const attempt = async () => {
      if (!this.running || this.inFlight) return
      if (video.readyState < 2 || video.videoWidth === 0) return
      this.inFlight = true

      try {
        // Center-crop to a generous box around the viewfinder before passing
        // to zxing. We widen to 90% × 60% (vs the visible 90% × 30% viewfinder)
        // so users who frame the whole card instead of just the barcode still
        // have the barcode region inside the crop. Cropping at native
        // resolution preserves the fine PDF417 modules that get blurred when
        // the whole frame is downscaled.
        const vw = video.videoWidth
        const vh = video.videoHeight
        const cropW = Math.round(vw * 0.90)
        const cropH = Math.round(vh * 0.60)
        const cropX = Math.round((vw - cropW) / 2)
        const cropY = Math.round((vh - cropH) / 2)

        const canvas = getScratchCanvas()
        canvas.width = cropW
        canvas.height = cropH
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) return

        ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH)
        const imageData = ctx.getImageData(0, 0, cropW, cropH)
        // Alternate: even tick = grayscale + contrast (preferred for
        // most lighting); odd tick = also binarize (helps glossy codes
        // under harsh overhead light where Otsu threshold > smooth).
        const useBinarize = (this.tick++ % 2) === 1
        processForBarcode(imageData, { binarize: useBinarize })
        ctx.putImageData(imageData, 0, 0)
        const processed = ctx.getImageData(0, 0, cropW, cropH)

        this.attempts++
        // Every 4th attempt: also try ALL formats. If zxing CAN'T see anything
        // at all, the issue is focus/lighting; if it sees QR/code-128/etc. but
        // never PDF417, the issue is barcode framing or resolution. Cheap to
        // run occasionally — costs ~50ms once a second.
        const tryAllFormats = (this.attempts % 4) === 0
        const result = await decodePDF417FromImageData(processed, tryAllFormats)
        if (!this.running) return
        if (result?.isPDF417 && result.text) {
          this.stop()
          onResult(result.text)
          return
        }
        if (result && !result.isPDF417 && result.format) {
          // Saw something — note it for diagnostics, keep scanning.
          this.lastFormatSeen = result.format
        }
        onDiagnostic?.({ attempts: this.attempts, lastFormatSeen: this.lastFormatSeen })
      } finally {
        this.inFlight = false
      }
    }

    this.timer = window.setInterval(attempt, INTERVAL_MS)
  }

  async decodeImage(image: HTMLImageElement | Blob): Promise<string | null> {
    try {
      // Blob path — let zxing-wasm handle it (it scales internally).
      if (image instanceof Blob) {
        // Also run a preprocessed retry if the raw attempt misses.
        const raw = await decodePDF417FromBlob(image)
        if (raw?.isPDF417 && raw.text) return raw.text

        // Draw to canvas, preprocess aggressively, retry.
        const bmp = await createImageBitmap(image)
        const canvas = getScratchCanvas()
        canvas.width = bmp.width
        canvas.height = bmp.height
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) return null
        ctx.drawImage(bmp, 0, 0)
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        // For the still-image retry, also binarize — the user's camera app
        // will have produced a well-exposed frame where Otsu's threshold
        // is reliable.
        processForBarcode(imageData, { binarize: true })
        const retry = await decodePDF417FromImageData(imageData)
        return retry?.isPDF417 && retry.text ? retry.text : null
      }

      // HTMLImageElement path
      if (!image.complete) await image.decode()
      const canvas = getScratchCanvas()
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return null
      ctx.drawImage(image, 0, 0)
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      processForBarcode(imageData, { binarize: true })
      const result = await decodePDF417FromImageData(imageData)
      return result?.isPDF417 && result.text ? result.text : null
    } catch {
      return null
    }
  }

  stop() {
    this.running = false
    if (this.timer != null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }
}

/* ───────────────────────── Factory ───────────────────────── */

/**
 * Build the best available decoder for the caller's browser.
 * Returns `null` if the environment is `upload-only` (no camera).
 */
export async function createBarcodeDecoder(): Promise<BarcodeDecoder | null> {
  const strategy = await getDecoderStrategy()
  if (strategy === 'native') return new NativeBarcodeDecoder()
  if (strategy === 'zxing')  return new EnhancedZxingDecoder()
  return null
}

/**
 * Recommended getUserMedia constraints. Highest-resolution the camera can
 * deliver, rear-facing, with continuous autofocus when supported. Callers
 * should still try/catch the getUserMedia call — some phones reject the
 * `advanced` block even with valid keys, in which case retry without it.
 */
export const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: {
    facingMode: { ideal: 'environment' },
    width: { ideal: 3840 },
    height: { ideal: 2160 },
    // @ts-expect-error — focusMode is in MediaTrackConstraints (spec) but
    // not typed in lib.dom.d.ts yet.
    advanced: [{ focusMode: 'continuous' }],
  },
  audio: false,
}
