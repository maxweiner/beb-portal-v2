'use client'

// Buying Communications — sends log panel. Parallel to trunk
// CommsLogPanel but simpler (no schedule-cancel / reschedule yet —
// auto-schedules land in phase 3c).
//
// Reused in two places:
//   - The 📨 Log tab inside BuyingCommunications module (every
//     send across every event).
//   - Per-event drill-in: pass eventId to scope to a single
//     buying event.

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useApp } from '@/lib/context'
import type { NavPage } from '@/app/page'

interface BuyingSend {
  id: string
  event_id: string
  template_id: string | null
  delivery_status: 'scheduled' | 'sent' | 'delivered' | 'bounced' | 'failed' | 'cancelled'
  subject_line_rendered: string
  to_email: string
  to_name: string | null
  cc_emails: string[]
  from_name: string
  from_email: string
  sent_at: string | null
  scheduled_for: string | null
  failure_reason: string | null
  resend_message_id: string | null
  event?: { id: string; store_id: string; start_date: string | null; store_name?: string | null } | null
}

const STATUS_LABEL: Record<BuyingSend['delivery_status'], string> = {
  scheduled: 'Scheduled', sent: 'Sent', delivered: 'Delivered',
  bounced: 'Bounced', failed: 'Failed', cancelled: 'Cancelled',
}
const STATUS_COLOR: Record<BuyingSend['delivery_status'], { bg: string; fg: string }> = {
  scheduled: { bg: '#FEF3C7', fg: '#92400E' },
  sent:      { bg: '#DBEAFE', fg: '#1E40AF' },
  delivered: { bg: '#D1FAE5', fg: '#065F46' },
  bounced:   { bg: '#FEE2E2', fg: '#991B1B' },
  failed:    { bg: '#FEE2E2', fg: '#991B1B' },
  cancelled: { bg: '#E5E7EB', fg: '#374151' },
}

interface Props {
  /** When set, scope to this buying event. Omit for the global view. */
  eventId?: string
  title?: string
  setNav?: (n: NavPage) => void
}

