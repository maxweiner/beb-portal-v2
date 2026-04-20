'use client'

import { useState, useCallback, useRef } from 'react'
import Cropper from 'react-easy-crop'
import type { Area } from 'react-easy-crop'

// ── Stock Avatar Library (40 avatars) ──
const STOCK_AVATARS: { id: string; svg: string; category: string }[] = [
  // Emoji faces (14)
  { id: 's1', category: 'emoji', svg: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="45" fill="#FFD93D"/><circle cx="35" cy="40" r="5" fill="#333"/><circle cx="65" cy="40" r="5" fill="#333"/><path d="M30 60 Q50 80 70 60" stroke="#333" stroke-width="3" fill="none"/></svg>' },
  { id: 's2', category: 'emoji', svg: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="45" fill="#FF6B6B"/><circle cx="35" cy="40" r="5" fill="#fff"/><circle cx="65" cy="40" r="5" fill="#fff"/><path d="M30 60 Q50 80 70 60" stroke="#fff" stroke-width="3" fill="none"/></svg>' },
  { id: 's3', category: 'emoji', svg: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="45" fill="#74C0FC"/><circle cx="35" cy="40" r="5" fill="#333"/><circle cx="65" cy="40" r="5" fill="#333"/><ellipse cx="50" cy="62" rx="8" ry="6" fill="#333"/></svg>' },
  { id: 's4', category: 'emoji', svg: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="45" fill="#A9DC76"/><path d="M30 38 L40 42 L30 46" fill="#333"/><path d="M60 38 L70 42 L60 46" fill="#333"/><path d="M35 60 Q50 75 65 60" stroke="#333" stroke-width="3" fill="none"/></svg>' },
  { id: 's5', category: 'emoji', svg: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="45" fill="#FFB347"/><circle cx="35" cy="38" r="6" fill="#333"/><circle cx="65" cy="38" r="6" fill="#333"/><path d="M32 58 Q50 78 68 58" stroke="#333" stroke-width="3" fill="#fff"/></svg>' },
  { id: 's6', category: 'emoji', svg: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="45" fill="#C3A6FF"/><line x1="30" y1="40" x2="42" y2="40" stroke="#333" stroke-width="3" stroke-linecap="round"/><line x1="58" y1="40" x2="70" y2="40" stroke="#333" stroke-width="3" stroke-linecap="round"/><line x1="35" y1="62" x2="65" y2="62" stroke="#333" stroke-width="3" stroke-linecap="round"/></svg>' },
  { id: 's7', category: 'emoji', svg: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="45" fill="#FF9FF3"/><circle cx="35" cy="40" r="5" fill="#333"/><circle cx="65" cy="40" r="5" fill="#333"/><path d="M35 60 Q50 70 65 60" stroke="#333" stroke-width="2" fill="none"/><circle cx="25" cy="55" r="8" fill="#FF6B81" opacity=".3"/><circle cx="75" cy="55" r="8" fill="#FF6B81" opacity=".3"/></svg>' },
  { id: 's8', category: 'emoji', svg: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="45" fill="#48DBFB"/><circle cx="35" cy="38" r="7" fill="#fff"/><circle cx="35" cy="38" r="4" fill="#333"/><circle cx="65" cy="38" r="7" fill="#fff"/><circle cx="65" cy="38" r="4" fill="#333"/><path d="M35 62 Q50 72 65 62" stroke="#333" stroke-width="2" fill="none"/></svg>' },
  { id: 's9', category: 'emoji', svg: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="45" fill="#FECA57"/><path d="M28 35 Q35 30 42 38" stroke="#333" stroke-width="2.5" fill="none"/><path d="M58 38 Q65 30 72 35" stroke="#333" stroke-width="2.5" fill="none"/><path d="M33 58 Q50 75 67 58" stroke="#333" stroke-width="3" fill="none"/></svg>' },
  { id: 's10', category: 'emoji', svg: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="45" fill="#FF6348"/><circle cx="35" cy="38" r="5" fill="#fff"/><circle cx="65" cy="38" r="5" fill="#fff"/><path d="M35 58 Q50 72 65 58" stroke="#fff" stroke-width="3" fill="#fff"/></svg>' },
  { id: 's11', category: 'emoji', svg: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="45" fill="#7BED9F"/><circle cx="35" cy="40" r="4" fill="#333"/><circle cx="65" cy="40" r="4" fill="#333"/><path d="M40 58 L50 68 L60 58" stroke="#333" stroke-width="2.5" fill="none"/></svg>' },
  { id: 's12', category: 'emoji', svg: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="45" fill="#DFE6E9"/><circle cx="35" cy="40" r="5" fill="#636E72"/><circle cx="65" cy="40" r="5" fill="#636E72"/><path d="M38 62 Q50 56 62 62" stroke="#636E72" stroke-width="2.5" fill="none"/></svg>' },
  { id: 's13', category: 'emoji', svg: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="45" fill="#FDCB6E"/><rect x="28" y="36" width="18" height="8" rx="2" fill="#333"/><rect x="54" y="36" width="18" height="8" rx="2" fill="#333"/><path d="M35 60 Q50 72 65 60" stroke="#333" stroke-width="2.5" fill="none"/></svg>' },
  { id: 's14', category: 'emoji', svg: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="45" fill="#E17055"/><circle cx="35" cy="40" r="5" fill="#fff"/><circle cx="65" cy="40" r="5" fill="#fff"/><ellipse cx="50" cy="63" rx="12" ry="8" fill="#fff"/></svg>' },
  // People silhouettes (14)
  { id: 'p1', category: 'people', svg: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="45" fill="#2C3E50"/><circle cx="50" cy="35" r="14" fill="#ECF0F1"/><path d="M25 85 Q25 58 50 55 Q75 58 75 85" fill="#ECF0F1"/></svg>' },
  { id: 'p2', category: 'people', svg: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="45" fill="#8E44AD"/><circle cx="50" cy="35" r="14" fill="#fff"/><path d="M25 85 Q25 58 50 55 Q75 58 75 85" fill="#fff"/></svg>' },
  { id: 'p3', category: 'people', svg: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="45" fill="#27AE60"/><circle cx="50" cy="35" r="14" fill="#fff"/><path d="M25 85 Q25 58 50 55 Q75 58 75 85" fill="#fff"/></svg>' },
  { id: 'p4', category: 'people', svg: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="45" fill="#E74C3C"/><circle cx="50" cy="35" r="14" fill="#fff"/><path d="M25 85 Q25 58 50 55 Q75 58 75 85" fill="#fff"/></svg>' },
  { id: 'p5', category: 'people', svg: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="45" fill="#3498DB"/><circle cx="50" cy="35" r="14" fill="#fff"/><path d="M25 85 Q25 58 50 55 Q75 58 75 85" fill="#fff"/></svg>' },
  { id: 'p6', category: 'people', svg: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="45" fill="#F39C12"/><circle cx="50" cy="35" r="14" fill="#fff"/><path d="M25 85 Q25 58 50 55 Q75 58 75 85" fill="#fff"/></svg>' },
  { id: 'p7', category: 'people', svg: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="45" fill="#1ABC9C"/><circle cx="50" cy="32" r="12" fill="#fff"/><path d="M28 85 Q28 55 50 52 Q72 55 72 85" fill="#fff"/><path d="M35 28 Q50 18 65 28" stroke="#fff" stroke-width="3" fill="none"/></svg>' },
  { id: 'p8', category: 'people', svg: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="45" fill="#E67E22"/><circle cx="50" cy="32" r="12" fill="#fff"/><path d="M28 85 Q28 55 50 52 Q72 55 72 85" fill="#fff"/><circle cx="50" cy="25" r="16" fill="none" stroke="#fff" stroke-width="2"/></svg>' },
  { id: 'p9', category: 'people', svg: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="45" fill="#9B59B6"/><circle cx="50" cy="33" r="13" fill="#D2B4DE"/><path d="M26 85 Q26 56 50 53 Q74 56 74 85" fill="#D2B4DE"/></svg>' },
  { id: 'p10', category: 'people', svg: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="45" fill="#34495E"/><circle cx="50" cy="33" r="13" fill="#95A5A6"/><path d="M26 85 Q26 56 50 53 Q74 56 74 85" fill="#95A5A6"/></svg>' },
  { id: 'p11', category: 'people', svg: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="45" fill="#16A085"/><circle cx="50" cy="33" r="13" fill="#A3E4D7"/><path d="M26 85 Q26 56 50 53 Q74 56 74 85" fill="#A3E4D7"/><path d="M37 26 Q50 16 63 26" fill="#A3E4D7"/></svg>' },
  { id: 'p12', category: 'people', svg: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="45" fill="#2980B9"/><circle cx="50" cy="33" r="13" fill="#AED6F1"/><path d="M26 85 Q26 56 50 53 Q74 56 74 85" fill="#AED6F1"/><rect x="40" y="20" width="20" height="5" rx="2" fill="#AED6F1"/></svg>' },
  { id: 'p13', category: 'people', svg: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="45" fill="#C0392B"/><circle cx="50" cy="33" r="13" fill="#F5B7B1"/><path d="M26 85 Q26 56 50 53 Q74 56 74 85" fill="#F5B7B1"/></svg>' },
  { id: 'p14', category: 'people', svg: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="45" fill="#7F8C8D"/><circle cx="50" cy="33" r="13" fill="#D5DBDB"/><path d="M26 85 Q26 56 50 53 Q74 56 74 85" fill="#D5DBDB"/></svg>' },
  // Colored initials backgrounds (12)
  { id: 'c1', category: 'color', svg: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="45" fill="#667EEA"/></svg>' },
  { id: 'c2', category: 'color', svg: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="45" fill="#F5576C"/></svg>' },
  { id: 'c3', category: 'color', svg: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="45" fill="#4FACFE"/></svg>' },
  { id: 'c4', category: 'color', svg: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="45" fill="#43E97B"/></svg>' },
  { id: 'c5', category: 'color', svg: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="45" fill="#FA709A"/></svg>' },
  { id: 'c6', category: 'color', svg: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="45" fill="#A18CD1"/></svg>' },
  { id: 'c7', category: 'color', svg: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="45" fill="#FFD26F"/></svg>' },
  { id: 'c8', category: 'color', svg: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="45" fill="#E44D26"/></svg>' },
  { id: 'c9', category: 'color', svg: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="45" fill="#1D6B44"/></svg>' },
  { id: 'c10', category: 'color', svg: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="45" fill="#2C3E50"/></svg>' },
  { id: 'c11', category: 'color', svg: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="45" fill="#8B4513"/></svg>' },
  { id: 'c12', category: 'color', svg: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="45" fill="#203A43"/></svg>' },
]

const svgToDataUrl = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg)}`

async function getCroppedImg(imageSrc: string, crop: Area): Promise<string> {
  const image = new Image()
  image.crossOrigin = 'anonymous'
  await new Promise((resolve, reject) => {
    image.onload = resolve
    image.onerror = reject
    image.src = imageSrc
  })
  const canvas = document.createElement('canvas')
  const size = 200
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2)
  ctx.clip()
  const sx = (crop.x / 100) * image.naturalWidth
  const sy = (crop.y / 100) * image.naturalHeight
  const sw = (crop.width / 100) * image.naturalWidth
  const sh = (crop.height / 100) * image.naturalHeight
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, size, size)
  return canvas.toDataURL('image/jpeg', 0.85)
}

interface Props {
  currentPhoto: string
  userName: string
  onSave: (dataUrl: string) => Promise<void>
  onClose: () => void
}

export default function AvatarPicker({ currentPhoto, userName, onSave, onClose }: Props) {
  const [tab, setTab] = useState<'stock' | 'upload'>('stock')
  const [category, setCategory] = useState<'all' | 'emoji' | 'people' | 'color'>('all')
  const [saving, setSaving] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [uploadSrc, setUploadSrc] = useState<string | null>(null)
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [croppedArea, setCroppedArea] = useState<Area | null>(null)
  const [uploadError, setUploadError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const filtered = category === 'all' ? STOCK_AVATARS : STOCK_AVATARS.filter(a => a.category === category)

  const onCropComplete = useCallback((_: Area, pct: Area) => { setCroppedArea(pct) }, [])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadError('')
    if (!file.type.match(/^image\/(jpeg|png)$/)) { setUploadError('Only JPG and PNG files are allowed.'); return }
    if (file.size > 2 * 1024 * 1024) { setUploadError('File must be under 2MB.'); return }
    const reader = new FileReader()
    reader.onload = () => { setUploadSrc(reader.result as string); setCrop({ x: 0, y: 0 }); setZoom(1) }
    reader.readAsDataURL(file)
  }

  const handleSaveStock = async (avatar: typeof STOCK_AVATARS[0]) => {
    setSaving(true)
    setSelectedId(avatar.id)
    try {
      const canvas = document.createElement('canvas')
      canvas.width = 200
      canvas.height = 200
      const ctx = canvas.getContext('2d')!
      const img = new Image()
      await new Promise((resolve) => { img.onload = resolve; img.src = svgToDataUrl(avatar.svg) })
      ctx.drawImage(img, 0, 0, 200, 200)
      if (avatar.category === 'color') {
        ctx.fillStyle = '#fff'
        ctx.font = 'bold 80px -apple-system, sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(userName?.charAt(0)?.toUpperCase() || '?', 100, 105)
      }
      await onSave(canvas.toDataURL('image/png'))
    } catch { /* ignore */ }
    setSaving(false)
  }

  const handleSaveCrop = async () => {
    if (!uploadSrc || !croppedArea) return
    setSaving(true)
    try {
      const cropped = await getCroppedImg(uploadSrc, croppedArea)
      await onSave(cropped)
    } catch { setUploadError('Failed to crop image. Try another file.') }
    setSaving(false)
  }

  return (
    <div onClick={e => e.target === e.currentTarget && onClose()}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: 'var(--cream)', borderRadius: 16, maxWidth: 520, width: '100%', maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>

        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--pearl)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontWeight: 900, fontSize: 18, color: 'var(--ink)' }}>Choose Avatar</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, color: 'var(--mist)', cursor: 'pointer' }}>×</button>
        </div>

        <div style={{ display: 'flex', gap: 4, padding: '12px 24px', borderBottom: '1px solid var(--pearl)' }}>
          {(['stock', 'upload'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{ padding: '8px 20px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13,
                background: tab === t ? 'var(--green)' : 'var(--cream2)', color: tab === t ? '#fff' : 'var(--ash)' }}>
              {t === 'stock' ? '🎨 Avatar Library' : '📷 Upload Photo'}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          {tab === 'stock' && (
            <>
              <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
                {(['all', 'emoji', 'people', 'color'] as const).map(c => (
                  <button key={c} onClick={() => setCategory(c)}
                    style={{ padding: '5px 14px', borderRadius: 20, border: '1px solid var(--pearl)', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                      background: category === c ? 'var(--green-pale)' : 'var(--cream2)', color: category === c ? 'var(--green-dark)' : 'var(--ash)' }}>
                    {c === 'all' ? 'All' : c === 'emoji' ? '😊 Emoji' : c === 'people' ? '👤 Silhouettes' : '🎨 Initials'}
                  </button>
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10 }}>
                {filtered.map(a => (
                  <button key={a.id} onClick={() => handleSaveStock(a)} disabled={saving}
                    style={{ width: '100%', aspectRatio: '1', borderRadius: '50%', border: selectedId === a.id ? '3px solid var(--green)' : '2px solid var(--pearl)',
                      cursor: 'pointer', padding: 4, background: 'var(--cream2)', overflow: 'hidden', opacity: saving ? 0.5 : 1, position: 'relative' }}>
                    {a.category === 'color' ? (
                      <div style={{ width: '100%', height: '100%', borderRadius: '50%', position: 'relative', background: a.svg.match(/fill="([^"]+)"/)?.[1] || '#667EEA', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <span style={{ color: '#fff', fontWeight: 900, fontSize: 24 }}>{userName?.charAt(0)?.toUpperCase() || '?'}</span>
                      </div>
                    ) : (
                      <img src={svgToDataUrl(a.svg)} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%' }} />
                    )}
                  </button>
                ))}
              </div>
            </>
          )}

          {tab === 'upload' && (
            <div>
              <div style={{ fontSize: 13, color: 'var(--mist)', marginBottom: 16, lineHeight: 1.6 }}>
                Upload a photo and crop it to a circle. <strong>JPG or PNG only, max 2MB.</strong>
              </div>
              {!uploadSrc ? (
                <div>
                  <button onClick={() => fileRef.current?.click()}
                    style={{ width: '100%', padding: '40px 20px', borderRadius: 12, border: '2px dashed var(--pearl)', background: 'var(--cream2)', cursor: 'pointer', color: 'var(--ash)', fontSize: 14, fontWeight: 600 }}>
                    📷 Click to select a photo
                  </button>
                  <input ref={fileRef} type="file" accept=".jpg,.jpeg,.png" style={{ display: 'none' }} onChange={handleFileSelect} />
                  {uploadError && <div style={{ color: '#DC2626', fontSize: 13, fontWeight: 600, marginTop: 8 }}>⚠ {uploadError}</div>}
                </div>
              ) : (
                <div>
                  <div style={{ position: 'relative', width: '100%', height: 300, borderRadius: 12, overflow: 'hidden', background: '#000' }}>
                    <Cropper image={uploadSrc} crop={crop} zoom={zoom} aspect={1} cropShape="round" showGrid={false}
                      onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={onCropComplete} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
                    <span style={{ fontSize: 12, color: 'var(--mist)' }}>Zoom</span>
                    <input type="range" min={1} max={3} step={0.1} value={zoom} onChange={e => setZoom(Number(e.target.value))} style={{ flex: 1 }} />
                  </div>
                  {uploadError && <div style={{ color: '#DC2626', fontSize: 13, fontWeight: 600, marginTop: 8 }}>⚠ {uploadError}</div>}
                  <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                    <button onClick={handleSaveCrop} disabled={saving} className="btn-primary" style={{ flex: 1 }}>
                      {saving ? 'Saving…' : 'Save Photo'}
                    </button>
                    <button onClick={() => { setUploadSrc(null); setUploadError('') }} className="btn-outline">Choose Different</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
