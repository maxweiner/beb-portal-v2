'use client'

// Shared multi-logo manager for both the buying-side (Stores admin)
// and the trunk-side (TrunkShowStores admin). Drop it into an edit
// modal with `parentKind` + `parentId` and it handles the rest.
//
// Features:
//  - Drag-and-drop upload zone (also doubles as the empty state)
//  - Click-to-browse file input (accepts images + PDFs)
//  - Clipboard paste (Cmd-V drops the image directly)
//  - PDFs are rasterized client-side to PNG via PDF.js (dynamic
//    import — pdfjs-dist only loads when a user actually picks a
//    PDF, so the main bundle stays clean)
//  - Thumbnail grid with ⭐ star to set active default
//  - Per-card delete with confirmation
//  - Reorder via "Move up" / "Move down" buttons (no full DnD — the
//    grids stay small and drag is the kind of thing that breaks
//    on touch + screen readers)

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { publicLogoUrl } from '@/lib/storeLogos/url'
import { rasterizePdfToPng } from '@/lib/storeLogos/rasterizePdf'
import type { StoreLogoEntry, StoreLogoParentKind } from '@/lib/storeLogos/types'

interface Props {
  parentKind: StoreLogoParentKind
  parentId: string
  /** Current array as read from the parent row. */
  logos: StoreLogoEntry[]
  /** Current default index from the parent row. */
  defaultIndex: number
  /** Called after every successful mutation so the parent can re-fetch. */
  onChange: () => void
}

const ACCEPT = 'image/png,image/jpeg,image/webp,image/svg+xml,application/pdf'

