'use client'

// First-visit reminder modal for partners. Lists every expense report
// awaiting their review. Dismissed for the rest of the session via
// sessionStorage so we don't pester the user every page nav.

import { useEffect, useState } from 'react'
import { useApp } from '@/lib/context'
import { usePendingApprovals } from './usePendingApprovals'
import { formatCurrency, formatDateLong } from './expensesUtils'

const DISMISS_KEY = 'beb:expenses:partner-modal-dismissed'

export default function PendingApprovalsModal({ onOpen }: { onOpen: (reportId: string) => void }) {
  const { user } = useApp()
  const isPartner = !!user?.is_partner
  const { rows, loaded } = usePendingApprovals()
  const [dismissed, setDismissed] = useState(true)

  useEffect(() => {
    if (typeof window === 'undefined') return
    setDismissed(sessionStorage.getItem(DISMISS_KEY) === '1')
  }, [])

  if (!isPartner || !loaded || dismissed || rows.length === 0) return null

  function dismiss() {
    if (typeof window !== 'undefined') sessionStorage.setItem(DISMISS_KEY, '1')
    setDismissed(true)
  }

  return (
    <div onClick={e => e.target === e.currentTarget && dismiss()}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ width: 'min(560px, 100%)', maxHeight: '80vh', overflowY: 'auto', background: 'var(--cream)', borderRadius: 12, padding: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink)' }}>
            🧾 {rows.length} expense report{rows.length === 1 ? '' : 's'} awaiting your review
          </h2>
          <button onClick={dismiss} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--mist)' }}>×</button>
        </div>
        <p style={{ fontSize: 12, color: 'var(--mist)', marginBottom: 12 }}>
          Approving each one emails the PDF to the accountant.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.map(r => (
            <button key={r.id}
              onClick={() => { dismiss(); onOpen(r.id) }}
              style={{
                textAlign: 'left', padding: '12px 14px', borderRadius: 8,
                background: '#fff', border: '1px solid var(--cream2)', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                fontFamily: 'inherit',
              }}>
              <div>
                <div style={{ fontWeight: 800, color: 'var(--ink)' }}>{r.user_name} · {r.event_name}</div>
                <div style={{ fontSize: 12, color: 'var(--mist)' }}>
                  {r.event_start && `Event ${formatDateLong(r.event_start)}`}
                  {r.submitted_at && ` · submitted ${new Date(r.submitted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                </div>
              </div>
              <div style={{ fontWeight: 800, color: 'var(--ink)' }}>{formatCurrency(r.grand_total)}</div>
            </button>
          ))}
        </div>
        <div style={{ marginTop: 14, textAlign: 'right' }}>
          <button onClick={dismiss} className="btn-outline btn-sm">Dismiss</button>
        </div>
      </div>
    </div>
  )
}
