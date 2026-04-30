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
  boxId: string
  boxLabel: string
  onClose: () => void
  onUploaded: (m: ShippingManifest) => void
}

export default function ManifestCaptureModal({
  boxId, boxLabel, onClose, onUploaded,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const isNarrow = useIsNarrow()
  const [scanStyle, setScanStyle] = useState(true)
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
    setBusy('uploading')
    setError(null)
    try {
      const m = await uploadManifest({ boxId, blob: processedBlob, isScanStyle: scanStyle })
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
