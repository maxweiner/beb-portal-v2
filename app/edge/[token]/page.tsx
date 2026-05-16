// Public batch page at /edge/[token] — Mary's link from the email.
// No login. Token is the random ~24-char URL slug minted at send time.
//
// What it shows:
//   - Batch header (code, sender, date, item count, notes)
//   - Per-item card grid: SKU, description, price, photo thumbnails
//   - Per-photo signed download links (one-click save with friendly filename)
//   - CSV download link
//   - "Download all photos" client button (triggers each download in sequence)
//
// Tracking: first_viewed_at / last_viewed_at / view_count are updated
// server-side on page load (best-effort; failures don't 500 the page).

import Link from 'next/link'
import { pdfAdmin, PHOTO_BUCKET } from '@/lib/wholesale/pdfHelpers'
import { signBatchPhotoUrl } from '@/lib/wholesale/edgePhotos'
import EdgePublicBatchClient from './EdgePublicBatchClient'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: { token: string }
}

export default async function EdgePublicBatchPage({ params }: PageProps) {
  const token = params.token
  if (!token || token.length < 8 || token.length > 64) {
    return <NotFound />
  }
  const sb = pdfAdmin()
  const { data: batch } = await sb.from('edge_batches')
    .select('*').eq('public_token', token).maybeSingle()
  if (!batch) return <NotFound />
  if (batch.status === 'revoked') return <Revoked reason={batch.revoked_reason} />

  // Bump view tracking (best-effort).
  const nowIso = new Date().toISOString()
  await sb.from('edge_batches').update({
    first_viewed_at: batch.first_viewed_at || nowIso,
    last_viewed_at: nowIso,
    view_count: (batch.view_count || 0) + 1,
    // If this is the first view AND the email succeeded, flip to 'viewed'.
    ...(batch.status === 'sent' ? { status: 'viewed' } : {}),
  }).eq('id', batch.id)

  // Load items + sign each photo URL.
  const { data: items } = await sb.from('edge_batch_items')
    .select('*').eq('batch_id', batch.id).order('position', { ascending: true })

  const itemsWithUrls = await Promise.all((items || []).map(async (it: any) => {
    const urls = await Promise.all((it.photo_paths || []).map(async (p: string) => ({
      filename: p.split('/').pop() || '',
      url: await signBatchPhotoUrl(p),
    })))
    return { ...it, photoLinks: urls.filter(u => u.url) as { filename: string; url: string }[] }
  }))

  // Sign the CSV URL too.
  let csvUrl: string | null = null
  if (batch.csv_path) {
    const { data: signed } = await sb.storage.from(PHOTO_BUCKET).createSignedUrl(batch.csv_path, 60 * 60 * 24, {
      download: `${batch.batch_code}.csv`,
    })
    csvUrl = signed?.signedUrl || null
  }

  return (
    <EdgePublicBatchClient
      batch={batch}
      items={itemsWithUrls}
      csvUrl={csvUrl}
      zipUrl={`/api/wholesale/edge/public/${token}/zip`}
    />
  )
}

function NotFound() {
  return (
    <Frame>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1f2937', marginBottom: 8 }}>Batch not found</h1>
      <p style={{ color: '#6b7280' }}>The link you followed doesn&apos;t match any active batch. If you think this is a mistake, reply to the original email so we can resend.</p>
    </Frame>
  )
}

function Revoked({ reason }: { reason?: string | null }) {
  return (
    <Frame>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1f2937', marginBottom: 8 }}>This batch has been revoked</h1>
      <p style={{ color: '#6b7280' }}>{reason || 'The sender revoked this batch. Reply to the original email if you still need access.'}</p>
    </Frame>
  )
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: '#FAF8F4', padding: 24 }}>
      <div style={{ maxWidth: 600, margin: '64px auto', padding: 32, background: '#fff', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,.06)' }}>
        {children}
      </div>
    </div>
  )
}
