'use client'

// Manifest upload — multi-capable. Always renders a queue, even for a
// single-item upload, so the camera path and the file-picker path
// share one mental model.
//
// Pipeline per item: pick / capture → process if image (canvas → JPEG,
// optional scan-style) or pass-through if PDF → preview row → user
// assigns a box label → "Upload all" fires one upload per ready row
// in parallel.
//
// Conflicts: if the typed box label matches an existing manifest, the
// row shows a "⚠ replace?" check that must be acknowledged before
// upload-all will include that row.

import { useEffect, useRef, useState } from 'react'
import { processImageForUpload } from '@/lib/imageUtils'
import { uploadManifest } from '@/lib/shipping/manifests'
import type { ShippingManifest } from '@/lib/shipping/manifests'
import { useIsNarrow } from '@/components/expenses/useIsNarrow'
import Checkbox from '@/components/ui/Checkbox'

interface Props {
  /** The event to attach the manifest to. Named `boxId` for source-
   *  history continuity; semantically it's the event id. */
  boxId: string
  /** Event display name for the modal header. */
  boxLabel: string
  /** Box labels already used on this event (e.g. ["J1", "J2"]).
   *  Drives the preset pills + the per-row "replace?" warning. */
  existingBoxLabels: string[]
  /** Planned jewelry box count from the event's shipment row. The
   *  picker shows J1..J{jewelry}. If 0 / undefined (no shipment row,
   *  e.g. no-hold store), the picker falls back to J1-J5 so users
   *  still have a starting point. */
  plannedJewelryBoxes?: number
  /** Pre-fill the box label on the first row added (legacy single-
   *  capture entry point). New rows added afterward start blank. */
  initialBoxLabel?: string | null
  onClose: () => void
  onUploaded: (m: ShippingManifest) => void
}

const FALLBACK_J = 5
const ACCEPT = 'image/*,application/pdf'

type ItemStatus = 'processing' | 'ready' | 'uploading' | 'done' | 'error'

interface QueueItem {
  id: string
  file: File
  isPdf: boolean
  scanStyle: boolean              // image-only
  previewUrl: string | null       // image only
  processedBlob: Blob | null      // image: processed JPEG; PDF: original File
  boxLabel: string
  replaceAcked: boolean
  status: ItemStatus
  error: string | null
}

