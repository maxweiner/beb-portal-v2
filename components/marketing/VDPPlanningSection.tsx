'use client'

// VDP planning section — renders inside CampaignDetail when
// flow_type='vdp'. Three modes:
//   - input (status setup or sub_status=awaiting_planning_submission)
//   - awaiting (sub_status=awaiting_planning_approval) → approver sees
//     Approve / Request Changes; non-approver sees read-only state
//   - approved (status proofing+ OR details.approved_at set) → read-only
//
// Prefills the zip list with the most recent approved VDP campaign for
// the same store the first time the user opens this section on a fresh
// campaign.

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import type { MarketingCampaign } from '@/types'
import RoleLabel from './RoleLabel'

interface VdpDetails {
  vdp_count: number | null
  submitted_at: string | null
  submitted_by: string | null
  approved_at: string | null
  approved_by: string | null
  last_review_comment: string | null
  last_review_comment_at: string | null
  last_review_by: string | null
}

interface ZipRow { zip_code: string }

export default function VDPPlanningSection({ campaign, onChanged }: {
  campaign: MarketingCampaign
  onChanged: (next: MarketingCampaign) => void
}) {
  const { user, events } = useApp()
  const event = useMemo(() => events.find(e => e.id === campaign.event_id), [events, campaign.event_id])
  const storeId = event?.store_id

  const [details, setDetails] = useState<VdpDetails | null>(null)
  const [zips, setZips] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [vdpCount, setVdpCount] = useState<string>('')
  const [zipInput, setZipInput] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isApprover, setIsApprover] = useState(false)
  const [reviewComment, setReviewComment] = useState('')
  const [prefilledFromPriorAt, setPrefilledFromPriorAt] = useState<string | null>(null)

  // Load details + zips + approver status + prefill source
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const [{ data: det }, { data: zipRows }, { data: approverRow }] = await Promise.all([
        supabase.from('vdp_campaign_details').select('*').eq('campaign_id', campaign.id).maybeSingle(),
        supabase.from('vdp_zip_codes').select('zip_code').eq('campaign_id', campaign.id),
        user?.id
          ? supabase.from('marketing_approvers').select('is_active').eq('user_id', user.id).maybeSingle()
          : Promise.resolve({ data: null }),
      ])
      if (cancelled) return
      const d = (det || null) as VdpDetails | null
      const z = ((zipRows || []) as ZipRow[]).map(r => r.zip_code).sort()
      setDetails(d)
      setZips(z)
      setVdpCount(d?.vdp_count != null ? String(d.vdp_count) : '')
      setZipInput(z.join(', '))
      setIsApprover(!!(approverRow as any)?.is_active)
      setLoading(false)

      // Prefill from prior approved campaign for same store — only when
      // the current campaign has no submitted details yet AND no zips.
      const isFresh = !d?.submitted_at && z.length === 0
      if (isFresh && storeId) {
        const prefill = await fetchPriorZips(storeId, campaign.id)
        if (cancelled) return
        if (prefill && prefill.zips.length > 0) {
          setZipInput(prefill.zips.join(', '))
          setPrefilledFromPriorAt(prefill.fromDate)
        }
      }
    })()
    return () => { cancelled = true }
  }, [campaign.id, storeId, user?.id])

  const isAwaitingApproval = campaign.status === 'planning' && campaign.sub_status === 'awaiting_planning_approval'
  const isApproved = !!details?.approved_at || campaign.status === 'proofing' || campaign.status === 'payment' || campaign.status === 'done'
  const isInputMode = !isAwaitingApproval && !isApproved

  async function authedFetch(input: RequestInfo, init: RequestInit = {}) {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    return fetch(input, {
      ...init,
      headers: {
        ...(init.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
  }

  async function submit() {
    setBusy(true); setError(null)
    const parsedZips = parseZips(zipInput)
    const count = Number(vdpCount)
    if (!Number.isFinite(count) || count < 0) {
      setBusy(false); setError('VDP count must be a non-negative number.'); return
    }
    if (parsedZips.length === 0) {
      setBusy(false); setError('Enter at least one valid 5-digit zip code.'); return
    }
    try {
      const res = await authedFetch(`/api/marketing/campaigns/${campaign.id}/submit-planning`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vdp_count: count, zip_codes: parsedZips }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(json.error || `Failed (${res.status})`); setBusy(false); return }
      // Refresh local state
      onChanged({ ...campaign, status: 'planning', sub_status: 'awaiting_planning_approval' } as MarketingCampaign)
      const { data: det } = await supabase.from('vdp_campaign_details').select('*').eq('campaign_id', campaign.id).maybeSingle()
      setDetails(det as VdpDetails)
      setZips(parsedZips)
    } catch (e: any) {
      setError(e?.message || 'Network error')
    }
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
      // Refresh
      const { data: c } = await supabase.from('marketing_campaigns').select('*').eq('id', campaign.id).single()
      if (c) onChanged(c as MarketingCampaign)
      const { data: det } = await supabase.from('vdp_campaign_details').select('*').eq('campaign_id', campaign.id).maybeSingle()
      setDetails(det as VdpDetails)
      setReviewComment('')
    } catch (e: any) {
      setError(e?.message || 'Network error')
    }
    setBusy(false)
  }

  if (loading) return (
    <div className="card" style={{ padding: 18, marginBottom: 14, color: 'var(--mist)' }}>Loading planning…</div>
  )

  return (
    <div className="card" style={{ padding: 18, marginBottom: 14 }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)', marginBottom: 4 }}>
        2. Planning — VDP <RoleLabel>(Marketing Team)</RoleLabel>
      </div>
      <div style={{ fontSize: 12, color: 'var(--mist)', marginBottom: 14 }}>
        {isInputMode && 'Enter the number of VDPs to mail and the zip codes to target. Submit for approval when ready.'}
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

      {/* Last review comment (when there is one) */}
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
          {prefilledFromPriorAt && (
            <div style={{
              background: 'var(--cream2)', border: '1px solid var(--pearl)', borderRadius: 8,
              padding: '8px 12px', fontSize: 12, color: 'var(--ash)', marginBottom: 12,
            }}>
              💡 Zip list pre-filled from this store's most recent approved VDP campaign ({prefilledFromPriorAt}).
              Edit before submitting if needed.
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label className="fl"># of VDPs to mail</label>
              <input type="number" min={0} value={vdpCount}
                onChange={e => setVdpCount(e.target.value)}
                placeholder="0" />
            </div>
          </div>
          <div className="field">
            <label className="fl">Zip Codes (comma, space, or new-line separated)</label>
            <textarea rows={5} value={zipInput} onChange={e => setZipInput(e.target.value)}
              placeholder="68106, 68107, 68108" />
            <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 4 }}>
              {parseZips(zipInput).length} valid 5-digit zip code(s)
            </div>
          </div>
          <button className="btn-primary btn-sm" onClick={submit} disabled={busy}>
            {busy ? 'Submitting…' : '📤 Submit for Approval'}
          </button>
        </>
      )}

      {/* AWAITING + APPROVED — read-only summary */}
      {(isAwaitingApproval || isApproved) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: isAwaitingApproval ? 14 : 0 }}>
          <SummaryRow label="VDPs to mail" value={details?.vdp_count != null ? details.vdp_count.toLocaleString('en-US') : '—'} />
          <SummaryRow label="Zip codes" value={`${zips.length} zip code${zips.length === 1 ? '' : 's'}`} />
          {zips.length > 0 && (
            <div style={{
              background: 'var(--cream)', border: '1px solid var(--pearl)', borderRadius: 8,
              padding: 10, fontSize: 12, color: 'var(--ash)',
              maxHeight: 140, overflowY: 'auto',
              display: 'flex', flexWrap: 'wrap', gap: 6,
            }}>
              {zips.map(z => (
                <span key={z} style={{
                  background: 'var(--green-pale)', color: 'var(--green-dark)',
                  padding: '2px 8px', borderRadius: 99, fontWeight: 700,
                }}>{z}</span>
              ))}
            </div>
          )}
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

      {/* APPROVER actions when awaiting */}
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

