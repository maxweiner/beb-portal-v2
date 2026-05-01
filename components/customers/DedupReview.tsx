'use client'

// Dedup review queue UI. Lists pending matches with side-by-side
// "existing customer" vs "incoming row" diff. Three actions per row:
//   • Merge        — overlay non-null incoming fields onto existing
//   • Keep separate— create the incoming as a fresh customer record
//   • Dismiss      — drop the incoming, no change to existing
//
// All resolution flows route through
// /api/customers/dedup-review/[id]/resolve.

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Customer } from '@/lib/customers/types'
import { fmtPhone } from '@/lib/customers/format'

interface QueueRow {
  id: string
  existing_customer_id: string
  incoming_data: Record<string, any>
  match_confidence: number
  match_reasons: string[]
  source: 'import' | 'appointment' | 'manual_entry'
  status: 'pending' | 'merged' | 'kept_separate' | 'dismissed'
  created_at: string
}

export default function DedupReview({ storeId }: { storeId: string }) {
  const [queue, setQueue] = useState<QueueRow[]>([])
  const [existingMap, setExistingMap] = useState<Map<string, Customer>>(new Map())
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function reload() {
    setLoading(true); setError(null)
    // Pull pending queue rows whose existing_customer is at this store.
    const { data: q, error: qe } = await supabase
      .from('customer_dedup_review_queue')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
    if (qe) { setError(qe.message); setLoading(false); return }
    const allRows = (q || []) as QueueRow[]
    if (allRows.length === 0) {
      setQueue([]); setExistingMap(new Map()); setLoading(false); return
    }
    const ids = Array.from(new Set(allRows.map(r => r.existing_customer_id)))
    const { data: ex } = await supabase.from('customers').select('*').in('id', ids)
    const m = new Map<string, Customer>()
    for (const c of (ex || []) as Customer[]) m.set(c.id, c)
    // Filter queue to only those whose existing customer is at the chosen store
    const filtered = allRows.filter(r => {
      const e = m.get(r.existing_customer_id)
      return e && e.store_id === storeId
    })
    setQueue(filtered); setExistingMap(m); setLoading(false)
  }
  useEffect(() => { reload() /* eslint-disable-next-line */ }, [storeId])

  async function authedFetch(input: RequestInfo, init: RequestInit = {}) {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    return fetch(input, {
      ...init,
      headers: { ...(init.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    })
  }

  async function resolve(q: QueueRow, action: 'merge' | 'keep_separate' | 'dismiss') {
    setBusyId(q.id); setError(null)
    try {
      const res = await authedFetch(`/api/customers/dedup-review/${q.id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(json.error || `Failed (${res.status})`); setBusyId(null); return }
      setQueue(prev => prev.filter(x => x.id !== q.id))
    } catch (e: any) {
      setError(e?.message || 'Network error')
    }
    setBusyId(null)
  }

  if (loading) return <div className="card" style={{ padding: 24, color: 'var(--mist)' }}>Loading review queue…</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="card" style={{ padding: 16 }}>
        <div className="card-title">⚖️ Dedup Review Queue</div>
        <div style={{ fontSize: 12, color: 'var(--mist)', lineHeight: 1.5 }}>
          Possible-match candidates that need a human decision. Rows here came from imports or (Phase 12) appointment auto-create where the matcher wasn't confident enough to auto-merge.
        </div>
      </div>

      {error && (
        <div style={{
          background: 'var(--red-pale)', color: '#7f1d1d',
          border: '1px solid #fecaca', borderRadius: 8,
          padding: '10px 14px', fontSize: 13,
        }}>{error}</div>
      )}

      {queue.length === 0 ? (
        <div className="card" style={{ padding: 24, color: 'var(--mist)', textAlign: 'center' }}>
          ✅ Nothing to review for this store.
        </div>
      ) : queue.map(q => {
        const ex = existingMap.get(q.existing_customer_id)
        const inc = q.incoming_data
        const busy = busyId === q.id
        return (
          <div key={q.id} className="card" style={{ padding: 0 }}>
            <div style={{
              padding: '10px 14px', borderBottom: '1px solid var(--cream2)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap',
            }}>
              <div style={{ fontSize: 12, color: 'var(--ash)' }}>
                <strong style={{ color: 'var(--ink)' }}>Confidence: {(q.match_confidence * 100).toFixed(0)}%</strong>
                {' · '}Reasons: {q.match_reasons.join(', ')}
                {' · '}Source: {q.source}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn-primary btn-xs" disabled={busy} onClick={() => resolve(q, 'merge')}>
                  {busy ? '…' : '⤺ Merge'}
                </button>
                <button className="btn-outline btn-xs" disabled={busy} onClick={() => resolve(q, 'keep_separate')}>
                  ✂️ Keep separate
                </button>
                <button className="btn-outline btn-xs" disabled={busy} onClick={() => resolve(q, 'dismiss')}
                  title="Drop the incoming data — existing customer untouched">
                  🗑️ Dismiss
                </button>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
              <Side title="Existing record" data={ex ? toRow(ex) : null} side="existing" />
              <Side title="Incoming data" data={toRow(inc)} side="incoming" />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function toRow(c: Record<string, any>): RowData {
  return {
    name: `${c.first_name || ''} ${c.last_name || ''}`.trim(),
    address: [c.address_line_1, c.address_line_2].filter(Boolean).join(' '),
    city: [c.city, c.state, c.zip].filter(Boolean).join(', '),
    phone: c.phone ? fmtPhone(c.phone) : '',
    email: c.email || '',
    notes: c.notes || '',
    how_heard: c.how_did_you_hear_legacy || c.how_did_you_hear || '',
  }
}

interface RowData {
  name: string; address: string; city: string;
  phone: string; email: string; notes: string; how_heard: string;
}

function Side({ title, data, side }: { title: string; data: RowData | null; side: 'existing' | 'incoming' }) {
  const bg = side === 'incoming' ? 'var(--green-pale)' : '#fff'
  return (
    <div style={{
      padding: 14, background: bg,
      borderRight: side === 'existing' ? '1px solid var(--pearl)' : 'none',
    }}>
      <div style={{
        fontSize: 11, fontWeight: 800, color: 'var(--ash)',
        textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6,
      }}>{title}</div>
      {!data ? (
        <div style={{ fontSize: 12, color: 'var(--mist)', fontStyle: 'italic' }}>(missing)</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--ink)' }}>
          <Field label="Name"    value={data.name} />
          <Field label="Address" value={data.address} />
          <Field label="City"    value={data.city} />
          <Field label="Phone"   value={data.phone} />
          <Field label="Email"   value={data.email} />
          {data.how_heard && <Field label="Source" value={data.how_heard} />}
          {data.notes && <Field label="Notes" value={data.notes} />}
        </div>
      )}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <div style={{ width: 70, fontSize: 10, color: 'var(--mist)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', flexShrink: 0, paddingTop: 1 }}>{label}</div>
      <div style={{ flex: 1, color: value ? 'var(--ink)' : 'var(--mist)' }}>{value || '—'}</div>
    </div>
  )
}