function buildPresetLabels(opts: { jewelry?: number; existing: string[] }): string[] {
  const j = (opts.jewelry && opts.jewelry > 0) ? opts.jewelry : FALLBACK_J
  const labels: string[] = []
  for (let i = 1; i <= j; i++) labels.push('J' + i)
  for (const e of opts.existing) {
    const trimmed = e.trim()
    if (trimmed && !labels.includes(trimmed)) labels.push(trimmed)
  }
  return labels
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && (crypto as any).randomUUID) return (crypto as any).randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export default function ManifestCaptureModal({
  boxId, boxLabel, existingBoxLabels, initialBoxLabel,
  plannedJewelryBoxes, onClose, onUploaded,
}: Props) {
  const presetLabels = buildPresetLabels({
    jewelry: plannedJewelryBoxes,
    existing: existingBoxLabels,
  })
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const isNarrow = useIsNarrow()

  const [items, setItems] = useState<QueueItem[]>([])
  const [busyAll, setBusyAll] = useState(false)
  const initialUsedRef = useRef(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => () => {
    // Revoke any preview URLs so the browser doesn't leak them.
    items.forEach(i => { if (i.previewUrl) URL.revokeObjectURL(i.previewUrl) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function patchItem(id: string, patch: Partial<QueueItem>) {
    setItems(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i))
  }

  async function processItem(item: QueueItem) {
    if (item.isPdf) {
      // PDFs upload as-is. The "processedBlob" is just the original File.
      patchItem(item.id, {
        processedBlob: item.file,
        status: 'ready',
      })
      return
    }
    try {
      const { blob } = await processImageForUpload(item.file, { scanStyle: item.scanStyle })
      const url = URL.createObjectURL(blob)
      patchItem(item.id, {
        previewUrl: (() => {
          if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
          return url
        })(),
        processedBlob: blob,
        status: 'ready',
      })
    } catch (err: any) {
      patchItem(item.id, {
        status: 'error',
        error: err?.message || 'Could not process image',
      })
    }
  }

  function addFiles(files: FileList | File[]) {
    const arr = Array.from(files)
    if (arr.length === 0) return
    const newItems: QueueItem[] = arr.map((file, idx) => {
      const isPdf = file.type === 'application/pdf'
        || /\.pdf$/i.test(file.name)
      // Use initialBoxLabel for the very first row only, once. After
      // that every new row starts blank per the user-pick flow.
      const useInitial = !initialUsedRef.current && idx === 0
      const startLabel = useInitial ? (initialBoxLabel || '') : ''
      if (useInitial) initialUsedRef.current = true
      return {
        id: uuid(),
        file,
        isPdf,
        scanStyle: !isPdf,
        previewUrl: null,
        processedBlob: null,
        boxLabel: startLabel,
        replaceAcked: false,
        status: 'processing',
        error: null,
      }
    })
    setItems(prev => [...prev, ...newItems])
    // Kick off async processing per item.
    newItems.forEach(it => { void processItem(it) })
  }

  async function reprocessAfterStyleChange(id: string, nextScan: boolean) {
    const it = items.find(x => x.id === id)
    if (!it || it.isPdf) return
    patchItem(id, { scanStyle: nextScan, status: 'processing', error: null })
    try {
      const { blob } = await processImageForUpload(it.file, { scanStyle: nextScan })
      const url = URL.createObjectURL(blob)
      patchItem(id, {
        previewUrl: (() => {
          if (it.previewUrl) URL.revokeObjectURL(it.previewUrl)
          return url
        })(),
        processedBlob: blob,
        status: 'ready',
      })
    } catch (err: any) {
      patchItem(id, { status: 'error', error: err?.message || 'Could not re-process' })
    }
  }

  function removeItem(id: string) {
    setItems(prev => {
      const it = prev.find(x => x.id === id)
      if (it?.previewUrl) URL.revokeObjectURL(it.previewUrl)
      return prev.filter(x => x.id !== id)
    })
  }

  function isReady(it: QueueItem): boolean {
    if (it.status !== 'ready') return false
    if (!it.processedBlob) return false
    const trimmed = it.boxLabel.trim()
    if (!trimmed) return false
    const collides = existingBoxLabels.some(x => x.toUpperCase() === trimmed.toUpperCase())
    if (collides && !it.replaceAcked) return false
    return true
  }

  const readyCount = items.filter(isReady).length
  const blockerCount = items.filter(i =>
    i.status === 'ready' && !isReady(i)
  ).length

  async function uploadAll() {
    const ready = items.filter(isReady)
    if (ready.length === 0) return
    setBusyAll(true)
    // Mark each ready row as uploading up front so the UI shows
    // simultaneous progress.
    setItems(prev => prev.map(i => isReady(i) ? { ...i, status: 'uploading' } : i))
    await Promise.all(ready.map(async it => {
      try {
        const m = await uploadManifest({
          eventId: boxId,
          blob: it.processedBlob!,
          isScanStyle: it.scanStyle,
          boxLabel: it.boxLabel.trim(),
        })
        patchItem(it.id, { status: 'done' })
        onUploaded(m)
      } catch (err: any) {
        patchItem(it.id, { status: 'error', error: err?.message || 'Upload failed' })
      }
    }))
    setBusyAll(false)
    // If everything succeeded, close. Otherwise leave the modal open so
    // the user can fix the failures.
    setTimeout(() => {
      const stillPending = items.some(i => i.status === 'error' || i.status === 'ready')
      if (!stillPending) onClose()
    }, 300)
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)',
      zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 12,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 12, width: '100%', maxWidth: 640,
        padding: 18, boxShadow: '0 20px 60px rgba(0,0,0,.30)',
        maxHeight: 'calc(100vh - 24px)', overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ fontSize: 16, fontWeight: 900, color: 'var(--ink)', margin: 0 }}>
            Manifests · {boxLabel}
          </h3>
          <button onClick={onClose} aria-label="Close" style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--mist)', fontSize: 22, padding: '0 6px',
          }}>×</button>
        </div>

        {/* Add buttons */}
        <div style={{ display: 'grid', gridTemplateColumns: isNarrow ? '1fr 1fr' : '1fr', gap: 8, marginBottom: 14 }}>
          {isNarrow && (
            <button
              onClick={() => cameraInputRef.current?.click()}
              disabled={busyAll}
              style={addBtnStyle('camera')}
            >
              <span style={{ fontSize: 24 }}>📷</span>
              <span>Take photo</span>
            </button>
          )}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={busyAll}
            style={addBtnStyle('upload')}
          >
            <span style={{ fontSize: 24 }}>📤</span>
            <span>{isNarrow ? 'Add files' : 'Choose files (image / PDF, multi-select OK)'}</span>
          </button>
        </div>
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          {...(isNarrow ? { capture: 'environment' as any } : {})}
          onChange={e => {
            if (e.target.files) addFiles(e.target.files)
            e.target.value = ''  // allow re-picking the same file
          }}
          style={{ display: 'none' }}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT}
          multiple
          onChange={e => {
            if (e.target.files) addFiles(e.target.files)
            e.target.value = ''
          }}
          style={{ display: 'none' }}
        />

        {/* Empty state */}
        {items.length === 0 && (
          <div style={{
            textAlign: 'center', padding: 30,
            color: 'var(--mist)', fontSize: 13,
            border: '2px dashed var(--cream2)', borderRadius: 10,
          }}>
            No files yet. Take a photo or pick one or more files
            (images and PDFs both supported).
          </div>
        )}

        {/* Queue */}
        {items.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
            {items.map(it => (
              <ItemRow
                key={it.id}
                item={it}
                presetLabels={presetLabels}
                existingBoxLabels={existingBoxLabels}
                onChangeLabel={(v) => patchItem(it.id, { boxLabel: v, replaceAcked: false })}
                onChangeStyle={(s) => reprocessAfterStyleChange(it.id, s)}
                onAckReplace={(v) => patchItem(it.id, { replaceAcked: v })}
                onRemove={() => removeItem(it.id)}
                disabled={busyAll || it.status === 'uploading' || it.status === 'done'}
              />
            ))}
          </div>
        )}

        {/* Upload-all bar */}
        {items.length > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            paddingTop: 12, borderTop: '1px solid var(--cream2)',
          }}>
            <div style={{ flex: 1, fontSize: 12, color: 'var(--mist)' }}>
              {readyCount > 0 && <span><strong style={{ color: 'var(--green-dark)' }}>{readyCount}</strong> ready</span>}
              {readyCount > 0 && blockerCount > 0 && <span> · </span>}
              {blockerCount > 0 && <span><strong style={{ color: '#92400E' }}>{blockerCount}</strong> need attention</span>}
            </div>
            <button onClick={onClose} className="btn-outline btn-sm" disabled={busyAll}>
              Done
            </button>
            <button
              onClick={uploadAll}
              disabled={busyAll || readyCount === 0}
              className="btn-primary"
              style={{ minHeight: 40 }}
            >
              {busyAll ? 'Uploading…' : `Upload ${readyCount > 0 ? readyCount : ''}`.trim()}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function addBtnStyle(kind: 'camera' | 'upload'): React.CSSProperties {
  const camera = kind === 'camera'
  return {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexDirection: 'column', gap: 4,
    minHeight: 100, padding: 14,
    border: '2px dashed ' + (camera ? 'var(--green3)' : 'var(--pearl)'),
    borderRadius: 10,
    background: camera ? 'var(--green-pale)' : '#fff',
    color: camera ? 'var(--green-dark)' : 'var(--ash)',
    fontSize: 13, fontWeight: 800, cursor: 'pointer',
    fontFamily: 'inherit',
  }
}

