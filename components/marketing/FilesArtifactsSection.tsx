'use client'

// Unified per-campaign Files & Artifacts view. Aggregates everything
// stored against this campaign across multiple tables and storage
// buckets so partners + admins can see the full audit trail in one
// place:
//   - Every proof version (latest first), each w/ file count
//   - Postcard CSV upload audit rows (postcard_uploads)
//   - The accountant receipt PDF (marketing-pdfs/{campaign_id}.pdf)
//
// Per-row "Open" / "Copy link" actions reuse the existing signed-url
// pipelines. The single "Download all" zip from the spec is deferred —
// individual downloads cover the immediate workflow without pulling
// in a server-side zip dependency.

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface ProofRow {
  id: string
  version_number: number
  is_latest: boolean
  status: string
  uploaded_at: string
  file_urls: string[]
}

interface UploadRow {
  id: string
  uploaded_at: string
  original_filename: string | null
  total_rows: number | null
  new_rows: number | null
  duplicate_rows: number | null
}

export default function FilesArtifactsSection({ campaignId, flowType, accountantReceiptSentAt }: {
  campaignId: string
  flowType: 'vdp' | 'postcard' | 'newspaper'
  accountantReceiptSentAt: string | null
}) {
  const [proofs, setProofs] = useState<ProofRow[]>([])
  const [uploads, setUploads] = useState<UploadRow[]>([])
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const [
        { data: ps },
        { data: us },
      ] = await Promise.all([
        supabase.from('marketing_proofs')
          .select('id, version_number, is_latest, status, uploaded_at, file_urls')
          .eq('campaign_id', campaignId).order('version_number', { ascending: false }),
        flowType === 'postcard'
          ? supabase.from('postcard_uploads')
            .select('id, uploaded_at, original_filename, total_rows, new_rows, duplicate_rows')
            .eq('campaign_id', campaignId).order('uploaded_at', { ascending: false }).limit(20)
          : Promise.resolve({ data: [] as UploadRow[] }),
      ])
      if (cancelled) return
      setProofs((ps ?? []) as ProofRow[])
      setUploads((us ?? []) as UploadRow[])

      // Sign the accountant PDF URL on demand so it expires with normal
      // signed-URL semantics. Only attempt if we know the receipt was
      // sent (i.e., the file exists).
      if (accountantReceiptSentAt) {
        const { data: signed } = await supabase.storage.from('marketing-pdfs')
          .createSignedUrl(`${campaignId}.pdf`, 3600)
        if (!cancelled) setPdfUrl(signed?.signedUrl || null)
      } else {
        setPdfUrl(null)
      }
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [campaignId, flowType, accountantReceiptSentAt])

  if (loading) return (
    <div className="card" style={{ padding: 18, marginBottom: 14, color: 'var(--mist)' }}>
      Loading files…
    </div>
  )

  const noContent = proofs.length === 0 && uploads.length === 0 && !pdfUrl
  if (noContent) return null

  return (
    <div className="card" style={{ padding: 18, marginBottom: 14 }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)', marginBottom: 4 }}>
        Files &amp; Artifacts
      </div>
      <div style={{ fontSize: 12, color: 'var(--mist)', marginBottom: 14 }}>
        Everything attached to this campaign in one place.
      </div>

      {/* Accountant receipt */}
      {pdfUrl && (
        <Group title="Accountant Receipt" count={1}>
          <Row
            label="📄 Marketing receipt PDF"
            sub={accountantReceiptSentAt ? `Emailed ${new Date(accountantReceiptSentAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}
            url={pdfUrl}
          />
        </Group>
      )}

      {/* Proofs */}
      {proofs.length > 0 && (
        <Group title="Proofs" count={proofs.length}>
          {proofs.map(p => (
            <Row key={p.id}
              label={`📐 Proof v${p.version_number} ${p.is_latest ? '· latest' : ''}`}
              sub={`${p.file_urls.length} file${p.file_urls.length === 1 ? '' : 's'} · ${p.status} · ${new Date(p.uploaded_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`}
              url={null}
              countLink={p.file_urls.length}
              onCount={() => signProofFile(p.id, 0).then(u => u && window.open(u, '_blank'))}
            />
          ))}
        </Group>
      )}

      {/* Postcard uploads */}
      {uploads.length > 0 && (
        <Group title="Postcard CSV Uploads" count={uploads.length}>
          {uploads.map(u => (
            <Row key={u.id}
              label={`📂 ${u.original_filename || '(unnamed CSV)'}`}
              sub={`${u.total_rows ?? 0} rows · ${u.new_rows ?? 0} new · ${u.duplicate_rows ?? 0} duplicate · ${new Date(u.uploaded_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`}
              url={null}
            />
          ))}
        </Group>
      )}

      <div style={{ marginTop: 14, fontSize: 11, color: 'var(--mist)', fontStyle: 'italic' }}>
        Bulk "Download all" zip is on the v1.1 list — for now use the per-file links above.
      </div>
    </div>
  )
}

async function signProofFile(proofId: string, fileIndex: number): Promise<string | null> {
  const { data: sess } = await supabase.auth.getSession()
  const token = sess.session?.access_token
  const res = await fetch(`/api/marketing/proofs/${proofId}/sign-url`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ file_index: fileIndex }),
  })
  const json = await res.json().catch(() => ({}))
  return json.url || null
}

function Group({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{
        fontSize: 11, fontWeight: 800, color: 'var(--ash)',
        textTransform: 'uppercase', letterSpacing: '.05em',
        marginBottom: 6,
      }}>{title} ({count})</div>
      <div style={{ border: '1px solid var(--pearl)', borderRadius: 8, overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  )
}

function Row({ label, sub, url, countLink, onCount }: {
  label: string
  sub: string
  url: string | null
  countLink?: number
  onCount?: () => void
}) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center',
      padding: '10px 12px', borderBottom: '1px solid var(--cream2)',
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{label}</div>
        <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 2 }}>{sub}</div>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        {url && (
          <>
            <a href={url} target="_blank" rel="noreferrer" className="btn-outline btn-xs"
              style={{ textDecoration: 'none' }}>Open</a>
            <button className="btn-outline btn-xs" onClick={() => navigator.clipboard?.writeText(url)}>
              Copy
            </button>
          </>
        )}
        {countLink != null && countLink > 0 && onCount && (
          <button className="btn-outline btn-xs" onClick={onCount}>
            Open file {countLink > 1 ? '#1' : ''}
          </button>
        )}
      </div>
    </div>
  )
}
