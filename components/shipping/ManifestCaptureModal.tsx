'use client'

// Manifest photo capture flow. Triggered by the camera button on a
// shipping box row. On mobile, the file input forces the camera with
// `capture="environment"`. On desktop, it's a normal file picker.
//
// Pipeline: pick → preview → process (scan-style or original color) →
// upload → close. On upload failure the processed blob is kept in
// state so the user can retry without re-capturing.

import { useEffect, useRef, useState } from 'react'
import { processImageForUpload } from '@/lib/imageUtils'
import { uploadManifest } from '@/lib/shipping/manifests'
import type { ShippingManifest } from '@/lib/shipping/manifests'
import { useIsNarrow } from '@/components/expenses/useIsNarrow'

interface Props {
  /** The event to attach the manifest to. Named `boxId` for source-
   *  history continuity; semantically it's the event id. */
  boxId: string
  /** Event display name for the modal header. */
  boxLabel: string
  /** Box labels already used on this event (e.g. ["J1", "J2"]).
   *  Drives the smart-default + "next box" suggestion. */
  existingBoxLabels: string[]
  /** Planned box counts from the event's shipment row. The picker
   *  shows J1..J{jewelry} + S1..S{silver}. If both are 0 (no
   *  shipment row, e.g. no-hold store), the picker falls back to
   *  J1-J5 + S1-S2 so users still have a starting point. */
  plannedJewelryBoxes?: number
  plannedSilverBoxes?: number
  /** Pre-fill the box label input. Used by "Add another" to default to
   *  the box the user was just viewing. */
  initialBoxLabel?: string | null
  onClose: () => void
  onUploaded: (m: ShippingManifest) => void
}

const FALLBACK_J = 5
const FALLBACK_S = 2

/** Build the preset pill set for the picker. Uses planned counts when
 *  provided; otherwise falls back to a sensible default. Always
 *  includes any labels already used on this event so they're visible
 *  even if shipment counts haven't been adjusted yet. */
function buildPresetLabels(opts: {
  jewelry?: number
  silver?: number
  existing: string[]
}): string[] {
  const j = (opts.jewelry && opts.jewelry > 0) ? opts.jewelry : (opts.silver && opts.silver > 0) ? 0 : FALLBACK_J
  const s = (opts.silver && opts.silver > 0) ? opts.silver : (opts.jewelry && opts.jewelry > 0) ? 0 : FALLBACK_S
  const labels: string[] = []
  for (let i = 1; i <= j; i++) labels.push('J' + i)
  for (let i = 1; i <= s; i++) labels.push('S' + i)
  // Surface any custom / out-of-range labels already used on this event
  // so they're not lost from the picker.
  for (const e of opts.existing) {
    const trimmed = e.trim()
    if (trimmed && !labels.includes(trimmed)) labels.push(trimmed)
  }
  return labels
}

/** Suggest the next J box if no others are present, otherwise the
 *  highest-numbered J + 1. Falls back to "J1". */
function suggestNextLabel(existing: string[]): string {
  const jNums = existing
    .map(l => /^J(\d+)$/i.exec(l)?.[1])
    .filter(Boolean)
    .map(n => parseInt(n!, 10))
    .filter(Number.isFinite)
  if (jNums.length === 0) return 'J1'
  return 'J' + (Math.max(...jNums) + 1)
}

