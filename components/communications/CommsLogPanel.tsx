'use client'

// Communications log — shows every send + scheduled send tied to a
// trunk show. Reused on TrunkShowDetail (per-show) and on the global
// /trunk-comms-log page (when trunkShowId is omitted).
//
// Pending scheduled rows get inline Cancel + Reschedule actions; sent
// rows are read-only with status badge + timestamps.

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface CommsSend {
  id: string
  trunk_show_id: string
  template_id: string | null
  delivery_status: 'scheduled' | 'sent' | 'delivered' | 'bounced' | 'failed' | 'cancelled'
  subject_line_rendered: string
  to_email: string
  to_name: string | null
  from_name: string
  from_email: string
  sent_at: string | null
  scheduled_for: string | null
  scheduled_at: string | null
  scheduled_by_user_id: string | null
  cancelled_at: string | null
  failure_reason: string | null
  pdf_url: string | null
  store_name?: string
}

const STATUS_LABEL: Record<CommsSend['delivery_status'], string> = {
  scheduled: 'Scheduled',
  sent:      'Sent',
  delivered: 'Delivered',
  bounced:   'Bounced',
  failed:    'Failed',
  cancelled: 'Cancelled',
}
const STATUS_COLOR: Record<CommsSend['delivery_status'], { bg: string; fg: string }> = {
  scheduled: { bg: '#FEF3C7', fg: '#92400E' },
  sent:      { bg: '#DBEAFE', fg: '#1E40AF' },
  delivered: { bg: '#D1FAE5', fg: '#065F46' },
  bounced:   { bg: '#FEE2E2', fg: '#991B1B' },
  failed:    { bg: '#FEE2E2', fg: '#991B1B' },
  cancelled: { bg: '#E5E7EB', fg: '#374151' },
}

interface Props {
  /** When set, scope to this trunk show. Omit for the global view. */
  trunkShowId?: string
  title?: string
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}
}

