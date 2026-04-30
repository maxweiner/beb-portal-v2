'use client'

// Proofing section in CampaignDetail. Renders when campaign.status is
// 'proofing' or beyond. Shows the latest proof prominently, prior
// versions collapsed under "View version history". Approvers can
// approve or comment / request revision.
//
// Approved proofs get an angled "✅ Approved" overlay on the preview
// (CSS only — the original file is never modified per spec 5c).

import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import type { MarketingCampaign } from '@/types'

interface Proof {
  id: string
  campaign_id: string
  version_number: number
  is_latest: boolean
  uploaded_by: string | null
  uploaded_at: string
  file_urls: string[]
  status: 'pending' | 'approved' | 'revision_requested'
  approved_by: string | null
  approved_at: string | null
}

interface Comment {
  id: string
  proof_id: string
  commenter_id: string | null
  commenter_name: string | null
  comment: string
  created_at: string
}

export default function ProofingSection({ campaign, onChanged }: {
  campaign: MarketingCampaign
  onChanged: (next: MarketingCampaign) => void
}) {
  const { user, users } = useApp()
  const [proofs, setProofs] = useState<Proof[]>([])
  const [commentsByProof, setCommentsByProof] = useState<Record<string, Comment[]>>({})
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [isApprover, setIsApprover] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const userById = useMemo(() => new Map(users.map(u => [u.id, u])), [users])

  async function load() {
    setLoading(true)
    const [{ data: ps }, { data: ap }] = await Promise.all([
      supabase.from('marketing_proofs').select('*')
        .eq('campaign_id', campaign.id).order('version_number', { ascending: false }),
      user?.id
        ? supabase.from('marketing_approvers').select('is_active').eq('user_id', user.id).maybeSingle()
        : Promise.resolve({ data: null }),
    ])
    const proofRows = (ps ?? []) as Proof[]
    setProofs(proofRows)
    setIsApprover(!!(ap as any)?.is_active)
    if (proofRows.length > 0) {
      const ids = proofRows.map(p => p.id)
      const { data: cs } = await supabase.from('marketing_proof_comments')
        .select('id, proof_id, commenter_id, commenter_name, comment, created_at')
        .in('proof_id', ids).order('created_at', { ascending: true })
      const grouped: Record<string, Comment[]> = {}
      for (const c of (cs ?? []) as Comment[]) {
        if (!grouped[c.proof_id]) grouped[c.proof_id] = []
        grouped[c.proof_id].push(c)
      }
      setCommentsByProof(grouped)
    } else {
      setCommentsByProof({})
    }
    setLoading(false)
  }

  useEffect(() => { load() /* eslint-disable-next-line */ }, [campaign.id])

  async function authedFetch(input: RequestInfo, init: RequestInit = {}) {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    return fetch(input, {
      ...init,
      headers: { ...(init.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    })
  }

  async function uploadFiles(files: FileList) {
    if (files.length === 0) return
    setUploading(true); setError(null)
    const fd = new FormData()
    for (let i = 0; i < files.length; i++) fd.append('files', files[i])
    try {
      const res = await authedFetch(`/api/marketing/campaigns/${campaign.id}/proofs/upload`, {
        method: 'POST', body: fd,
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error || `Upload failed (${res.status})`)
      } else {
        // Refresh
        await load()
        // Reflect campaign status update
        if (campaign.status !== 'proofing' || campaign.sub_status !== 'awaiting_proof_approval') {
          onChanged({ ...campaign, status: 'proofing', sub_status: 'awaiting_proof_approval' } as MarketingCampaign)
        }
      }
    } catch (e: any) {
      setError(e?.message || 'Network error')
    }
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  const latest = proofs[0]  // ordered desc, so first is newest
  const earlier = proofs.slice(1)

  if (loading) return (
    <div className="card" style={{ padding: 18, marginBottom: 14, color: 'var(--mist)' }}>Loading proofs…</div>
  )

  return (
    <div className="card" style={{ padding: 18, marginBottom: 14 }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)', marginBottom: 4 }}>
        3. Proofing
      </div>
      <div style={{ fontSize: 12, color: 'var(--mist)', marginBottom: 14 }}>
        Upload one or more proof files (front + back of mailer). Approvers can review here or by replying "approve" to the notification email.
      </div>

      {error && (
        <div style={{
          background: 'var(--red-pale)', color: '#7f1d1d',
          border: '1px solid #fecaca', borderRadius: 8,
          padding: '10px 14px', marginBottom: 14, fontSize: 13,
        }}>{error}</div>
      )}

      {/* Upload widget */}
      <div style={{
        background: 'var(--cream)', border: '1px solid var(--pearl)', borderRadius: 8,
        padding: 12, marginBottom: 14,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap',
      }}>
        <div style={{ fontSize: 13, color: 'var(--ash)' }}>
          {latest
            ? <>Latest proof: <strong>v{latest.version_number}</strong> ({latest.file_urls.length} file{latest.file_urls.length === 1 ? '' : 's'})</>
            : <>No proofs uploaded yet.</>}
        </div>
        <button className="btn-primary btn-sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
          {uploading ? 'Uploading…' : latest ? '⬆️ Upload Revision' : '⬆️ Upload Proof'}
        </button>
        <input ref={fileRef} type="file" multiple accept="image/*,.pdf" style={{ display: 'none' }}
          onChange={e => { if (e.target.files) uploadFiles(e.target.files) }} />
      </div>

      {/* Latest proof */}
      {latest && (
        <ProofCard proof={latest} comments={commentsByProof[latest.id] || []}
          isLatest isApprover={isApprover} userById={userById}
          onAfterAction={async () => { await load(); const { data: c } = await supabase.from('marketing_campaigns').select('*').eq('id', campaign.id).single(); if (c) onChanged(c as MarketingCampaign) }}
        />
      )}

      {/* Version history */}
      {earlier.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <button onClick={() => setShowHistory(s => !s)} style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--green-dark)', fontSize: 12, fontWeight: 700,
            textDecoration: 'underline', padding: 0, fontFamily: 'inherit',
          }}>
            {showHistory ? '▲ Hide version history' : `▼ View version history (${earlier.length} earlier)`}
          </button>
          {showHistory && (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {earlier.map(p => (
                <ProofCard key={p.id} proof={p} comments={commentsByProof[p.id] || []}
                  isLatest={false} isApprover={isApprover} userById={userById}
                  onAfterAction={async () => { await load() }}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ProofCard({ proof, comments, isLatest, isApprover, userById, onAfterAction }: {
  proof: Proof
  comments: Comment[]
  isLatest: boolean
  isApprover: boolean
  userById: Map<string, { id: string; name?: string; email: string }>
  onAfterAction: () => Promise<void> | void
}) {
  const [busy, setBusy] = useState(false)
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)
  const isApproved = proof.status === 'approved'
  const approverName = proof.approved_by ? (userById.get(proof.approved_by)?.name || '(approver)') : null

  async function submit(decision: 'approve' | 'comment' | 'request_revision') {
    setBusy(true); setError(null)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess.session?.access_token
      const res = await fetch(`/api/marketing/proofs/${proof.id}/review`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ decision, comment: comment.trim() || null }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(json.error || `Failed (${res.status})`); setBusy(false); return }
      setComment('')
      await onAfterAction()
    } catch (e: any) {
      setError(e?.message || 'Network error')
    }
    setBusy(false)
  }

  return (
    <div style={{
      border: `2px solid ${isApproved ? 'var(--green)' : 'var(--pearl)'}`,
      borderRadius: 10, padding: 14,
      background: isApproved ? 'var(--green-pale)' : '#fff',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--ink)' }}>
          {isLatest && '★ '}Version {proof.version_number} · {proof.file_urls.length} file{proof.file_urls.length === 1 ? '' : 's'}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <StatusPill status={proof.status} />
          <span style={{ fontSize: 11, color: 'var(--mist)' }}>
            Uploaded {new Date(proof.uploaded_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
          </span>
        </div>
      </div>

      {/* File previews */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginBottom: 10 }}>
        {proof.file_urls.map((path, i) => (
          <ProofFilePreview key={i} proofId={proof.id} fileIndex={i} path={path} approved={isApproved} approverName={approverName} approvedAt={proof.approved_at} />
        ))}
      </div>

      {isApproved && approverName && proof.approved_at && (
        <div style={{ fontSize: 12, color: 'var(--green-dark)', fontWeight: 700, marginBottom: 10 }}>
          ✓ Approved by {approverName} on {new Date(proof.approved_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
        </div>
      )}

      {/* Comments */}
      {comments.length > 0 && (
        <div style={{
          background: 'var(--cream)', border: '1px solid var(--pearl)', borderRadius: 8,
          padding: 10, marginBottom: 10,
        }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>
            Comments ({comments.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {comments.map(c => (
              <div key={c.id} style={{ fontSize: 12, color: 'var(--ink)' }}>
                <div style={{ fontWeight: 700 }}>{c.commenter_name || '(unknown)'}<span style={{ fontWeight: 400, color: 'var(--mist)', marginLeft: 6 }}>· {new Date(c.created_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</span></div>
                <div style={{ whiteSpace: 'pre-wrap' }}>{c.comment}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Action area — only on latest, not when already approved */}
      {isLatest && !isApproved && (
        <div style={{
          background: 'var(--cream2)', border: '1px solid var(--pearl)', borderRadius: 8, padding: 10,
        }}>
          <div className="field" style={{ marginBottom: 10 }}>
            <label className="fl">Comment (optional for approve, required to request revision)</label>
            <textarea rows={2} value={comment} onChange={e => setComment(e.target.value)}
              placeholder="Anything to flag…" />
          </div>
          {error && (
            <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 8 }}>{error}</div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {isApprover && (
              <button className="btn-primary btn-sm" onClick={() => submit('approve')} disabled={busy}>
                {busy ? '…' : '✓ Approve'}
              </button>
            )}
            {isApprover && (
              <button className="btn-outline btn-sm" onClick={() => submit('request_revision')} disabled={busy}>
                ✎ Request Revision
              </button>
            )}
            <button className="btn-outline btn-sm" onClick={() => submit('comment')} disabled={busy || !comment.trim()}>
              💬 Add Comment
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function StatusPill({ status }: { status: Proof['status'] }) {
  const map: Record<Proof['status'], { label: string; bg: string; fg: string }> = {
    pending:            { label: 'Pending Review', bg: '#FEF3C7', fg: '#92400E' },
    approved:           { label: 'Approved',       bg: 'var(--green-pale)', fg: 'var(--green-dark)' },
    revision_requested: { label: 'Needs Edits',    bg: '#FEE2E2', fg: '#991B1B' },
  }
  const m = map[status]
  return (
    <span style={{
      fontSize: 10, fontWeight: 800, padding: '3px 8px', borderRadius: 99,
      background: m.bg, color: m.fg, textTransform: 'uppercase', letterSpacing: '.05em',
    }}>{m.label}</span>
  )
}

function ProofFilePreview({ proofId, fileIndex, path, approved, approverName, approvedAt }: {
  proofId: string
  fileIndex: number
  path: string
  approved: boolean
  approverName: string | null
  approvedAt: string | null
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const filename = path.split('/').pop() || `file-${fileIndex + 1}`
  const isImage = /\.(png|jpe?g|gif|webp)$/i.test(filename)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
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
      if (!cancelled) {
        setUrl(json.url || null)
        setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [proofId, fileIndex])

  return (
    <div style={{ position: 'relative', border: '1px solid var(--pearl)', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
      {loading || !url ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--mist)', fontSize: 12 }}>Loading…</div>
      ) : isImage ? (
        <img src={url} alt={filename}
          style={{ display: 'block', width: '100%', maxHeight: 280, objectFit: 'contain', cursor: 'pointer' }}
          onClick={() => window.open(url, '_blank')} />
      ) : (
        <a href={url} target="_blank" rel="noreferrer" style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          padding: 24, textDecoration: 'none', color: 'var(--ink)',
        }}>
          <div style={{ fontSize: 36 }}>📄</div>
          <div style={{ fontSize: 12, fontWeight: 700, marginTop: 6, wordBreak: 'break-word' }}>{filename}</div>
        </a>
      )}
      {/* Approved overlay (CSS-only, original file is never modified) */}
      {approved && url && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%) rotate(-12deg)',
          background: 'rgba(29, 107, 68, .85)',
          color: '#fff', padding: '8px 24px',
          fontSize: 18, fontWeight: 900, letterSpacing: '.1em',
          borderRadius: 8, border: '3px solid #fff',
          textTransform: 'uppercase', pointerEvents: 'none',
          textAlign: 'center', whiteSpace: 'nowrap',
        }}>
          ✓ Approved
          {approverName && (
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.05em', marginTop: 2 }}>
              {approverName}
              {approvedAt && <span> · {new Date(approvedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>}
            </div>
          )}
        </div>
      )}
      <div style={{
        padding: '6px 10px', borderTop: '1px solid var(--cream2)',
        fontSize: 11, color: 'var(--mist)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{filename}</div>
    </div>
  )
}
