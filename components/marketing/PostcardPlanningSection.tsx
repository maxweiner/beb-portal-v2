'use client'

// Postcard planning section. Mirrors VDPPlanningSection's three-mode
// layout (input / awaiting / approved). Differences:
//   - Inputs are filter controls (max age, max proximity) instead of
//     count + zips. Postcard count is derived from filter + master list.
//   - Includes a CSV upload widget that adds rows to the store's
//     master list (additive, dedup by address+zip).
//   - Pre-fills filter settings from the most recent prior approved
//     postcard campaign for the same store.
//
// Proximity is captured but not yet enforced server-side — needs
// geocoded lat/lng on store_postcard_lists. Phase 12 (or later)
// integration will switch on the filter.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import type { MarketingCampaign } from '@/types'
import RoleLabel from './RoleLabel'

interface PostcardDetails {
  postcard_count: number | null
  submitted_at: string | null
  submitted_by: string | null
  approved_at: string | null
  approved_by: string | null
  selected_filter_max_record_age_days: number | null
  selected_filter_max_proximity_miles: number | null
  last_review_comment: string | null
  last_review_comment_at: string | null
  last_review_by: string | null
}

interface UploadHistory {
  id: string
  uploaded_at: string
  original_filename: string | null
  total_rows: number | null
  new_rows: number | null
  duplicate_rows: number | null
}