export default function CommsLogPanel({ trunkShowId, title = '📨 Communications Log' }: Props) {
  const [rows, setRows] = useState<CommsSend[]>([])
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [reschedFor, setReschedFor] = useState<string | null>(null)
  const [reschedDate, setReschedDate] = useState('')

  async function load() {
    let q: any = supabase
      .from('communication_sends')
      .select(`id, trunk_show_id, template_id, delivery_status,
               subject_line_rendered, to_email, to_name,
               from_name, from_email, sent_at, scheduled_for, scheduled_at,
               scheduled_by_user_id, cancelled_at, failure_reason, pdf_url,
               trunk_show:trunk_shows(store:trunk_show_stores(name))`)
    if (trunkShowId) q = q.eq('trunk_show_id', trunkShowId)
    const { data, error } = await q.order('scheduled_for', { ascending: false, nullsFirst: false })
    if (error) {
      console.error('[CommsLogPanel] load failed', error)
    }
    setRows(unwrap(data))
    setLoaded(true)
  }

  useEffect(() => { void load() }, [trunkShowId])

  async function cancelOne(id: string) {
    if (!confirm('Cancel this scheduled send?')) return
    setBusy(id)
    try {
      const r = await fetch(`/api/communications/${id}/cancel-schedule`, {
        method: 'POST', headers: { ...(await authHeaders()) },
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { alert(j.error || `Cancel failed (${r.status})`); return }
      await load()
    } finally { setBusy(null) }
  }

  async function reschedOne(id: string) {
    if (!reschedDate) return
    setBusy(id)
    try {
      const r = await fetch(`/api/communications/${id}/reschedule`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ scheduled_for_date: reschedDate }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { alert(j.error || `Reschedule failed (${r.status})`); return }
      setReschedFor(null); setReschedDate('')
      await load()
    } finally { setBusy(null) }
  }

  // Sort: scheduled (soonest first) → sent / delivered (newest first)
  // → cancelled / failed (newest first).
  const sorted = [...rows].sort((a, b) => {
    const rank = (r: CommsSend) =>
      r.delivery_status === 'scheduled' ? 0 :
      (r.delivery_status === 'sent' || r.delivery_status === 'delivered') ? 1 :
      2
    const ra = rank(a), rb = rank(b)
    if (ra !== rb) return ra - rb
    if (a.delivery_status === 'scheduled' && b.delivery_status === 'scheduled') {
      return (a.scheduled_for || '').localeCompare(b.scheduled_for || '')
    }
    return (b.sent_at || b.scheduled_at || '').localeCompare(a.sent_at || a.scheduled_at || '')
  })

  return (
    <div className="card card-accent" style={{ margin: 0 }}>
      <div className="card-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>{title}</span>
        <span style={{ fontSize: 11, color: 'var(--mist)', fontWeight: 700 }}>
          {sorted.length} {sorted.length === 1 ? 'entry' : 'entries'}
        </span>
      </div>
      {!loaded ? (
        <div style={{ padding: 14, color: 'var(--mist)', fontSize: 13 }}>Loading…</div>
      ) : sorted.length === 0 ? (
        <div style={{ padding: 14, color: 'var(--mist)', fontSize: 13 }}>
          No sends yet. Schedule or send a letter from the Send a letter screen.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {sorted.map(r => {
            const sc = STATUS_COLOR[r.delivery_status]
            const isPending = r.delivery_status === 'scheduled'
            const isSent = r.delivery_status === 'sent' || r.delivery_status === 'delivered'
            const when = r.delivery_status === 'scheduled'
              ? r.scheduled_for
              : (r.sent_at || r.scheduled_at)
            return (
              <div key={r.id} style={{
                padding: '10px 12px', borderRadius: 8,
                background: '#fff', border: '1px solid var(--cream2)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.subject_line_rendered}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 2 }}>
                      {r.store_name ? `${r.store_name} · ` : ''}
                      To {r.to_name ? `${r.to_name} <${r.to_email}>` : r.to_email}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--ash)', marginTop: 2 }}>
                      From {r.from_name}
                      {when ? ` · ${new Date(when).toLocaleString()}` : ''}
                    </div>
                    {r.failure_reason && (
                      <div style={{ fontSize: 11, color: '#991B1B', marginTop: 4, fontWeight: 700 }}>
                        ❌ {r.failure_reason}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                    <span style={{
                      background: sc.bg, color: sc.fg,
                      padding: '2px 8px', borderRadius: 99,
                      fontSize: 10, fontWeight: 800,
                      textTransform: 'uppercase', letterSpacing: '.04em',
                      whiteSpace: 'nowrap',
                    }}>{STATUS_LABEL[r.delivery_status]}</span>
                    {isSent && r.pdf_url && (
                      <PdfLink path={r.pdf_url} />
                    )}
                  </div>
                </div>

                {isPending && (
                  <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {reschedFor === r.id ? (
                      <>
                        <input
                          type="date"
                          value={reschedDate}
                          onChange={e => setReschedDate(e.target.value)}
                          min={new Date().toISOString().slice(0, 10)}
                          style={{ width: 'auto' }}
                        />
                        <button onClick={() => reschedOne(r.id)} disabled={!reschedDate || busy === r.id}
                          className="btn-primary btn-xs">Save</button>
                        <button onClick={() => { setReschedFor(null); setReschedDate('') }}
                          className="btn-outline btn-xs">×</button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => {
                            setReschedFor(r.id)
                            setReschedDate((r.scheduled_for || '').slice(0, 10))
                          }}
                          className="btn-outline btn-xs">📅 Reschedule</button>
                        <button onClick={() => cancelOne(r.id)} disabled={busy === r.id}
                          className="btn-outline btn-xs"
                          style={{ color: '#B22234', borderColor: '#fecdd3' }}>
                          🚫 Cancel
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function unwrap(rows: any[] | null | undefined): CommsSend[] {
  return (rows || []).map((r: any) => {
    const ts = Array.isArray(r.trunk_show) ? r.trunk_show[0] : r.trunk_show
    const store = ts ? (Array.isArray(ts.store) ? ts.store[0] : ts.store) : null
    return { ...r, store_name: store?.name } as CommsSend
  })
}

function PdfLink({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { data } = await supabase.storage.from('communication-pdfs')
        .createSignedUrl(path.replace(/^communications\//, ''), 600)
      if (!cancelled && data?.signedUrl) setUrl(data.signedUrl)
    })()
    return () => { cancelled = true }
  }, [path])
  if (!url) return null
  return <a href={url} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: 'var(--green-dark)', fontWeight: 700 }}>📄 PDF</a>
}
