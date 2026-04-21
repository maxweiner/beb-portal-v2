/**
 * In-memory scan metrics.
 *
 * Tracks success rate, decoder strategy distribution, time-to-decode, and
 * upload-fallback count for the current browsing session. State is intentionally
 * non-persistent — refresh clears it — because the point is to judge decoder
 * performance mid-event, not build long-term analytics.
 *
 * Called by LicenseScanner at key points; exposed via `getScanMetrics()` for
 * admin-only display panels.
 */

import type { DecoderStrategy } from './barcode-decoder'

interface MetricsState {
  attempts: number
  successes: number
  strategyCounts: Record<'native' | 'zxing' | 'upload', number>
  uploadFallbacks: number
  timings: number[] // ms from camera open to first decode
}

const state: MetricsState = {
  attempts: 0,
  successes: 0,
  strategyCounts: { native: 0, zxing: 0, upload: 0 },
  uploadFallbacks: 0,
  timings: [],
}

export function recordScanAttempt() {
  state.attempts++
}

export function recordScanSuccess(
  strategy: 'native' | 'zxing' | 'upload',
  msToDecode?: number,
) {
  state.successes++
  state.strategyCounts[strategy]++
  if (typeof msToDecode === 'number' && msToDecode > 0 && msToDecode < 600_000) {
    state.timings.push(msToDecode)
  }
}

export function recordUploadFallback() {
  state.uploadFallbacks++
}

export interface ScanMetricsSnapshot {
  attempts: number
  successes: number
  successRate: number // 0..1
  strategyCounts: Record<'native' | 'zxing' | 'upload', number>
  uploadFallbacks: number
  avgTimeToDecodeMs: number | null
  medianTimeToDecodeMs: number | null
}

export function getScanMetrics(): ScanMetricsSnapshot {
  const { attempts, successes, strategyCounts, uploadFallbacks, timings } = state
  const successRate = attempts > 0 ? successes / attempts : 0

  let avg: number | null = null
  let median: number | null = null
  if (timings.length > 0) {
    const sum = timings.reduce((a, b) => a + b, 0)
    avg = Math.round(sum / timings.length)
    const sorted = [...timings].sort((a, b) => a - b)
    const mid = sorted.length >> 1
    median = sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
  }

  return {
    attempts,
    successes,
    successRate,
    strategyCounts: { ...strategyCounts },
    uploadFallbacks,
    avgTimeToDecodeMs: avg,
    medianTimeToDecodeMs: median,
  }
}

/** Translate the probe result into the metrics category used by recordSuccess. */
export function strategyCategory(strategy: DecoderStrategy | 'upload'): 'native' | 'zxing' | 'upload' {
  if (strategy === 'native') return 'native'
  if (strategy === 'zxing')  return 'zxing'
  return 'upload'
}