export default function PostcardPlanningSection({ campaign, onChanged }: {
  campaign: MarketingCampaign
  onChanged: (next: MarketingCampaign) => void
}) {
  const { user, events } = useApp()
  const event = useMemo(() => events.find(e => e.id === campaign.event_id), [events, campaign.event_id])
  const storeId = event?.store_id

  const [details, setDetails] = useState<PostcardDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [maxAge, setMaxAge] = useState<string>('')
  const [maxProx, setMaxProx] = useState<string>('')
  const [matchCount, setMatchCount] = useState<number | null>(null)
  const [masterListSize, setMasterListSize] = useState<number>(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isApprover, setIsApprover] = useState(false)
  const [reviewComment, setReviewComment] = useState('')
  const [uploads, setUploads] = useState<UploadHistory[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState<{ total: number; new: number; duplicate: number; invalid: number } | null>(null)
  const [prefilled, setPrefilled] = useState<{ from: string; maxAge?: number | null; maxProx?: number | null } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const isAwaitingApproval = campaign.status === 'planning' && campaign.sub_status === 'awaiting_planning_approval'
  const isApproved = !!details?.approved_at || campaign.status === 'proofing' || campaign.status === 'payment' || campaign.status === 'done'
  const isInputMode = !isAwaitingApproval && !isApproved

  // Load: details, master list size, upload history, approver flag.
  // Pre-fill filters from prior approved postcard campaign if fresh.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!storeId) { setLoading(false); return }
      setLoading(true)
      const [
        { data: det },
        { count: listCount },
        { data: ups },
        { data: approverRow },
      ] = await Promise.all([
        supabase.from('postcard_campaign_details').select('*').eq('campaign_id', campaign.id).maybeSingle(),
        supabase.from('store_postcard_lists').select('id', { count: 'exact', head: true }).eq('store_id', storeId),
        supabase.from('postcard_uploads')
          .select('id, uploaded_at, original_filename, total_rows, new_rows, duplicate_rows')
          .eq('campaign_id', campaign.id).order('uploaded_at', { ascending: false }).limit(10),
        user?.id
          ? supabase.from('marketing_approvers').select('is_active').eq('user_id', user.id).maybeSingle()
          : Promise.resolve({ data: null }),
      ])
      if (cancelled) return
      const d = (det || null) as PostcardDetails | null
      setDetails(d)
      setMaxAge(d?.selected_filter_max_record_age_days != null ? String(d.selected_filter_max_record_age_days) : '')
      setMaxProx(d?.selected_filter_max_proximity_miles != null ? String(d.selected_filter_max_proximity_miles) : '')
      setMasterListSize(listCount ?? 0)
      setUploads((ups ?? []) as UploadHistory[])
      setIsApprover(!!(approverRow as any)?.is_active)
      setLoading(false)

      // Prefill from prior approved postcard for this store when fresh
      if (!d?.submitted_at) {
        const prefill = await fetchPriorFilters(storeId, campaign.id)
        if (cancelled) return
        if (prefill) {
          if (prefill.maxAge != null) setMaxAge(String(prefill.maxAge))
          if (prefill.maxProx != null) setMaxProx(String(prefill.maxProx))
          setPrefilled(prefill)
        }
      }
    })()
    return () => { cancelled = true }
  }, [campaign.id, storeId, user?.id])

  // Live count of matching addresses based on current filter input.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!storeId) { setMatchCount(null); return }
      let q = supabase.from('store_postcard_lists').select('id', { count: 'exact', head: true }).eq('store_id', storeId)
      const ageNum = maxAge.trim() ? Number(maxAge) : null
      if (ageNum != null && Number.isFinite(ageNum) && ageNum >= 0) {
        const cutoff = new Date(Date.now() - ageNum * 24 * 60 * 60 * 1000).toISOString()
        q = q.gte('created_at', cutoff)
      }
      const { count } = await q
      if (cancelled) return
      setMatchCount(count ?? 0)
    })()
    return () => { cancelled = true }
  }, [storeId, maxAge, masterListSize])

  async function authedFetch(input: RequestInfo, init: RequestInit = {}) {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    return fetch(input, {
      ...init,
      headers: { ...(init.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    })
  }

  async function uploadCsv(file: File) {
    if (!storeId) return
    setUploading(true); setError(null); setUploadResult(null)
    const fd = new FormData()
    fd.append('file', file)
    fd.append('store_id', storeId)
    fd.append('campaign_id', campaign.id)
    try {
      const res = await authedFetch('/api/marketing/store-postcard-lists/upload', {
        method: 'POST', body: fd,
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error || `Upload failed (${res.status})`)
      } else {
        setUploadResult({ total: json.total, new: json.new, duplicate: json.duplicate, invalid: json.invalid })
        // Refresh list size + history
        const [{ count: c }, { data: ups }] = await Promise.all([
          supabase.from('store_postcard_lists').select('id', { count: 'exact', head: true }).eq('store_id', storeId),
          supabase.from('postcard_uploads')
            .select('id, uploaded_at, original_filename, total_rows, new_rows, duplicate_rows')
            .eq('campaign_id', campaign.id).order('uploaded_at', { ascending: false }).limit(10),
        ])
        setMasterListSize(c ?? 0)
        setUploads((ups ?? []) as UploadHistory[])
      }
    } catch (e: any) {
      setError(e?.message || 'Network error')
    }
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function submit() {
    setBusy(true); setError(null)
    const ageNum = maxAge.trim() ? Number(maxAge) : null
    const proxNum = maxProx.trim() ? Number(maxProx) : null
    if (ageNum != null && (!Number.isFinite(ageNum) || ageNum < 0)) {
      setBusy(false); setError('Max age must be a non-negative number.'); return
    }
    if (matchCount === 0) {
      setBusy(false); setError('Filter matches 0 addresses. Upload a list or relax the filter before submitting.'); return
    }
    try {
      const res = await authedFetch(`/api/marketing/campaigns/${campaign.id}/submit-planning`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          max_age_days: ageNum,
          max_proximity_miles: proxNum,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(json.error || `Failed (${res.status})`); setBusy(false); return }
      onChanged({ ...campaign, status: 'planning', sub_status: 'awaiting_planning_approval' } as MarketingCampaign)
      const { data: det } = await supabase.from('postcard_campaign_details').select('*').eq('campaign_id', campaign.id).maybeSingle()
      setDetails(det as PostcardDetails)
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
      const { data: c } = await supabase.from('marketing_campaigns').select('*').eq('id', campaign.id).single()
      if (c) onChanged(c as MarketingCampaign)
      const { data: det } = await supabase.from('postcard_campaign_details').select('*').eq('campaign_id', campaign.id).maybeSingle()
      setDetails(det as PostcardDetails)
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
        2. Planning — Postcard <RoleLabel>(Marketing Team)</RoleLabel>
      </div>
      <div style={{ fontSize: 12, color: 'var(--mist)', marginBottom: 14 }}>
        {isInputMode && 'Upload addresses to the store\'s master list, set filters, and submit for approval.'}
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
          {/* Master list summary + CSV upload */}
          <div style={{
            background: 'var(--cream)', border: '1px solid var(--pearl)', borderRadius: 8,
            padding: 12, marginBottom: 14,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
                  Store master list — {masterListSize.toLocaleString('en-US')} address{masterListSize === 1 ? '' : 'es'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--mist)' }}>
                  Uploads are additive. Duplicates are detected on (address line 1, zip).
                </div>
              </div>
              <button className="btn-outline btn-sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? 'Uploading…' : '📎 Upload CSV / Excel'}
              </button>
              <input ref={fileRef} type="file" accept=".csv,.txt" style={{ display: 'none' }}
                onChange={e => { if (e.target.files?.[0]) uploadCsv(e.target.files[0]) }} />
            </div>
            {uploadResult && (
              <div style={{
                marginTop: 10, padding: 8,
                background: 'var(--green-pale)', color: 'var(--green-dark)',
                borderRadius: 6, fontSize: 12, fontWeight: 700,
              }}>
                ✓ Uploaded {uploadResult.total.toLocaleString('en-US')} rows: <strong>{uploadResult.new.toLocaleString('en-US')} new</strong>, {uploadResult.duplicate.toLocaleString('en-US')} duplicate{uploadResult.invalid > 0 ? `, ${uploadResult.invalid} invalid (skipped)` : ''}.
              </div>
            )}
          </div>

          {prefilled && (
            <div style={{
              background: 'var(--cream2)', border: '1px solid var(--pearl)', borderRadius: 8,
              padding: '8px 12px', fontSize: 12, color: 'var(--ash)', marginBottom: 12,
            }}>
              💡 Filter pre-filled from this store's most recent approved postcard campaign ({prefilled.from}).
            </div>
          )}

          {/* Filters */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label className="fl">Max record age (days)</label>
              <input type="number" min={0} value={maxAge}
                onChange={e => setMaxAge(e.target.value)}
                placeholder="leave blank = all" />
            </div>
            <div>
              <label className="fl">Max proximity (miles)</label>
              <input type="number" min={0} value={maxProx}
                onChange={e => setMaxProx(e.target.value)}
                placeholder="(not enforced v1)"
                disabled
                title="Proximity filtering needs geocoded lat/lng on each address — coming in a later phase." />
              <div style={{ fontSize: 10, color: 'var(--mist)', marginTop: 4, fontStyle: 'italic' }}>
                Captured for future use; filtering not yet active.
              </div>
            </div>
          </div>

          {/* Live match count */}
          <div style={{
            padding: '10px 14px', background: 'var(--cream2)',
            border: '1px solid var(--pearl)', borderRadius: 8,
            fontSize: 14, fontWeight: 700, color: 'var(--ink)',
            marginBottom: 14,
          }}>
            Selected: {matchCount == null ? '…' : matchCount.toLocaleString('en-US')} address{matchCount === 1 ? '' : 'es'}
          </div>

          <button className="btn-primary btn-sm" onClick={submit} disabled={busy || matchCount === 0}>
            {busy ? 'Submitting…' : '📤 Submit for Approval'}
          </button>

          {/* Upload history */}
          {uploads.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>
                Recent uploads
              </div>
              <div style={{ border: '1px solid var(--pearl)', borderRadius: 8, overflow: 'hidden' }}>
                {uploads.map((u, i) => (
                  <div key={u.id} style={{
                    padding: '8px 12px', fontSize: 12, color: 'var(--ash)',
                    borderBottom: i < uploads.length - 1 ? '1px solid var(--cream2)' : 'none',
                    display: 'grid', gridTemplateColumns: '1fr auto', gap: 8,
                  }}>
                    <div>
                      <div style={{ fontWeight: 700, color: 'var(--ink)' }}>{u.original_filename || '(unnamed)'}</div>
                      <div style={{ color: 'var(--mist)', fontSize: 11 }}>
                        {u.total_rows ?? 0} rows: <strong>{u.new_rows ?? 0} new</strong>, {u.duplicate_rows ?? 0} dupe
                      </div>
                    </div>
                    <div style={{ color: 'var(--mist)', fontSize: 11, textAlign: 'right' }}>
                      {new Date(u.uploaded_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* AWAITING + APPROVED — read-only summary */}
      {(isAwaitingApproval || isApproved) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: isAwaitingApproval ? 14 : 0 }}>
          <SummaryRow label="Postcards to mail"
            value={details?.postcard_count != null ? details.postcard_count.toLocaleString('en-US') : '—'} />
          <SummaryRow label="Max record age"
            value={details?.selected_filter_max_record_age_days != null ? `${details.selected_filter_max_record_age_days} days` : 'no limit'} />
          <SummaryRow label="Max proximity"
            value={details?.selected_filter_max_proximity_miles != null ? `${details.selected_filter_max_proximity_miles} miles (captured, not enforced)` : 'no limit'} />
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

async function fetchPriorFilters(storeId: string, currentCampaignId: string): Promise<{ from: string; maxAge: number | null; maxProx: number | null } | null> {
  // Most recent prior approved postcard campaign for this store.
  const { data: prior } = await supabase
    .from('marketing_campaigns')
    .select(`
      id, event_id,
      events!inner(store_id, start_date),
      postcard_campaign_details!inner(approved_at, selected_filter_max_record_age_days, selected_filter_max_proximity_miles)
    `)
    .eq('flow_type', 'postcard')
    .eq('events.store_id', storeId)
    .neq('id', currentCampaignId)
    .not('postcard_campaign_details.approved_at', 'is', null)
    .order('start_date', { foreignTable: 'events', ascending: false })
    .limit(1)
  const row = (prior ?? [])[0] as any
  if (!row) return null
  const det = Array.isArray(row.postcard_campaign_details)
    ? row.postcard_campaign_details[0]
    : row.postcard_campaign_details
  return {
    from: row.events?.start_date || '',
    maxAge: det?.selected_filter_max_record_age_days ?? null,
    maxProx: det?.selected_filter_max_proximity_miles ?? null,
  }
}
