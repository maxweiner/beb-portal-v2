'use client'

// Cancel-Event modal.
//
// On open, fetches /api/events/[id]/cancel-impact and shows what's
// about to happen. The operator picks the cascades they want, types
// a required reason, and confirms. Marketing campaigns are always
// paused (no opt-out) — already-mailed pieces stay where they are.
//
// Cancellation is one-way; a cancelled event can only be restored
// via Delete Forever (a separate confirm flow). That gate lives on
// the event card itself, not in this modal.

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import Checkbox from '@/components/ui/Checkbox'

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}
}

interface ImpactResp {
  event: { id: string; store_name: string; start_date: string; status: string; cancelled: boolean }
  buyers: { id: string; name: string; email: string }[]
  storeContacts: { id: string; name: string; title: string | null; email: string }[]
  appointments: { count: number; customer_emails: string[] }
  travel: { count: number }
  expenses: { count: number }
  campaigns: { count: number }
}

interface Props {
  eventId: string
  onClose: () => void
  /** Called after a successful cancel so the parent can reload state. */
  onCancelled?: () => void
}

export default function CancelEventModal({ eventId, onClose, onCancelled }: Props) {
  const [impact, setImpact] = useState<ImpactResp | null>(null)
  const [impactErr, setImpactErr] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [cancelAppointments, setCancelAppointments] = useState(true) // default ☑
  const [emailBuyers, setEmailBuyers]               = useState(true) // default ☑
  const [emailStoreContacts, setEmailStoreContacts] = useState(false)
  const [emailCustomers, setEmailCustomers]         = useState(false)
  const [cancelTravel, setCancelTravel]             = useState(false)
  const [voidExpenses, setVoidExpenses]             = useState(false)
  const [submitting, setSubmitting]                 = useState(false)
  const [result, setResult] = useState<Record<string, any> | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch(`/api/events/${eventId}/cancel-impact`, { headers: await authHeaders() })
        const j = await r.json().catch(() => ({}))
        if (cancelled) return
        if (!r.ok) { setImpactErr(j?.error || `Load failed (${r.status})`); return }
        setImpact(j)
      } catch (e: any) {
        if (!cancelled) setImpactErr(e?.message || 'Load failed')
      }
    })()
    return () => { cancelled = true }
  }, [eventId])

  const fmtLong = (ds: string) =>
    new Date(ds + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

  const submit = async () => {
    const trimmed = reason.trim()
    if (!trimmed) { alert('Reason is required.'); return }
    if (trimmed.length < 4) { alert('Please provide a more descriptive reason.'); return }
    setSubmitting(true)
    try {
      const r = await fetch(`/api/events/${eventId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({
          reason: trimmed,
          cancel_appointments: cancelAppointments,
          email_buyers: emailBuyers,
          email_store_contacts: emailStoreContacts,
          email_customers: emailCustomers,
          cancel_travel: cancelTravel,
          void_expenses: voidExpenses,
        }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { alert('Cancel failed: ' + (j?.error || r.statusText)); return }
      setResult(j.summary || {})
      onCancelled?.()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={onClose}
    >
      <div
        style={{ background: '#fff', borderRadius: 12, width: 'min(640px, 100%)', maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--cream2)', background: '#FFF7F7', borderTop: '4px solid #B22234' }}>
          <div style={{ fontSize: 18, fontWeight: 900, color: '#B22234' }}>⚠ Cancel Buying Event</div>
          {impact && (
            <div style={{ fontSize: 13, color: 'var(--ash)', marginTop: 2 }}>
              {impact.event.store_name} · {fmtLong(impact.event.start_date)}
            </div>
          )}
        </div>

        <div style={{ padding: 20, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {impactErr && <div style={{ color: '#B22234', fontSize: 13 }}>{impactErr}</div>}

          {!impact && !impactErr && <div style={{ color: 'var(--mist)', fontSize: 13 }}>Loading impact…</div>}

          {result && (
            <div style={{ background: '#E6F4EC', borderRadius: 8, padding: 12, fontSize: 13 }}>
              <div style={{ fontWeight: 800, marginBottom: 4 }}>✓ Event cancelled.</div>
              <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--ash)' }}>
                {Number(result.appointments_cancelled) > 0 && <li>{result.appointments_cancelled} appointments cancelled</li>}
                {Number(result.campaigns_paused) > 0 && <li>{result.campaigns_paused} marketing campaigns paused</li>}
                {Number(result.travel_cancelled) > 0 && <li>{result.travel_cancelled} travel reservations cancelled</li>}
                {Number(result.expenses_voided) > 0 && <li>{result.expenses_voided} expense reports voided</li>}
                {Number(result.emails_sent) > 0 && <li>{result.emails_sent} emails sent{Number(result.emails_failed) > 0 ? `, ${result.emails_failed} failed` : ''}</li>}
              </ul>
              <button onClick={onClose} className="btn-primary" style={{ marginTop: 10 }}>Close</button>
            </div>
          )}

          {impact && !result && (
            <>
              <div style={{ fontSize: 12, color: 'var(--mist)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: 0.4 }}>
                What this will do
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--ink)', lineHeight: 1.6 }}>
                <li>Mark the event <b>cancelled</b> (reversible only via Delete Forever).</li>
                <li>Pause <b>{impact.campaigns.count}</b> active marketing campaign{impact.campaigns.count === 1 ? '' : 's'}.</li>
                <li>Block new public bookings for this event.</li>
              </ul>

              <div style={{ fontSize: 12, color: 'var(--mist)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: 0.4, marginTop: 8 }}>
                Optional cascades
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
                <Checkbox
                  checked={cancelAppointments}
                  onChange={setCancelAppointments}
                  label={<span>Also cancel <b>{impact.appointments.count}</b> customer appointment{impact.appointments.count === 1 ? '' : 's'}</span>}
                />
                <Checkbox
                  checked={cancelTravel}
                  onChange={setCancelTravel}
                  label={<span>Cancel <b>{impact.travel.count}</b> travel reservation{impact.travel.count === 1 ? '' : 's'}</span>}
                  disabled={impact.travel.count === 0}
                />
                <Checkbox
                  checked={voidExpenses}
                  onChange={setVoidExpenses}
                  label={<span>Void <b>{impact.expenses.count}</b> expense report{impact.expenses.count === 1 ? '' : 's'}</span>}
                  disabled={impact.expenses.count === 0}
                />
              </div>

              <div style={{ fontSize: 12, color: 'var(--mist)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: 0.4, marginTop: 8 }}>
                Notifications
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
                <Checkbox
                  checked={emailBuyers}
                  onChange={setEmailBuyers}
                  label={<span>Email <b>{impact.buyers.length}</b> assigned buyer{impact.buyers.length === 1 ? '' : 's'}</span>}
                  disabled={impact.buyers.length === 0}
                />
                <Checkbox
                  checked={emailStoreContacts}
                  onChange={setEmailStoreContacts}
                  label={<span>Email <b>{impact.storeContacts.length}</b> store contact{impact.storeContacts.length === 1 ? '' : 's'}</span>}
                  disabled={impact.storeContacts.length === 0}
                />
                <Checkbox
                  checked={emailCustomers}
                  onChange={setEmailCustomers}
                  label={
                    <span>
                      Email <b>{impact.appointments.customer_emails.length}</b> customer{impact.appointments.customer_emails.length === 1 ? '' : 's'} with appointments
                      {!cancelAppointments && (
                        <span style={{ color: 'var(--mist)' }}> · requires cancelling appointments first</span>
                      )}
                    </span>
                  }
                  disabled={impact.appointments.customer_emails.length === 0 || !cancelAppointments}
                />
              </div>

              <div style={{ marginTop: 10 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                  Reason for cancellation *
                </label>
                <textarea
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  rows={3}
                  placeholder="Why is this event being cancelled? (Required)"
                  style={{ width: '100%', padding: 10, fontFamily: 'inherit', fontSize: 13, border: '1px solid var(--pearl)', borderRadius: 6, marginTop: 4 }}
                />
              </div>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 6 }}>
                <button type="button" onClick={onClose} className="btn-outline">Keep Event</button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={submitting || reason.trim().length < 4}
                  className="btn-danger"
                >
                  {submitting ? 'Cancelling…' : 'Cancel Event'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