export default function ManifestCaptureModal({
  boxId, boxLabel, existingBoxLabels, initialBoxLabel,
  plannedJewelryBoxes, plannedSilverBoxes,
  onClose, onUploaded,
}: Props) {
  const presetLabels = buildPresetLabels({
    jewelry: plannedJewelryBoxes,
    silver: plannedSilverBoxes,
    existing: existingBoxLabels,
  })
  const inputRef = useRef<HTMLInputElement>(null)
  const isNarrow = useIsNarrow()
  const [scanStyle, setScanStyle] = useState(true)
  const [labelDraft, setLabelDraft] = useState<string>(
    initialBoxLabel || suggestNextLabel(existingBoxLabels),
  )
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [processedBlob, setProcessedBlob] = useState<Blob | null>(null)
  const [busy, setBusy] = useState<'processing' | 'uploading' | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Revoke object URLs so the browser doesn't leak them.
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])

  async function processFile(file: File) {
    setError(null)
    setBusy('processing')
    try {
      const { blob } = await processImageForUpload(file, { scanStyle })
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      setPreviewUrl(URL.createObjectURL(blob))
      setProcessedBlob(blob)
    } catch (err: any) {
      setError(err?.message || 'Could not process image')
    } finally {
      setBusy(null)
    }
  }

  async function reprocessIfStyleChanged(nextScan: boolean) {
    setScanStyle(nextScan)
    // If we already have a preview, re-process from the file input.
    const file = inputRef.current?.files?.[0]
    if (!file) return
    setBusy('processing')
    setError(null)
    try {
      const { blob } = await processImageForUpload(file, { scanStyle: nextScan })
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      setPreviewUrl(URL.createObjectURL(blob))
      setProcessedBlob(blob)
    } catch (err: any) {
      setError(err?.message || 'Could not re-process image')
    } finally {
      setBusy(null)
    }
  }

  async function doUpload() {
    if (!processedBlob) return
    const trimmed = labelDraft.trim()
    if (!trimmed) {
      setError('Pick or type a box label first.')
      return
    }
    setBusy('uploading')
    setError(null)
    try {
      const m = await uploadManifest({
        eventId: boxId, blob: processedBlob, isScanStyle: scanStyle,
        boxLabel: trimmed,
      })
      onUploaded(m)
      onClose()
    } catch (err: any) {
      setError(err?.message || 'Upload failed')
      setBusy(null)
    }
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)',
      zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 12,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 12, width: '100%', maxWidth: 480,
        padding: 18, boxShadow: '0 20px 60px rgba(0,0,0,.30)',
        maxHeight: 'calc(100vh - 24px)', overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ fontSize: 16, fontWeight: 900, color: 'var(--ink)', margin: 0 }}>
            Manifest photo · {boxLabel}
          </h3>
          <button onClick={onClose} aria-label="Close" style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--mist)', fontSize: 22, padding: '0 6px',
          }}>×</button>
        </div>

        {/* Box label picker */}
        <div style={{ marginBottom: 12 }}>
          <label style={{
            display: 'block', fontSize: 11, fontWeight: 800, color: 'var(--mist)',
            textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6,
          }}>Box</label>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
            {presetLabels.map(l => {
              const sel = labelDraft.trim().toUpperCase() === l
              const used = existingBoxLabels.some(x => x.toUpperCase() === l)
              return (
                <button key={l} onClick={() => setLabelDraft(l)}
                  style={{
                    padding: '6px 10px', minHeight: 36, borderRadius: 6,
                    cursor: 'pointer', fontFamily: 'inherit',
                    fontSize: 12, fontWeight: 800,
                    background: sel ? 'var(--green-pale)' : 'transparent',
                    border: '1px solid ' + (sel ? 'var(--green3)' : 'var(--pearl)'),
                    color: sel ? 'var(--green-dark)' : 'var(--ash)',
                    position: 'relative',
                  }}>
                  {l}
                  {used && (
                    <span aria-hidden style={{
                      position: 'absolute', top: -3, right: -3,
                      background: '#F59E0B', color: '#fff',
                      fontSize: 9, fontWeight: 800,
                      padding: '0 4px', borderRadius: 6, lineHeight: '12px',
                    }} title="Already has photos">·</span>
                  )}
                </button>
              )
            })}
          </div>
          <input
            value={labelDraft}
            onChange={e => setLabelDraft(e.target.value)}
            placeholder="…or type a custom label"
            maxLength={24}
            style={{
              width: '100%', padding: '8px 10px', fontSize: 13,
              border: '1px solid var(--pearl)', borderRadius: 6,
              background: '#fff', color: 'var(--ink)',
              fontFamily: 'inherit', outline: 'none',
            }}
          />
        </div>

        {/* Style toggle */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          {[
            { id: true,  label: 'Scan style', hint: 'recommended' },
            { id: false, label: 'Original color' },
          ].map(opt => {
            const sel = scanStyle === opt.id
            return (
              <button key={String(opt.id)}
                onClick={() => reprocessIfStyleChanged(opt.id)}
                style={{
                  flex: 1, padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                  background: sel ? 'var(--green-pale)' : 'transparent',
                  border: '1px solid ' + (sel ? 'var(--green3)' : 'var(--pearl)'),
                  fontFamily: 'inherit', fontWeight: 700, fontSize: 13,
                  color: sel ? 'var(--green-dark)' : 'var(--ash)',
                }}>
                <div>{opt.label}</div>
                {opt.hint && <div style={{ fontSize: 10, fontWeight: 600, opacity: 0.65 }}>{opt.hint}</div>}
              </button>
            )
          })}
        </div>

        {/* Capture / pick */}
        {!previewUrl && (
          <button
            onClick={() => inputRef.current?.click()}
            disabled={busy !== null}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              width: '100%', minHeight: 120, padding: 16,
              border: '2px dashed var(--green3)', borderRadius: 10,
              background: 'var(--green-pale)', color: 'var(--green-dark)',
              fontSize: 14, fontWeight: 800, cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {busy === 'processing' ? 'Processing…' : (
              <>
                <span style={{ fontSize: 28 }}>📷</span>
                <span>{isNarrow ? 'Take photo' : 'Choose image'}</span>
              </>
            )}
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          {...(isNarrow ? { capture: 'environment' as any } : {})}
          onChange={e => { const f = e.target.files?.[0]; if (f) processFile(f) }}
          style={{ display: 'none' }}
        />

        {/* Preview */}
        {previewUrl && (
          <div style={{ marginTop: 4 }}>
            <img src={previewUrl} alt="Manifest preview" style={{
              display: 'block', width: '100%', maxHeight: '50vh',
              objectFit: 'contain', background: '#000', borderRadius: 8,
            }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button onClick={() => inputRef.current?.click()} disabled={busy !== null}
                style={{
                  flex: 1, padding: '12px', minHeight: 44,
                  border: '1px solid var(--pearl)', background: '#fff',
                  borderRadius: 8, cursor: 'pointer',
                  fontFamily: 'inherit', fontWeight: 700, fontSize: 13,
                  color: 'var(--ash)',
                }}>Retake</button>
              <button onClick={doUpload} disabled={busy !== null}
                className="btn-primary"
                style={{ flex: 2, minHeight: 44 }}>
                {busy === 'uploading' ? 'Uploading…' : 'Upload'}
              </button>
            </div>
          </div>
        )}

        {error && (
          <div style={{
            marginTop: 12, padding: 10, borderRadius: 6,
            background: '#FEE2E2', color: '#991B1B', fontSize: 13,
          }}>
            {error}
          </div>
        )}
      </div>
    </div>
  )
}
