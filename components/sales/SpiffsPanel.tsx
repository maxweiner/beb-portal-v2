'use client'

// Per-trunk-show spiffs view. Shows each spiff (auto-created
// when an appointment slot is marked purchased), Mark paid /
// Unmark paid (admin only). Total owed + total paid summary.

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/lib/context'
import { listSpiffsForShow, markSpiffPaid, type Spiff } from '@/lib/sales/spiffs'

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })

interface Props {
  trunkShowId: string
  canMarkPaid: boolean
}

export default function SpiffsPanel({ trunkShowId, canMarkPaid }: Props) {
  const { user } = useApp()
  const [rows, setRows] = useState<Spiff[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function reload() {
    setError(null)
    try { setRows(await listSpiffsForShow(trunkShowId)) }
    catch (err: any) { setError(err?.message || 'Failed to load') }
    setLoaded(true)
  }
  useEffect(() => { void reload() /* eslint-disable-next-line */ }, [trunkShowId])

  const totals = useMemo(() => {
    let owed = 0, paid = 0
    for (const s of rows) {
      if (s.paid_at) paid += s.amount; else owed += s.amount
    }
    return { owed, paid, total: owed + paid }
  }, [rows])

  async function togglePaid(s: Spiff) {
    if (!canMarkPaid) return
    try {
      await markSpiffPaid(s.id, user?.id || null, !s.paid_at)
      setRows(p => p.map(r => r.id === s.id
        ? { ...r, paid_at: r.paid_at ? null : new Date().toISOString(), paid_by: r.paid_at ? null : user?.id || null }
        : r))
    } catch (err: any) {
      alert(err?.message || 'Could not update')
    }
  }

  return (
    <div className="card" style={{ padding: 20, marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)' }}>💵 Spiffs</div>
          <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 2 }}>
            Auto-created when an appointment is marked purchased. Mark paid once you've handed off the spiff.
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Owed</div>
          <div style={{ fontSize: 18, fontWeight: 900, color: totals.owed > 0 ? '#92400E' : 'var(--mist)' }}>{USD.format(totals.owed)}</div>
          <div style={{ fontSize: 11, color: 'var(--mist)' }}>Paid {USD.format(totals.paid)}</div>
        </div>
      </div>

      {error && (
        <div style={{ background: '#FEE2E2', color: '#991B1B', padding: '8px 10px', borderRadius: 6, fontSize: 13, marginBottom: 10 }}>{error}</div>
      )}

      {!loaded ? (
        <div style={{ padding: 16, textAlign: 'center', color: 'var(--mist)', fontSize: 13 }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 16, textAlign: 'center', color: 'var(--mist)', fontSize: 13, fontStyle: 'italic' }}>
          No spiffs yet. They appear automatically when you mark an appointment purchased.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {rows.map(s => (
            <div key={s.id} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 12px', borderRadius: 6,
              background: s.paid_at ? 'var(--green-pale)' : 'var(--cream)',
              border: '1px solid ' + (s.paid_at ? 'var(--green3)' : 'var(--cream2)'),
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{s.store_salesperson_name}</div>
                <div style={{ fontSize: 11, color: 'var(--mist)' }}>
                  {s.paid_at
                    ? `Paid ${new Date(s.paid_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
                    : 'Owed'}
                </div>
              </div>
              <div style={{ fontSize: 14, fontWeight: 900, color: s.paid_at ? 'var(--green-dark)' : '#92400E', minWidth: 70, textAlign: 'right' }}>
                {USD.format(s.amount)}
              </div>
              {canMarkPaid && (
                <button onClick={() => togglePaid(s)} className="btn-outline btn-xs">
                  {s.paid_at ? 'Unmark paid' : 'Mark paid'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
