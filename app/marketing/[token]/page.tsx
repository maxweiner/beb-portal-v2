'use client'

// Public marketing campaign page — no Supabase Auth required. The
// magic_link_tokens row encodes which campaign + recipient this URL
// belongs to. All actions on this page pass `magic_token` to the
// dual-auth API routes (resolveMarketingActor in lib/marketing/auth.ts).
//
// What's available via magic link in this phase:
//   - View the campaign
//   - Submit planning (VDP zips + count, Postcard filter)
//   - Upload proofs + view existing
//   - Mark as Paid (after an approver authorizes via the portal)
//   - Re-Request Payment (lock-on-decline reset)
//
// Approver actions (Approve, Request Revision, Authorize Payment)
// are intentionally NOT available via magic link — those require a
// real user_id for the audit trail and the spec routes approvers
// through the portal or the email-reply-to-approve flow.

import { useEffect, useRef, useState } from 'react'

interface Resolved {
  campaign: any
  event: { id: string; store_id: string; store_name: string; start_date: string } | null
  store: { id: string; name: string; address?: string; city?: string; state?: string; zip?: string } | null
  recipientEmail: string
  expiresAt: string | null
}

export default function MagicCampaignPage({ params }: { params: { token: string } }) {
  const token = params.token
  const [data, setData] = useState<Resolved | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [actionResult, setActionResult] = useState<string | null>(null)

  async function load() {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/marketing/magic/${encodeURIComponent(token)}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (json.error === 'token_expired') {
          setError('This link has expired. Please ask BEB to send a fresh one.')
        } else if (json.error === 'token_invalid') {
          setError('This link is not valid. Double-check the URL or ask BEB for a new one.')
        } else {
          setError(json.error || `Could not load campaign (${res.status})`)
        }
      } else {
        setData(json as Resolved)
      }
    } catch (e: any) { setError(e?.message || 'Network error') }
    setLoading(false)
  }
  useEffect(() => { load() /* eslint-disable-next-line */ }, [token])

  if (loading) {
    return (
      <Shell>
        <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⏳</div>
          <div style={{ fontWeight: 700 }}>Loading campaign…</div>
        </div>
      </Shell>
    )
  }
  if (error || !data) {
    return (
      <Shell>
        <div style={{ padding: 40, textAlign: 'center', color: '#666', maxWidth: 460, margin: '0 auto' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔍</div>
          <div style={{ fontWeight: 900, fontSize: 20, color: '#1a1a1a', marginBottom: 8 }}>Link Not Available</div>
          <div style={{ fontSize: 14 }}>{error}</div>
        </div>
      </Shell>
    )
  }

  const c = data.campaign
  const ev = data.event
  const store = data.store
  const storeName = store?.name || ev?.store_name || '(unknown store)'
  const fullAddress = [store?.address, store?.city, store?.state, store?.zip].filter(Boolean).join(', ')
  const eventDate = ev?.start_date
    ? new Date(ev.start_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    : ''
  const FLOW_LABELS: Record<string, string> = { vdp: 'VDP Mailers', postcard: 'Postcards', newspaper: 'Newspaper' }

  return (
    <Shell>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ color: '#7EC8A0', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 4 }}>
          {FLOW_LABELS[c.flow_type] || c.flow_type} · Marketing Campaign
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 900, color: '#1a1a1a', margin: '4px 0' }}>{storeName}</h1>
        <div style={{ fontSize: 13, color: '#666' }}>
          {eventDate}
          {fullAddress && <span> · {fullAddress}</span>}
        </div>
      </div>

      {/* Phase strip */}
      <PhaseDots status={c.status} subStatus={c.sub_status} />

      {/* Status summary */}
      <div style={{ background: '#fff', border: '1px solid #e8e0d0', borderRadius: 12, padding: 18, marginTop: 16, marginBottom: 16 }}>
        <Row label="Marketing budget" value={c.marketing_budget != null ? `$${Number(c.marketing_budget).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'} />
        {c.mail_by_date && <Row label="Mail by" value={new Date(c.mail_by_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} />}
        {c.payment_method_label && <Row label="Authorized payment method" value={`💳 ${c.payment_method_label}`} />}
        {c.payment_method_note && <Row label="Approver note" value={c.payment_method_note} />}
        {c.paid_at && <Row label="Paid" value={new Date(c.paid_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })} />}
      </div>

      {actionResult && (
        <div style={{
          background: '#f0fdf4', color: '#16a34a', border: '1px solid #86efac', borderRadius: 8,
          padding: '10px 14px', marginBottom: 14, fontSize: 13, fontWeight: 700,
        }}>{actionResult}</div>
      )}

      {/* Mark as Paid is the most common Collected-via-magic-link
          action. Show it prominently when applicable. */}
      {c.status === 'payment' && c.sub_status === 'awaiting_paid_mark' && (
        <ActionCard title="Ready to mark paid"
          body={`Approver picked ${c.payment_method_label}. Run the card and mark this campaign as paid here.`}
          ctaLabel={busy ? 'Marking…' : '✓ Mark as Paid'}
          ctaDisabled={busy}
          onCta={async () => {
            if (!confirm(`Mark this campaign as paid using ${c.payment_method_label}?`)) return
            setBusy(true); setActionResult(null)
            try {
              const res = await fetch(`/api/marketing/campaigns/${c.id}/mark-paid`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ magic_token: token }),
              })
              const json = await res.json().catch(() => ({}))
              if (!res.ok) setActionResult('✗ ' + (json.error || `Failed (${res.status})`))
              else { setActionResult('✓ Marked paid — accountant has been emailed.'); await load() }
            } catch (e: any) { setActionResult('✗ ' + (e?.message || 'Network error')) }
            setBusy(false)
          }}
        />
      )}

      {c.status === 'payment' && c.sub_status === 'awaiting_payment_request' && (
        <ActionCard title="Request payment"
          body="Proof has been approved. Click Request Payment to notify the approvers — they'll pick a card on the portal."
          ctaLabel={busy ? '…' : '💳 Request Payment'}
          ctaDisabled={busy}
          onCta={async () => {
            setBusy(true); setActionResult(null)
            try {
              const res = await fetch(`/api/marketing/campaigns/${c.id}/request-payment`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ magic_token: token }),
              })
              const json = await res.json().catch(() => ({}))
              if (!res.ok) setActionResult('✗ ' + (json.error || `Failed (${res.status})`))
              else { setActionResult('✓ Approvers notified.'); await load() }
            } catch (e: any) { setActionResult('✗ ' + (e?.message || 'Network error')) }
            setBusy(false)
          }}
        />
      )}

      {/* Done state */}
      {c.status === 'done' && (
        <div style={{
          background: '#f0fdf4', border: '2px solid #86efac', borderRadius: 12, padding: 18, marginBottom: 14,
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 28 }}>🎉</div>
          <div style={{ fontSize: 16, fontWeight: 900, color: '#166534', marginTop: 6 }}>
            All set to Buy, Win Win Deals for All
          </div>
        </div>
      )}

      {/* Always-visible footer note about additional actions */}
      <div style={{
        background: '#fff', border: '1px solid #e8e0d0', borderRadius: 12, padding: 14,
        fontSize: 12, color: '#666', marginTop: 8,
      }}>
        Need to upload proofs, submit planning, or comment? Open the BEB Portal directly — magic-link uploads land in a follow-up. Approver actions (Approve / Request Revision / Authorize Payment) require a portal login.
      </div>

      <div style={{ marginTop: 24, textAlign: 'center', color: '#888', fontSize: 11 }}>
        Recipient: {data.recipientEmail}
        {data.expiresAt && <> · Link expires {new Date(data.expiresAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</>}
      </div>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: '#f5f0e8', fontFamily: 'Lato, -apple-system, sans-serif' }}>
      <div style={{ background: '#2D3B2D', padding: '20px 24px' }}>
        <div style={{ maxWidth: 800, margin: '0 auto' }}>
          <div style={{ color: '#7EC8A0', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em' }}>
            Beneficial Estate Buyers · Marketing
          </div>
        </div>
      </div>
      <div style={{ maxWidth: 800, margin: '0 auto', padding: '24px 18px 60px' }}>
        {children}
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0' }}>
      <span style={{ color: '#888' }}>{label}</span>
      <span style={{ fontWeight: 700, color: '#1a1a1a' }}>{value}</span>
    </div>
  )
}

function ActionCard({ title, body, ctaLabel, ctaDisabled, onCta }: {
  title: string; body: string; ctaLabel: string; ctaDisabled: boolean; onCta: () => void
}) {
  return (
    <div style={{
      background: '#fff', border: '1px solid #e8e0d0', borderRadius: 12, padding: 18, marginBottom: 14,
    }}>
      <div style={{ fontWeight: 900, fontSize: 15, color: '#1a1a1a', marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 13, color: '#666', marginBottom: 12, lineHeight: 1.5 }}>{body}</div>
      <button onClick={onCta} disabled={ctaDisabled} style={{
        background: ctaDisabled ? '#888' : '#2D3B2D', color: '#fff',
        padding: '10px 20px', borderRadius: 8, border: 'none',
        fontWeight: 700, fontSize: 14, cursor: ctaDisabled ? 'wait' : 'pointer',
        fontFamily: 'inherit',
      }}>{ctaLabel}</button>
    </div>
  )
}

const PHASES: { id: string; label: string }[] = [
  { id: 'setup', label: 'Setup' },
  { id: 'planning', label: 'Planning' },
  { id: 'proofing', label: 'Proofing' },
  { id: 'payment', label: 'Payment' },
  { id: 'done', label: 'Done' },
]
const PHASE_INDEX: Record<string, number> = { setup: 0, planning: 1, proofing: 2, payment: 3, done: 4 }

function PhaseDots({ status, subStatus }: { status: string; subStatus: string | null }) {
  const idx = PHASE_INDEX[status] ?? 0
  const allDone = status === 'done'
  return (
    <div style={{ background: '#fff', border: '1px solid #e8e0d0', borderRadius: 12, padding: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', position: 'relative', alignItems: 'center' }}>
        <div style={{ position: 'absolute', left: '10%', right: '10%', top: 14, height: 3, background: '#f0ebe0', zIndex: 0 }} />
        <div style={{
          position: 'absolute', left: '10%', top: 14, height: 3,
          width: `${(idx / 4) * 80}%`,
          background: allDone ? '#22c55e' : '#1D6B44',
          zIndex: 0, transition: 'width .3s ease',
        }} />
        {PHASES.map((p, i) => {
          const done = i < idx || allDone
          const cur = i === idx && !allDone
          return (
            <div key={p.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative', zIndex: 1 }}>
              <div style={{
                width: 30, height: 30, borderRadius: '50%',
                background: done ? '#22c55e' : cur ? '#1D6B44' : '#f0ebe0',
                color: done || cur ? '#fff' : '#888',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14, fontWeight: 900,
                border: cur ? '2px solid #1D6B44' : 'none',
                boxShadow: cur ? '0 0 0 4px rgba(29, 107, 68, .15)' : 'none',
              }}>{done ? '✓' : i + 1}</div>
              <div style={{
                marginTop: 6, fontSize: 11, fontWeight: 700,
                color: cur ? '#1D6B44' : done ? '#444' : '#888',
                textAlign: 'center',
              }}>{p.label}</div>
              {cur && subStatus && (
                <div style={{ marginTop: 2, fontSize: 10, color: '#888', textAlign: 'center' }}>
                  {subStatus.replace(/_/g, ' ')}
                </div>
              )}
            </div>
          )
        })}
      </div>
      {allDone && (
        <div style={{
          marginTop: 12, padding: '8px 12px',
          background: '#f0fdf4', color: '#166534',
          borderRadius: 6, textAlign: 'center',
          fontSize: 13, fontWeight: 800,
        }}>🎉 All set to Buy, Win Win Deals for All</div>
      )}
    </div>
  )
}