function parseZips(raw: string): string[] {
  return Array.from(new Set(
    (raw || '').split(/[\s,;\r\n\t]+/).map(z => z.trim()).filter(z => /^\d{5}$/.test(z))
  ))
}

async function fetchPriorZips(storeId: string, currentCampaignId: string): Promise<{ zips: string[]; fromDate: string } | null> {
  // 1. Find prior approved VDP campaigns for this store, newest first.
  //    Cross-table: events.store_id = storeId AND vdp_campaign_details.approved_at IS NOT NULL.
  const { data: prior } = await supabase
    .from('marketing_campaigns')
    .select('id, event_id, events!inner(store_id, start_date), vdp_campaign_details!inner(approved_at)')
    .eq('flow_type', 'vdp')
    .eq('events.store_id', storeId)
    .neq('id', currentCampaignId)
    .not('vdp_campaign_details.approved_at', 'is', null)
    .order('start_date', { foreignTable: 'events', ascending: false })
    .limit(1)
  const row = (prior ?? [])[0] as any
  if (!row) return null
  const { data: zipRows } = await supabase
    .from('vdp_zip_codes').select('zip_code').eq('campaign_id', row.id)
  const zips = ((zipRows ?? []) as { zip_code: string }[]).map(r => r.zip_code).sort()
  return { zips, fromDate: row.events?.start_date || '' }
}
