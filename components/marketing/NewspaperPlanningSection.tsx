'use client'

// Newspaper planning section. Mirrors the VDP / Postcard pattern with
// the simplest possible input — a single publication-name text field.
// Same three-mode layout (input / awaiting / approved), same single-
// approver quorum, same reviewer-comment loop.

import { useEffect, useState } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import type { MarketingCampaign } from '@/types'

interface NewspaperDetails {
  publication_name: string | null
  submitted_at: string | null
  submitted_by: string | null
  approved_at: string | null
  approved_by: string | null
  last_review_comment: string | null
  last_review_comment_at: string | null
  last_review_by: string | null
}

export default function NewspaperPlanningSection({ campaign, onChanged }: {
  campaign: MarketingCampaign
  onChanged: (next: MarketingCampaign) => void
}) {
  const { user } = useApp()
  const [details, setDetails] = useState<NewspaperDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [publication, setPublication] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isApprover, setIsApprover] = useState(false)
  const [reviewComment, setReviewComment] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const [{ data: det }, { data: ap }] = await Promise.all([
        supabase.from('newspaper_campaign_details').select('*').eq('campaign_id', campaign.id).maybeSingle(),
        user?.id
          ? supabase.from('marketing_approvers').select('is_active').eq('user_id', user.id).maybeSingle()
          : Promise.resolve({ data: null }),
      ])
      if (cancelled) return
      const d = (det || null) as NewspaperDetails | null
      setDetails(d)
      setPublication(d?.publication_name || '')
      setIsApprover(!!(ap as any)?.is_active)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [campaign.id, user?.id])

  const isAwaitingApproval = campaign.status === 'planning' && campaign.sub_status === 'awaiting_planning_approval'
  const isApproved = !!details?.approved_at || campaign.status === 'proofing' || campaign.status === 'payment' || campaign.status === 'done'
  const isInputMode = !isAwaitingApproval && !isApproved

  async function authedFetch(input: RequestInfo, init: RequestInit = {}) {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    return fetch(input, {
      ...init,
      headers: { ...(init.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    })
  }

  async function submit() {
    if (!publication.trim()) { setError('Publication name is required.'); return }
    setBusy(true); setError(null)
    try {
      const res = await authedFetch(`/api/marketing/campaigns/${campaign.id}/submit-planning`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publication_name: publication.trim() }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(json.error || `Failed (${res.status})`); setBusy(false); return }
      onChanged({ ...campaign, status: 'planning', sub_status: 'awaiting_planning_approval' } as MarketingCampaign)
      const { data: det } = await supabase.from('newspaper_campaign_details').select('*').eq('campaign_id', campaign.id).maybeSingle()
      setDetails(det as NewspaperDetails)
    } catch (e: any) { setError(e?.message || 'Network error') }
    setBusy(false)
  }

  async function review(decision: 'approve' | 'request_changes') {
    if (decision === 'request_changes' && !reviewComment.trim()) {
      setError('Add a comment explaining what needs to change.'); return
    }
    setBusy(true); setError(null)
    try {
      const res = await authedFetch(`/api/marketing/campaigns/${campaign.id}/review-planning`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, comment: reviewComment.trim() || null }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(json.error || `Failed (${res.status})`); setBusy(false); return }
      const { data: c } = await supabase.from('marketing_campaigns').select('*').eq('id', campaign.id).single()
      if (c) onChanged(c as MarketingCampaign)
      const { data: det } = await supabase.from('newspaper_campaign_details').select('*').eq('campaign_id', campaign.id).maybeSingle()
      setDetails(det as NewspaperDetails)
      setReviewComment('')
    } catch (e: any) { setError(e?.message || 'Network error') }
    setBusy(false)
  }

  if (loading) return (
    <div className="card" style={{ padding: 18, marginBottom: 14, color: 'var(--mist)' }}>Loading planning…</div>
  )

  return (
    <div className="card" style={{ padding: 18, marginBottom: 14 }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)', marginBottom: 4 }}>
        2. Planning — Newspaper
      </div>
      <div style={{ fontSize: 12, color: 'var(--mist)', marginBottom: 14 }}>
        {isInputMode && 'Enter the publication name and submit for approval.'}
        {isAwaitingApproval && 'Submitted and awaiting approver review.'}
        {isApproved && 'Planning approved. Move on to proofing.'}
      </div>

      {error && (
        <div style={{
          background: 'var(--red-pale)', color: '#7f1d1d',
          border: '1px solid #fecaca', borderRadius: 8,
          padding: '10px 14px', marginBottom: 14, fontSize: 13,
        }}>{error}</div>
      )}

      {details?.last_review_comment && !isApproved && (
        <div style={{
          background: '#fef9c3', color: '#854d0e',
          border: '1px solid #fde68a', borderRadius: 8,
          padding: '10px 14px', marginBottom: 14, fontSize: 13,
        }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>✎ Reviewer comment</div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{details.last_review_comment}</div>
          {details.last_review_comment_at && (
            <div style={{ fontSize: 11, marginTop: 6, color: '#92400e' }}>
              {new Date(details.last_review_comment_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
            </div>
          )}
        </div>
      )}

      {/* INPUT mode */}
      {isInputMode && (
        <>
          <div className="field" style={{ marginBottom: 14 }}>
            <label className="fl">Publication name</label>
            <input type="text" value={publication}
              onChange={e => setPublication(e.target.value)}
              placeholder='e.g. "Omaha World-Herald — Sunday edition"' />
          </div>
          <button className="btn-primary btn-sm" onClick={submit} disabled={busy || !publication.trim()}>
            {busy ? 'Submitting…' : '📤 Submit for Approval'}
          </button>
        </>
      )}

      {/* AWAITING + APPROVED — read-only summary */}
      {(isAwaitingApproval || isApproved) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: isAwaitingApproval ? 14 : 0 }}>
          <SummaryRow label="Publication" value={details?.publication_name || '—'} />
          {details?.submitted_at && (
            <div style={{ fontSize: 11, color: 'var(--mist)' }}>
              Submitted {new Date(details.submitted_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
            </div>
          )}
          {isApproved && details?.approved_at && (
            <div style={{ fontSize: 11, color: 'var(--green-dark)', fontWeight: 700 }}>
              ✓ Approved {new Date(details.approved_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
            </div>
          )}
        </div>
      )}

      {isAwaitingApproval && isApprover && (
        <div style={{
          background: 'var(--cream2)', border: '1px solid var(--pearl)', borderRadius: 8,
          padding: 12, marginTop: 4,
        }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>
            Approver actions
          </div>
          <div className="field" style={{ marginBottom: 10 }}>
            <label className="fl">Comment (required when requesting changes)</label>
            <textarea rows={2} value={reviewComment} onChange={e => setReviewComment(e.target.value)}
              placeholder="Optional approval note, or a description of what needs to change…" />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-primary btn-sm" onClick={() => review('approve')} disabled={busy}>
              {busy ? '…' : '✓ Approve'}
            </button>
            <button className="btn-outline btn-sm" onClick={() => review('request_changes')} disabled={busy}>
              ✎ Request Changes
            </button>
          </div>
        </div>
      )}

      {isAwaitingApproval && !isApprover && (
        <div style={{ fontSize: 12, color: 'var(--mist)', fontStyle: 'italic', marginTop: 6 }}>
          An approver has been notified.
        </div>
      )}
    </div>
  )
}

function SummaryRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--ink)' }}>
      <span style={{ color: 'var(--mist)' }}>{label}</span>
      <span style={{ fontWeight: 700 }}>{value}</span>
    </div>
  )
}
