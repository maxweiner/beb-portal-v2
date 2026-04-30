'use client'

// Lightbox viewer for the manifest photos attached to a single box.
// Mobile + desktop share the same UI: tap/click thumbnail strip,
// prev/next arrows, pinch/click to zoom (browser default), per-photo
// delete + "Add another" affordance.

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/lib/context'
import {
  signManifestUrl, softDeleteManifest, type ShippingManifest,
} from '@/lib/shipping/manifests'

interface Props {
  boxLabel: string
  manifests: ShippingManifest[]
  onClose: () => void
  onAddAnother: () => void
  onDeleted: (id: string) => void
}

export default function ManifestViewerModal({
  boxLabel, manifests, onClose, onAddAnother, onDeleted,
}: Props) {
  const { users } = useApp()
  const [activeIdx, setActiveIdx] = useState(0)
  // Cache signed URLs for each manifest path so we don't re-sign per click.
  const [urls, setUrls] = useState<Record<string, string>>({})

  // Soft warning when a single box has lots of attached photos.
  const overLimit = manifests.length > 10

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') setActiveIdx(i => Math.min(i + 1, manifests.length - 1))
      if (e.key === 'ArrowLeft')  setActiveIdx(i => Math.max(i - 1, 0))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, manifests.length])

  // Lazily resolve signed URLs for the manifests we actually render.
  useEffect(() => {
    let cancelled = false
    const need = manifests.filter(m => !urls[m.id])
    if (need.length === 0) return
    Promise.all(need.map(async m => {
      try { return [m.id, await signManifestUrl(m.file_path)] as const }
      catch { return [m.id, ''] as const }
    })).then(pairs => {
      if (cancelled) return
      setUrls(prev => {
        const next = { ...prev }
        for (const [id, url] of pairs) if (url) next[id] = url
        return next
      })
    })
    return () => { cancelled = true }
  }, [manifests, urls])

  // Clamp activeIdx if the list shrinks (e.g. delete).
  useEffect(() => {
    if (activeIdx > manifests.length - 1) {
      setActiveIdx(Math.max(0, manifests.length - 1))
    }
  }, [manifests.length, activeIdx])

  const active = manifests[activeIdx]
  const activeUrl = active ? urls[active.id] : null
  const uploader = useMemo(() => {
    if (!active?.uploaded_by) return null
    return users.find(u => u.id === active.uploaded_by) || null
  }, [active, users])

  async function handleDelete() {
    if (!active) return
    if (!confirm('Delete this manifest photo? You can restore from Trash for 30 days.')) return
    try {
      await softDeleteManifest(active.id)
      onDeleted(active.id)
    } catch (err: any) {
      alert('Could not delete: ' + (err?.message || 'unknown'))
    }
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.85)',
      zIndex: 1200, display: 'flex', flexDirection: 'column',
    }}>
      {/* Top bar */}
      <div onClick={e => e.stopPropagation()} style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px', color: '#fff',
        borderBottom: '1px solid rgba(255,255,255,.1)',
      }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800 }}>{boxLabel} · Manifests</div>
          {manifests.length > 0 && (
            <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>
              {activeIdx + 1} of {manifests.length}
              {overLimit && ' · ⚠ over 10 photos for one box'}
            </div>
          )}
        </div>
        <button onClick={onClose} aria-label="Close" style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: '#fff', fontSize: 24, padding: '0 6px',
        }}>×</button>
      </div>

      {/* Photo */}
      <div onClick={e => e.stopPropagation()} style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'relative', overflow: 'hidden',
      }}>
        {!active ? (
          <div style={{ color: 'rgba(255,255,255,.7)', fontSize: 14 }}>
            No manifests attached.
          </div>
        ) : !activeUrl ? (
          <div style={{ color: 'rgba(255,255,255,.7)', fontSize: 14 }}>Loading…</div>
        ) : (
          <img src={activeUrl} alt="" style={{
            maxWidth: '100%', maxHeight: '100%', objectFit: 'contain',
            cursor: 'zoom-in', userSelect: 'none',
          }} />
        )}

        {manifests.length > 1 && (
          <>
            <button onClick={() => setActiveIdx(i => Math.max(0, i - 1))}
              disabled={activeIdx === 0}
              aria-label="Previous"
              style={navBtn('left')}>‹</button>
            <button onClick={() => setActiveIdx(i => Math.min(manifests.length - 1, i + 1))}
              disabled={activeIdx === manifests.length - 1}
              aria-label="Next"
              style={navBtn('right')}>›</button>
          </>
        )}
      </div>

      {/* Bottom bar */}
      <div onClick={e => e.stopPropagation()} style={{
        padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10,
        borderTop: '1px solid rgba(255,255,255,.1)', color: 'rgba(255,255,255,.85)',
        flexWrap: 'wrap',
      }}>
        {active && (
          <div style={{ flex: 1, minWidth: 0, fontSize: 12 }}>
            <div>
              {new Date(active.uploaded_at).toLocaleString('en-US', {
                month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
              })}
              {uploader ? ` · ${uploader.name}` : ''}
              {active.is_scan_style ? ' · scan' : ' · color'}
              {' · '}{Math.round(active.file_size_bytes / 1024)} KB
            </div>
          </div>
        )}
        <button onClick={onAddAnother} style={{
          padding: '8px 14px', minHeight: 44,
          background: 'rgba(255,255,255,.10)', color: '#fff',
          border: '1px solid rgba(255,255,255,.25)', borderRadius: 6,
          cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, fontSize: 13,
        }}>+ Add another</button>
        {active && (
          <button onClick={handleDelete} style={{
            padding: '8px 14px', minHeight: 44,
            background: 'transparent', color: '#FCA5A5',
            border: '1px solid rgba(252,165,165,.4)', borderRadius: 6,
            cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, fontSize: 13,
          }}>Delete</button>
        )}
      </div>
    </div>
  )
}

function navBtn(side: 'left' | 'right'): React.CSSProperties {
  return {
    position: 'absolute',
    [side]: 8, top: '50%', transform: 'translateY(-50%)',
    width: 44, height: 44, borderRadius: '50%',
    background: 'rgba(0,0,0,.5)', color: '#fff',
    border: '1px solid rgba(255,255,255,.2)',
    fontSize: 26, lineHeight: 1, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  } as React.CSSProperties
}
