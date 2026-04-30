'use client'

// Payment section in CampaignDetail. Renders when campaign.status is
// 'payment' (or beyond, for read-only Done state).
//
// Three sub-modes by sub_status:
//   awaiting_payment_request — Collected sees "Request Payment"
//   awaiting_payment_method  — Approver picks card label + note;
//                              non-approver sees pending state
//   awaiting_paid_mark       — Collected sees selected card label +
//                              note + "Mark as Paid". Method is locked.
//
// Lock-on-decline: re-clicking "Request Payment" clears prior auth +
// re-notifies approvers (handled server-side).

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import type { MarketingCampaign } from '@/types'
import RoleLabel from './RoleLabel'

interface PaymentMethod {
  id: string
  label: string
  is_archived: boolean
  last_used_at: string | null
}

export default function PaymentSection({ campaign, onChanged }: {
  campaign: MarketingCampaign
  onChanged: (next: MarketingCampaign) => void
}) {
  const { user, users } = useApp()
  const userById = useMemo(() => new Map(users.map(u => [u.id, u])), [users])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isApprover, setIsApprover] = useState(false)
  const [methods, setMethods] = useState<PaymentMethod[]>([])
  const [pickedLabel, setPickedLabel] = useState<string>('')
  const [newLabel, setNewLabel] = useState<string>('')
  const [adding, setAdding] = useState(false)
  const [note, setNote] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [{ data: ap }, { data: pms }] = await Promise.all([
        user?.id
          ? supabase.from('marketing_approvers').select('is_active').eq('user_id', user.id).maybeSingle()
          : Promise.resolve({ data: null }),
        supabase.from('marketing_payment_methods')
          .select('id, label, is_archived, last_used_at')
          .eq('is_archived', false)
          .order('last_used_at', { ascending: false, nullsFirst: false })
          .order('label'),
      ])
      if (cancelled) return
      setIsApprover(!!(ap as any)?.is_active)
      setMethods((pms ?? []) as PaymentMethod[])
    })()
    return () => { cancelled = true }
  }, [user?.id])

  async function authedFetch(input: RequestInfo, init: RequestInit = {}) {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    return fetch(input, {
      ...init,
      headers: { ...(init.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    })
  }

  async function refresh() {
    const { data: c } = await supabase.from('marketing_campaigns').select('*').eq('id', campaign.id).single()
    if (c) onChanged(c as MarketingCampaign)
  }

  async function requestPayment() {
    if (campaign.payment_method_label && !confirm('This will clear the previously authorized payment method and re-notify approvers. Continue?')) return
    setBusy(true); setError(null)
    try {
      const res = await authedFetch(`/api/marketing/campaigns/${campaign.id}/request-payment`, { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(json.error || `Failed (${res.status})`); setBusy(false); return }
      await refresh()
    } catch (e: any) { setError(e?.message || 'Network error') }
    setBusy(false)
  }

  async function authorize() {
    setBusy(true); setError(null)
    try {
      const body: Record<string, unknown> = { note: note.trim() || null }
      if (adding) {
        if (!newLabel.trim()) { setError('Enter the new card label.'); setBusy(false); return }
        body.new_label = newLabel.trim()
      } else {
        if (!pickedLabel) { setError('Pick a payment method.'); setBusy(false); return }
        body.payment_method_label = pickedLabel
      }
      const res = await authedFetch(`/api/marketing/campaigns/${campaign.id}/authorize-payment`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(json.error || `Failed (${res.status})`); setBusy(false); return }
      await refresh()
      // Refresh methods list in case we just added a new label
      const { data: pms } = await supabase.from('marketing_payment_methods')
        .select('id, label, is_archived, last_used_at').eq('is_archived', false)
        .order('last_used_at', { ascending: false, nullsFirst: false }).order('label')
      setMethods((pms ?? []) as PaymentMethod[])
      setNewLabel(''); setNote(''); setAdding(false); setPickedLabel('')
    } catch (e: any) { setError(e?.message || 'Network error') }
    setBusy(false)
  }

  async function markPaid() {
    if (!confirm(`Mark this campaign as paid using ${campaign.payment_method_label}? Cannot be undone.`)) return
    setBusy(true); setError(null)
    try {
      const res = await authedFetch(`/api/marketing/campaigns/${campaign.id}/mark-paid`, { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(json.error || `Failed (${res.status})`); setBusy(false); return }
      await refresh()
    } catch (e: any) { setError(e?.message || 'Network error') }
    setBusy(false)
  }

  const isDone = campaign.status === 'done'
  const isAwaitingRequest = campaign.status === 'payment' && campaign.sub_status === 'awaiting_payment_request'
  const isAwaitingMethod = campaign.status === 'payment' && campaign.sub_status === 'awaiting_payment_method'
  const isAwaitingPaidMark = campaign.status === 'payment' && campaign.sub_status === 'awaiting_paid_mark'

  const authorizerName = campaign.payment_authorized_by ? (userById.get(campaign.payment_authorized_by)?.name || '(approver)') : null
  const paidByName = campaign.paid_by ? (userById.get(campaign.paid_by)?.name || '(Collected)') : null

  return (
    <div className="card" style={{ padding: 18, marginBottom: 14 }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)', marginBottom: 4 }}>
        4. Payment <RoleLabel>(Marketing Team)</RoleLabel>
      </div>
      <div style={{ fontSize: 12, color: 'var(--mist)', marginBottom: 14 }}>
        {isAwaitingRequest && 'Proof approved. Request payment when you\'re ready to charge.'}
        {isAwaitingMethod && 'Payment requested. Awaiting an approver to pick the card.'}
        {isAwaitingPaidMark && 'Payment authorized. Run the card and mark as paid here.'}
        {isDone && 'Payment complete.'}
      </div>

      {error && (
        <div style={{
          background: 'var(--red-pale)', color: '#7f1d1d',
          border: '1px solid #fecaca', borderRadius: 8,
          padding: '10px 14px', marginBottom: 14, fontSize: 13,
        }}>{error}</div>
      )}

      {/* Budget summary line, always visible */}
      <div style={{
        background: 'var(--cream2)', border: '1px solid var(--pearl)', borderRadius: 8,
        padding: '10px 14px', marginBottom: 14,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6,
      }}>
        <div style={{ fontSize: 12, color: 'var(--mist)' }}>Marketing budget</div>
        <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--ink)' }}>
          ${Number(campaign.marketing_budget || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
      </div>

      {/* Mode-specific UI */}
      {isAwaitingRequest && (
        <button className="btn-primary btn-sm" onClick={requestPayment} disabled={busy}>
          {busy ? '…' : '💳 Request Payment'}
        </button>
      )}

      {isAwaitingMethod && isApprover && (
        <div style={{
          background: 'var(--cream2)', border: '1px solid var(--pearl)', borderRadius: 8,
          padding: 12,
        }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>
            Authorize payment
          </div>
          {!adding ? (
            <div className="field" style={{ marginBottom: 10 }}>
              <label className="fl">Payment method</label>
              <select value={pickedLabel} onChange={e => {
                if (e.target.value === '__add_new__') { setAdding(true); return }
                setPickedLabel(e.target.value)
              }} style={{ width: '100%' }}>
                <option value="">Pick a card…</option>
                {methods.map(m => <option key={m.id} value={m.label}>{m.label}</option>)}
                <option value="__add_new__">+ Add new payment method…</option>
              </select>
            </div>
          ) : (
            <div className="field" style={{ marginBottom: 10 }}>
              <label className="fl">New payment method label</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input value={newLabel} onChange={e => setNewLabel(e.target.value)}
                  placeholder='e.g. "Joe Visa 1234"' style={{ flex: 1 }} />
                <button className="btn-outline btn-xs" onClick={() => { setAdding(false); setNewLabel('') }}>Cancel</button>
              </div>
              <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 4 }}>
                Saved for next time. Card numbers are never stored.
              </div>
            </div>
          )}
          <div className="field" style={{ marginBottom: 10 }}>
            <label className="fl">Note (optional)</label>
            <textarea rows={2} value={note} onChange={e => setNote(e.target.value)}
              placeholder="Anything Collected should know…" />
          </div>
          <button className="btn-primary btn-sm" onClick={authorize} disabled={busy}>
            {busy ? '…' : '✓ Authorize Payment'}
          </button>
        </div>
      )}

      {isAwaitingMethod && !isApprover && (
        <div style={{ fontSize: 13, color: 'var(--mist)', fontStyle: 'italic' }}>
          Approvers have been notified. The payment method picker appears here once they authorize.
        </div>
      )}

      {(isAwaitingPaidMark || isDone) && (
        <div style={{
          background: isDone ? 'var(--green-pale)' : 'var(--cream2)',
          border: `1px solid ${isDone ? 'var(--green3)' : 'var(--pearl)'}`,
          borderRadius: 8, padding: 12, marginBottom: isAwaitingPaidMark ? 14 : 0,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
              Authorized payment method
            </div>
            {authorizerName && campaign.payment_authorized_at && (
              <div style={{ fontSize: 11, color: 'var(--mist)' }}>
                by {authorizerName} · {new Date(campaign.payment_authorized_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
              </div>
            )}
          </div>
          <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--ink)', marginBottom: 4 }}>
            💳 {campaign.payment_method_label}
          </div>
          {campaign.payment_method_note && (
            <div style={{ fontSize: 13, color: 'var(--ash)', whiteSpace: 'pre-wrap', marginBottom: 6 }}>
              "{campaign.payment_method_note}"
            </div>
          )}
          {isDone && campaign.paid_at && (
            <div style={{ fontSize: 12, color: 'var(--green-dark)', fontWeight: 700, marginTop: 6 }}>
              ✓ Marked paid by {paidByName || '(Collected)'} on {new Date(campaign.paid_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
            </div>
          )}
        </div>
      )}

      {isAwaitingPaidMark && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn-primary btn-sm" onClick={markPaid} disabled={busy}>
            {busy ? '…' : '✓ Mark as Paid'}
          </button>
          <button className="btn-outline btn-sm" onClick={requestPayment} disabled={busy}
            title="Use a different card — re-notify approvers">
            ↻ Card declined? Request new payment method
          </button>
        </div>
      )}
    </div>
  )
}
