'use client'

// "Done" card. Renders when campaign.status='done'. Shows the
// celebration line, the accountant receipt status, and a re-send
// button for "the original email got lost" cases.
//
// PhaseTimeline already shows the green celebration label
// ("All set to Buy, Win Win Deals for All") on done — this card is
// the per-campaign actionable surface.

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { MarketingCampaign } from '@/types'

export default function DoneSection({ campaign, onChanged }: {
  campaign: MarketingCampaign
  onChanged: (next: MarketingCampaign) => void
}) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function resend() {
    if (!confirm('Re-generate the accountant receipt PDF and email it now?')) return
    setBusy(true); setError(null); setResult(null)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess.session?.access_token
      const res = await fetch(`/api/marketing/campaigns/${campaign.id}/send-receipt`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) {
        if (json.reason === 'no_accountant_address') {
          setError('No accountant email is configured. Set settings.accountant_email and try again.')
        } else {
          setError(json.error || `Failed (${res.status})`)
        }
      } else {
        setResult('Sent ✓')
        const { data: c } = await supabase.from('marketing_campaigns').select('*').eq('id', campaign.id).single()
        if (c) onChanged(c as MarketingCampaign)
      }
    } catch (e: any) { setError(e?.message || 'Network error') }
    setBusy(false)
  }

  return (
    <div className="card" style={{
      padding: 18, marginBottom: 14,
      background: 'var(--green-pale)', border: '2px solid var(--green3)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div style={{ fontSize: 22 }}>🎉</div>
        <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--green-dark)' }}>
          All set to Buy, Win Win Deals for All
        </div>
      </div>

      <div style={{
        background: '#fff', border: '1px solid var(--pearl)', borderRadius: 8,
        padding: 12, marginTop: 10,
      }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>
          Accountant receipt
        </div>
        {campaign.accountant_receipt_sent_at ? (
          <div style={{ fontSize: 13, color: 'var(--ink)' }}>
            ✉️ Sent {new Date(campaign.accountant_receipt_sent_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
          </div>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--mist)', fontStyle: 'italic' }}>
            Not yet sent. Mark as Paid auto-fires the receipt — if it didn't go out (e.g., accountant email wasn't configured), use the button below.
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
          <button className="btn-outline btn-sm" onClick={resend} disabled={busy}>
            {busy ? 'Sending…' : campaign.accountant_receipt_sent_at ? '↻ Re-send to accountant' : '✉️ Send to accountant'}
          </button>
          {result && <span style={{ fontSize: 12, color: 'var(--green-dark)', fontWeight: 700 }}>{result}</span>}
        </div>

        {error && (
          <div style={{
            marginTop: 10,
            background: 'var(--red-pale)', color: '#7f1d1d',
            border: '1px solid #fecaca', borderRadius: 6,
            padding: '8px 12px', fontSize: 12,
          }}>{error}</div>
        )}
      </div>
    </div>
  )
}