export default function BuyingCommsLogPanel({ eventId, title = '📨 Buying Communications Log', setNav }: Props) {
  const { stores } = useApp()
  const [rows, setRows] = useState<BuyingSend[]>([])
  const [loaded, setLoaded] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  // Free-text event filter — only meaningful when no eventId prop
  // pins the panel. Picks up store name + city + date.
  const [eventFilter, setEventFilter] = useState<string>('')

  // Cancel + reschedule modal state for scheduled rows.
  const [reschedFor, setReschedFor] = useState<string | null>(null)
  const [reschedDt, setReschedDt] = useState<string>('')
  const [busyRowId, setBusyRowId] = useState<string | null>(null)

  async function load() {
    let q: any = supabase
      .from('buying_communication_sends')
      .select(`id, event_id, template_id, delivery_status,
               subject_line_rendered, to_email, to_name, cc_emails,
               from_name, from_email, sent_at, scheduled_for,
               failure_reason, resend_message_id,
               event:events(id, store_id, start_date, store_name)`)
    if (eventId) q = q.eq('event_id', eventId)
    // Ordering: scheduled-future first (soonest first), then by
    // sent_at desc. Coalesce keeps NULL sent_at after the sent rows.
    const { data, error } = await q
      .order('scheduled_for', { ascending: true, nullsFirst: false })
      .order('sent_at', { ascending: false, nullsFirst: false })
    if (error) {
      console.error('[BuyingCommsLogPanel] load failed', error)
    }
    setRows(((data || []) as unknown) as BuyingSend[])
    setLoaded(true)
  }

  // Cancel a scheduled send. Cleanly flips to delivery_status='cancelled'
  // — the cron worker's CAS guard (eq status='scheduled') prevents
  // double-fire if the cron tick collides with the cancel.
  async function cancelOne(id: string) {
    if (!confirm('Cancel this scheduled send?')) return
    setBusyRowId(id)
    const { error } = await supabase.from('buying_communication_sends').update({
      delivery_status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      delivery_status_updated_at: new Date().toISOString(),
    }).eq('id', id).eq('delivery_status', 'scheduled')
    setBusyRowId(null)
    if (error) { alert('Cancel failed: ' + error.message); return }
    await load()
  }

  async function rescheduleOne(id: string) {
    if (!reschedDt) { alert('Pick a date + time.'); return }
    const when = new Date(reschedDt)
    if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {
      alert('New schedule must be in the future.'); return
    }
    setBusyRowId(id)
    const { error } = await supabase.from('buying_communication_sends').update({
      scheduled_for: when.toISOString(),
    }).eq('id', id).eq('delivery_status', 'scheduled')
    setBusyRowId(null)
    setReschedFor(null)
    setReschedDt('')
    if (error) { alert('Reschedule failed: ' + error.message); return }
    await load()
  }

  useEffect(() => { void load() }, [eventId])

  if (!loaded) {
    return <div style={{ padding: 24, color: 'var(--mist)', fontSize: 13 }}>Loading log…</div>
  }
  // Apply event-filter text when no eventId prop pins the panel.
  const visible = (() => {
    const q = eventFilter.trim().toLowerCase()
    if (eventId || !q) return rows
    return rows.filter(r => {
      const ev = r.event
      const storeName = ev?.store_name || (ev ? stores.find(s => s.id === ev.store_id)?.name : '')
      const hay = [r.subject_line_rendered, r.to_email, r.to_name, storeName, ev?.start_date].filter(Boolean).join(' ').toLowerCase()
      return hay.includes(q)
    })
  })()

  return (
    <div>
      {/* Event filter — only shown on the global view; per-event
          drill-in already has an eventId pin so a search would be
          redundant. */}
      {!eventId && (
        <div className="card" style={{ padding: 10, marginBottom: 10 }}>
          <input
            type="search"
            value={eventFilter}
            onChange={e => setEventFilter(e.target.value)}
            placeholder="🔍 Filter by event store, subject, recipient…"
            style={{ width: '100%' }}
          />
        </div>
      )}

      <div style={{ marginBottom: 10, fontSize: 12, color: 'var(--mist)' }}>
        {visible.length} of {rows.length} send{rows.length === 1 ? '' : 's'}{eventId ? ' for this event' : ''}
      </div>

      {visible.length === 0 ? (
        <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--mist)', fontSize: 13 }}>
          {rows.length === 0
            ? (eventId ? 'No letters sent for this event yet.' : 'No buying-comm letters have been sent yet.')
            : 'No sends match your filter.'}
        </div>
      ) : (
      <div style={{ background: '#fff', border: '1px solid var(--cream2)', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{
          display: 'grid', gridTemplateColumns: eventId ? '1.5fr 2fr 100px 90px 40px' : '1.5fr 1.5fr 1.5fr 100px 90px 40px',
          background: 'var(--cream2)', padding: '8px 14px',
          fontSize: 11, fontWeight: 700, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.04em',
        }}>
          <div>Subject</div>
          {!eventId && <div>Event</div>}
          <div>To</div>
          <div>{visible.some(r => r.delivery_status === 'scheduled') ? 'When' : 'Sent'}</div>
          <div>Status</div>
          <div></div>
        </div>
        {visible.map(r => {
          const isOpen = expanded === r.id
          const eventLabel = r.event
            ? `${r.event.store_name || stores.find(s => s.id === r.event!.store_id)?.name || 'Event'}${r.event.start_date ? ` · ${fmtDateShort(r.event.start_date)}` : ''}`
            : '—'
          const status = r.delivery_status || 'sent'
          const sc = STATUS_COLOR[status]
          return (
            <div key={r.id} style={{ borderTop: '1px solid var(--cream2)' }}>
              <div
                onClick={() => setExpanded(isOpen ? null : r.id)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: eventId ? '1.5fr 2fr 100px 90px 40px' : '1.5fr 1.5fr 1.5fr 100px 90px 40px',
                  padding: '10px 14px', alignItems: 'center',
                  fontSize: 13, cursor: 'pointer',
                }}
              >
                <div style={{ fontWeight: 700, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.subject_line_rendered}
                </div>
                {!eventId && (
                  <div style={{ color: 'var(--ash)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {eventLabel}
                  </div>
                )}
                <div style={{ color: 'var(--ash)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.to_name ? `${r.to_name} <${r.to_email}>` : r.to_email}
                </div>
                <div style={{ color: 'var(--mist)', fontSize: 12 }}>
                  {r.delivery_status === 'scheduled' && r.scheduled_for
                    ? fmtDateTime(r.scheduled_for)
                    : r.sent_at ? fmtDateTime(r.sent_at) : '—'}
                </div>
                <div>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
                    background: sc.bg, color: sc.fg,
                  }}>{STATUS_LABEL[status]}</span>
                </div>
                <div style={{ color: 'var(--mist)' }}>{isOpen ? '▾' : '▸'}</div>
              </div>
              {isOpen && (
                <div style={{ background: 'var(--cream)', padding: '12px 18px', borderTop: '1px solid var(--cream2)' }}>
                  <div style={{ fontSize: 11, color: 'var(--mist)', marginBottom: 6 }}>
                    From: <strong>{r.from_name}</strong> &lt;{r.from_email}&gt;
                  </div>
                  {r.cc_emails && r.cc_emails.length > 0 && (
                    <div style={{ fontSize: 11, color: 'var(--mist)', marginBottom: 6 }}>
                      CC: {r.cc_emails.join(', ')}
                    </div>
                  )}
                  {r.resend_message_id && (
                    <div style={{ fontSize: 11, color: 'var(--mist)', marginBottom: 6, fontFamily: 'monospace' }}>
                      Resend id: {r.resend_message_id}
                    </div>
                  )}
                  {r.failure_reason && (
                    <div style={{ fontSize: 11, color: '#991B1B', marginBottom: 6 }}>
                      <strong>Failure:</strong> {r.failure_reason}
                    </div>
                  )}
                  <div style={{
                    marginTop: 10, padding: 12,
                    background: '#fff', border: '1px solid var(--pearl)', borderRadius: 6,
                    fontSize: 12, lineHeight: 1.55, whiteSpace: 'pre-wrap', color: 'var(--ink)',
                    maxHeight: 280, overflowY: 'auto',
                  }}>
                    <FullBody id={r.id} />
                  </div>
                  {/* Scheduled-row actions — Cancel + Reschedule.
                      Visible only while delivery_status='scheduled';
                      sent rows are read-only. */}
                  {r.delivery_status === 'scheduled' && (
                    <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        onClick={() => cancelOne(r.id)}
                        disabled={busyRowId === r.id}
                        className="btn-outline btn-xs"
                      >🚫 Cancel</button>
                      <button
                        onClick={() => {
                          setReschedFor(r.id)
                          setReschedDt(r.scheduled_for
                            ? new Date(r.scheduled_for).toISOString().slice(0, 16)
                            : '')
                        }}
                        disabled={busyRowId === r.id}
                        className="btn-outline btn-xs"
                      >📅 Reschedule</button>
                      {reschedFor === r.id && (
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <input
                            type="datetime-local"
                            value={reschedDt}
                            onChange={e => setReschedDt(e.target.value)}
                          />
                          <button
                            onClick={() => rescheduleOne(r.id)}
                            disabled={busyRowId === r.id || !reschedDt}
                            className="btn-primary btn-xs"
                          >Save</button>
                          <button
                            onClick={() => { setReschedFor(null); setReschedDt('') }}
                            className="btn-outline btn-xs"
                          >Cancel</button>
                        </div>
                      )}
                    </div>
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

/** Lazy-load the body_rendered for an expanded row — the list
 *  query skips it to keep the initial payload small. */
function FullBody({ id }: { id: string }) {
  const [body, setBody] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { data } = await supabase.from('buying_communication_sends')
        .select('body_rendered').eq('id', id).maybeSingle()
      if (!cancelled) setBody((data as any)?.body_rendered || '(body unavailable)')
    })()
    return () => { cancelled = true }
  }, [id])
  if (body === null) return <span style={{ color: 'var(--mist)' }}>Loading body…</span>
  return <>{body}</>
}

function fmtDateShort(iso: string): string {
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    + ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}