/* ── Per-item row ─────────────────────────────────────────── */

function ItemRow({
  item, presetLabels, existingBoxLabels,
  onChangeLabel, onChangeStyle, onAckReplace, onRemove, disabled,
}: {
  item: QueueItem
  presetLabels: string[]
  existingBoxLabels: string[]
  onChangeLabel: (v: string) => void
  onChangeStyle: (s: boolean) => void
  onAckReplace: (v: boolean) => void
  onRemove: () => void
  disabled: boolean
}) {
  const trimmed = item.boxLabel.trim()
  const collides = !!trimmed
    && existingBoxLabels.some(x => x.toUpperCase() === trimmed.toUpperCase())
  return (
    <div style={{
      border: '1px solid var(--cream2)', borderRadius: 10, padding: 10,
      background: item.status === 'done' ? '#F0FDF4'
                : item.status === 'error' ? '#FEF2F2'
                : '#fff',
    }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        {/* Thumbnail / icon */}
        <div style={{
          width: 64, height: 64, flexShrink: 0,
          borderRadius: 6, overflow: 'hidden',
          background: item.isPdf ? 'var(--cream2)' : '#000',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 24,
        }}>
          {item.isPdf ? '📄' :
           item.previewUrl ? <img src={item.previewUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> :
           '⏳'}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Filename + remove */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6, marginBottom: 4 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {item.file.name || (item.isPdf ? 'PDF' : 'Image')}
            </div>
            <button onClick={onRemove} disabled={disabled}
              aria-label="Remove from queue"
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--mist)', fontSize: 16, padding: '0 4px' }}>
              ✕
            </button>
          </div>

          {/* Status badge */}
          <div style={{ fontSize: 10, fontWeight: 800, color: badgeColor(item.status), textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>
            {item.status === 'processing' && 'Processing…'}
            {item.status === 'ready'      && (collides && !item.replaceAcked ? '⚠ Confirm replace' : 'Ready')}
            {item.status === 'uploading'  && 'Uploading…'}
            {item.status === 'done'       && '✓ Uploaded'}
            {item.status === 'error'      && (item.error || 'Error')}
          </div>

          {/* Box label picker */}
          <div style={{ marginBottom: 6 }}>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
              {presetLabels.map(l => {
                const sel = trimmed.toUpperCase() === l
                const used = existingBoxLabels.some(x => x.toUpperCase() === l)
                return (
                  <button key={l} onClick={() => onChangeLabel(l)} disabled={disabled}
                    style={{
                      padding: '4px 8px', minHeight: 28, borderRadius: 5,
                      cursor: disabled ? 'not-allowed' : 'pointer',
                      fontFamily: 'inherit', fontSize: 11, fontWeight: 800,
                      background: sel ? 'var(--green-pale)' : 'transparent',
                      border: '1px solid ' + (sel ? 'var(--green3)' : 'var(--pearl)'),
                      color: sel ? 'var(--green-dark)' : 'var(--ash)',
                      position: 'relative',
                    }}>
                    {l}
                    {used && (
                      <span aria-hidden style={{
                        position: 'absolute', top: -2, right: -2,
                        background: '#F59E0B', color: '#fff',
                        fontSize: 8, fontWeight: 800,
                        padding: '0 3px', borderRadius: 5, lineHeight: '10px',
                      }} title="Already has photos">·</span>
                    )}
                  </button>
                )
              })}
            </div>
            <input
              value={item.boxLabel}
              onChange={e => onChangeLabel(e.target.value)}
              placeholder="…or type a custom label"
              maxLength={24}
              disabled={disabled}
              style={{
                width: '100%', padding: '6px 8px', fontSize: 12,
                border: '1px solid var(--pearl)', borderRadius: 5,
                background: '#fff', color: 'var(--ink)',
                fontFamily: 'inherit', outline: 'none',
              }}
            />
          </div>

          {/* Replace warning */}
          {collides && (
            <div style={{ marginBottom: 6 }}>
              <Checkbox
                checked={!!item.replaceAcked}
                onChange={onAckReplace}
                disabled={disabled}
                size={16}
                color="#92400E"
                label={<span>{trimmed} already has a manifest — keep both (this adds a new one)</span>}
                labelStyle={{ fontSize: 11, color: '#92400E', fontWeight: 700 }}
              />
            </div>
          )}

          {/* Scan-style toggle (image only) */}
          {!item.isPdf && (
            <div style={{ display: 'flex', gap: 4 }}>
              {[
                { id: true,  label: 'Scan style' },
                { id: false, label: 'Original color' },
              ].map(opt => {
                const sel = item.scanStyle === opt.id
                return (
                  <button key={String(opt.id)}
                    onClick={() => onChangeStyle(opt.id)}
                    disabled={disabled || item.status === 'processing'}
                    style={{
                      flex: 1, padding: '6px 8px', borderRadius: 5,
                      cursor: disabled ? 'not-allowed' : 'pointer',
                      background: sel ? 'var(--green-pale)' : 'transparent',
                      border: '1px solid ' + (sel ? 'var(--green3)' : 'var(--pearl)'),
                      fontFamily: 'inherit', fontWeight: 700, fontSize: 11,
                      color: sel ? 'var(--green-dark)' : 'var(--ash)',
                    }}>
                    {opt.label}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function badgeColor(s: ItemStatus): string {
  switch (s) {
    case 'processing': return 'var(--mist)'
    case 'ready':      return 'var(--green-dark)'
    case 'uploading':  return '#1E40AF'
    case 'done':       return '#065F46'
    case 'error':      return '#991B1B'
  }
}
