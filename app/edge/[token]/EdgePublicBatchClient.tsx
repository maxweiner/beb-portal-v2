'use client'

// Client renderer for the public Edge batch page. Pure presentation +
// the "Download all photos" trigger (a small JS loop that clicks each
// signed download URL with a short delay so the browser doesn't fight
// us). Receives already-signed URLs from the server component above.

import { useState } from 'react'

interface PhotoLink { filename: string; url: string }

interface PublicItem {
  id: string
  position: number
  item_number_frozen: string
  snapshot: any
  photo_count: number
  photoLinks: PhotoLink[]
}

interface PublicBatch {
  batch_code: string
  recipient_name: string | null
  notes: string | null
  item_count: number
  photo_count: number
  sent_at: string | null
  created_at: string
}

interface Props {
  batch: PublicBatch
  items: PublicItem[]
  csvUrl: string | null
}

export default function EdgePublicBatchClient({ batch, items, csvUrl }: Props) {
  const [downloading, setDownloading] = useState(false)
  const allPhotos = items.flatMap(it => it.photoLinks)

  async function downloadAll() {
    if (downloading) return
    setDownloading(true)
    try {
      for (const p of allPhotos) {
        triggerDownload(p.url, p.filename)
        // Browsers throttle/cancel rapid back-to-back downloads. 180ms
        // is plenty to keep the queue alive without bunching.
        await new Promise(r => setTimeout(r, 180))
      }
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#FAF8F4', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif', color: '#1f2937' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 20px' }}>
        {/* Header */}
        <div style={{ background: '#fff', borderRadius: 12, padding: 24, marginBottom: 20, boxShadow: '0 1px 3px rgba(0,0,0,.06)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#1D6B44', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>
                Liberty Estate Buyers · Inventory Batch
              </div>
              <h1 style={{ fontSize: 26, fontWeight: 900, margin: '0 0 8px', color: '#1f2937' }}>{batch.batch_code}</h1>
              <div style={{ fontSize: 13, color: '#6b7280' }}>
                {batch.item_count} item{batch.item_count === 1 ? '' : 's'} · {batch.photo_count} photo{batch.photo_count === 1 ? '' : 's'}
                {batch.sent_at && <> · sent {fmtDate(batch.sent_at)}</>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {csvUrl && (
                <a href={csvUrl} download={`${batch.batch_code}.csv`}
                  style={primaryBtn}>📄 Download CSV</a>
              )}
              {allPhotos.length > 0 && (
                <button onClick={downloadAll} disabled={downloading} style={primaryBtn}>
                  {downloading ? 'Starting downloads…' : `📸 Download all ${allPhotos.length} photos`}
                </button>
              )}
            </div>
          </div>

          {batch.notes && (
            <div style={{ marginTop: 16, padding: '12px 14px', background: '#FAF8F4', borderLeft: '3px solid #1D6B44', whiteSpace: 'pre-wrap', fontSize: 14 }}>
              {batch.notes}
            </div>
          )}
        </div>

        {/* Item grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
          {items.map(it => <ItemCard key={it.id} item={it} batchCode={batch.batch_code} />)}
        </div>

        <p style={{ marginTop: 32, fontSize: 12, color: '#9ca3af', textAlign: 'center' }}>
          Questions or import issues? Reply to the email this link came from.
        </p>
      </div>
    </div>
  )
}

function ItemCard({ item, batchCode }: { item: PublicItem; batchCode: string }) {
  const s = item.snapshot || {}
  const cover = item.photoLinks[0]
  return (
    <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,.06)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ position: 'relative', paddingTop: '75%', background: '#F3F4F6' }}>
        {cover ? (
          <img src={cover.url} alt={item.item_number_frozen}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9CA3AF', fontSize: 13 }}>
            no photo
          </div>
        )}
        <div style={{ position: 'absolute', top: 8, left: 8, background: 'rgba(0,0,0,.65)', color: '#fff', padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700 }}>
          #{item.position} · {item.item_number_frozen}
        </div>
      </div>
      <div style={{ padding: 14, flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, lineHeight: 1.3 }}>
          {s.description || s.item_number}
        </div>
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>
          {[s.vendor_name, s.metal_karat, s.metal_color, s.metal_type].filter(Boolean).join(' · ')}
        </div>
        {s.stones_summary && (
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>💎 {s.stones_summary}</div>
        )}
        <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#1D6B44' }}>
            {fmtDollars(s.edge_price_cents)}
          </div>
          {s.retail_price_cents != null && (
            <div style={{ fontSize: 11, color: '#9CA3AF' }}>
              retail {fmtDollars(s.retail_price_cents)}
            </div>
          )}
        </div>
        {item.photoLinks.length > 1 && (
          <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {item.photoLinks.map((p, i) => (
              <a key={p.filename} href={p.url} download={p.filename}
                style={{ fontSize: 11, padding: '3px 8px', background: '#F3F4F6', borderRadius: 6, color: '#1f2937', textDecoration: 'none', fontWeight: 600 }}>
                ⬇ {i + 1}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function triggerDownload(url: string, filename: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  setTimeout(() => a.remove(), 50)
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return iso }
}

function fmtDollars(cents: number | null | undefined): string {
  if (cents == null) return '—'
  return `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

const primaryBtn: React.CSSProperties = {
  display: 'inline-block',
  background: '#1D6B44',
  color: '#fff',
  padding: '10px 18px',
  borderRadius: 8,
  textDecoration: 'none',
  fontWeight: 700,
  fontSize: 13,
  border: 'none',
  cursor: 'pointer',
  fontFamily: 'inherit',
}