export default function StoreLogoManager({ parentKind, parentId, logos, defaultIndex, onChange }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Paste support — listens on the panel itself so the user can
  // Cmd-V a logo they copied from a vendor website / email.
  const panelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = panelRef.current
    if (!el) return
    const onPaste = (e: ClipboardEvent) => {
      const files = e.clipboardData?.files
      if (files && files.length > 0) {
        e.preventDefault()
        handleFiles(Array.from(files))
      }
    }
    el.addEventListener('paste', onPaste)
    return () => el.removeEventListener('paste', onPaste)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentKind, parentId])

  const auth = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token || ''
  }

  const api = async (path: string, body: any) => {
    const token = await auth()
    const res = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`)
    return json
  }

  const handleFiles = async (files: File[]) => {
    setError(null)
    setBusy(true)
    try {
      for (const file of files) {
        let toUpload: Blob = file
        let mime = file.type || 'application/octet-stream'

        if (mime === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
          // Rasterize page 1 → PNG client-side
          toUpload = await rasterizePdfToPng(file)
          mime = 'image/png'
        }

        const dataUrl = await blobToDataUrl(toUpload)
        await api('/api/store-logos/upload', {
          parentKind, parentId, dataUrl, mime,
        })
      }
      onChange()
    } catch (e: any) {
      setError(e?.message || 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  const setDefault = async (index: number) => {
    if (index === defaultIndex) return
    setError(null)
    setBusy(true)
    try {
      await api('/api/store-logos/set-default', { parentKind, parentId, index })
      onChange()
    } catch (e: any) {
      setError(e?.message || 'Update failed')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (index: number) => {
    const entry = logos[index]
    if (!entry) return
    const isDefault = index === defaultIndex
    const msg = isDefault
      ? 'Delete the active default logo? The next logo in the list will become the default.'
      : 'Delete this logo?'
    if (!confirm(msg)) return
    setError(null)
    setBusy(true)
    try {
      await api('/api/store-logos/delete', { parentKind, parentId, index })
      onChange()
    } catch (e: any) {
      setError(e?.message || 'Delete failed')
    } finally {
      setBusy(false)
    }
  }

  const move = async (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= logos.length) return
    setError(null)
    setBusy(true)
    try {
      const order = logos.map((_, i) => i)
      ;[order[index], order[target]] = [order[target], order[index]]
      await api('/api/store-logos/reorder', { parentKind, parentId, order })
      onChange()
    } catch (e: any) {
      setError(e?.message || 'Reorder failed')
    } finally {
      setBusy(false)
    }
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files || [])
    if (files.length > 0) handleFiles(files)
  }

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length > 0) handleFiles(files)
    // Clear the input so picking the same file twice still fires onChange.
    if (inputRef.current) inputRef.current.value = ''
  }

  const hasLogos = logos.length > 0

  return (
    <div ref={panelRef} tabIndex={-1} style={{ outline: 'none' }}>
      {/* Upload zone — also the empty state */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? 'var(--green)' : 'var(--pearl)'}`,
          borderRadius: 'var(--r)',
          padding: hasLogos ? '14px 16px' : '28px 16px',
          textAlign: 'center',
          background: dragOver ? 'var(--green-pale)' : 'var(--cream2)',
          cursor: busy ? 'wait' : 'pointer',
          transition: 'all .15s',
          marginBottom: hasLogos ? 14 : 0,
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          onChange={onPick}
          disabled={busy}
          style={{ display: 'none' }}
        />
        <div style={{ fontSize: hasLogos ? 13 : 15, fontWeight: 700, color: 'var(--ink)', marginBottom: 4 }}>
          {busy ? '⏳ Uploading…' : hasLogos
            ? '📎 Add more logos — drop, click, or paste'
            : '📁 Drop a logo here, click to browse, or paste (Cmd-V)'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--mist)' }}>
          PNG · JPEG · WebP · SVG · PDF — PDFs get rasterized to PNG automatically
        </div>
      </div>

      {error && (
        <div style={{
          padding: '8px 12px', borderRadius: 'var(--r)',
          background: '#fef2f2', color: '#991b1b',
          border: '1px solid #fecaca', fontSize: 13, marginBottom: 14,
        }}>
          {error}
        </div>
      )}

      {/* Grid */}
      {hasLogos && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
          gap: 12,
        }}>
          {logos.map((entry, i) => {
            const isDefault = i === defaultIndex
            const src = publicLogoUrl(entry.path)
            return (
              <div key={`${entry.path}-${i}`} style={{
                border: isDefault ? '2px solid var(--green)' : '1px solid var(--pearl)',
                borderRadius: 'var(--r)',
                background: '#fff',
                padding: 8,
                position: 'relative',
                display: 'flex', flexDirection: 'column', gap: 8,
              }}>
                {/* Star — active default badge / click-to-set */}
                <button
                  type="button"
                  onClick={() => setDefault(i)}
                  disabled={busy || isDefault}
                  title={isDefault ? 'This is the active default logo' : 'Make this the active default'}
                  style={{
                    position: 'absolute', top: 4, right: 4, zIndex: 2,
                    background: isDefault ? 'var(--green)' : 'rgba(255,255,255,.92)',
                    color: isDefault ? '#fff' : 'var(--ash)',
                    border: '1px solid var(--pearl)',
                    width: 28, height: 28, borderRadius: '50%',
                    fontSize: 14, cursor: isDefault ? 'default' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: isDefault ? '0 1px 3px rgba(0,0,0,.18)' : 'none',
                  }}
                >★</button>

                {/* Thumbnail */}
                <div style={{
                  height: 96, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'var(--cream2)', borderRadius: 6, overflow: 'hidden',
                }}>
                  {src
                    ? <img src={src} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                    : <span style={{ fontSize: 11, color: 'var(--mist)' }}>(no preview)</span>}
                </div>

                {/* Footer — reorder + delete */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                  <div style={{ display: 'flex', gap: 2 }}>
                    <button
                      type="button"
                      onClick={() => move(i, -1)}
                      disabled={busy || i === 0}
                      title="Move up"
                      style={iconBtnStyle(busy || i === 0)}
                    >▲</button>
                    <button
                      type="button"
                      onClick={() => move(i, +1)}
                      disabled={busy || i === logos.length - 1}
                      title="Move down"
                      style={iconBtnStyle(busy || i === logos.length - 1)}
                    >▼</button>
                  </div>
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    disabled={busy}
                    title="Delete this logo"
                    style={{
                      ...iconBtnStyle(busy),
                      color: '#991b1b',
                    }}
                  >🗑</button>
                </div>

                {/* Metadata footnotes */}
                <div style={{ fontSize: 10, color: 'var(--mist)', textAlign: 'center', lineHeight: 1.3 }}>
                  {isDefault && <strong style={{ color: 'var(--green-dark)' }}>Active default<br/></strong>}
                  {entry.legacy_data_url
                    ? <span title="Inherited from the single-logo era — will move to Storage on re-upload">legacy</span>
                    : entry.mime.replace('image/', '')}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function iconBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    appearance: 'none', border: '1px solid var(--pearl)',
    background: '#fff', borderRadius: 4, fontFamily: 'inherit',
    width: 24, height: 24, fontSize: 11, fontWeight: 700,
    cursor: disabled ? 'not-allowed' : 'pointer',
    color: 'var(--ash)', opacity: disabled ? 0.45 : 1,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error || new Error('FileReader error'))
    reader.readAsDataURL(blob)
  })
}
