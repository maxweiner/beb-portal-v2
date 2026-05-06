'use client'

// Post-Event reconciliation — third tab in BuyingEventsView.
//
// Shows recently-completed events (3-day window already ended,
// status != cancelled, within last ~90 days). Per card:
//
//   • Final totals (customers, purchases, spend, commission)
//   • Spiff queue: store staff with completed appointments × the
//     event's per-show rate; Mark Paid (partner only) writes a
//     buying_event_spiff_payouts row.
//   • Per-event spiff rate editor (admin/partner only) — lets you
//     bump the default $10 to $20 etc. for a special push.
//   • Expense report status per buyer (open / submitted /
//     approved / paid pills) — links to the Expenses module.
//   • Debrief notes count by category (worked / didn't / do
//     differently) — link to legacy event detail to add.
//
// Search box at top filters by store + city, mirroring the
// Pre-Event tab.

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useApp } from '@/lib/context'
import { eventEndIso, formatEventRange } from '@/lib/eventDates'
import { eventDisplayName } from '@/lib/eventName'
import { eventSpend, eventCommission } from '@/lib/eventSpend'
import { fetchManifestsForEvents, type ShippingManifest } from '@/lib/shipping/manifests'
import ManifestCaptureModal from '@/components/shipping/ManifestCaptureModal'
import ManifestViewerModal from '@/components/shipping/ManifestViewerModal'
import type { Event } from '@/types'
import type { NavPage } from '@/app/page'

interface Props {
  setNav?: (n: NavPage) => void
}

type CompletedAppt = {
  event_id: string
  appointment_employee_id: string | null
  // The column is named appointment_employee_id for backwards compat,
  // but the table it references is store_employees (after the
  // unify-employees migration). Supabase types relations as arrays
  // even on many-to-one joins.
  store_employees?: { name: string | null }[] | { name: string | null } | null
}

type Payout = {
  id: string
  event_id: string
  appointment_employee_id: string | null
  employee_name: string
  amount: number
  appointments_count: number
  paid_at: string
  paid_by_name: string
}

type ExpenseReportRow = {
  event_id: string
  user_id: string
  status: 'active' | 'submitted_pending_review' | 'approved' | 'paid'
}

type EventNoteRow = {
  event_id: string
  category: 'worked' | 'didnt_work' | 'do_differently'
}

type WaitlistRow = {
  event_id: string
  how_heard: string | null
  status: 'waiting' | 'called' | 'served' | 'no_show'
}

const fmtMoney = (n: number) => '$' + Math.round(n).toLocaleString('en-US')

const LOOKBACK_DAYS = 90

export default function PostEventTab({ setNav }: Props) {
  const { stores, users, user, brand } = useApp()
  const isPartner = !!user?.is_partner
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin' || isPartner

  const [events, setEvents] = useState<Event[]>([])
  const [completedAppts, setCompletedAppts] = useState<CompletedAppt[]>([])
  const [payouts, setPayouts] = useState<Payout[]>([])
  const [expenseReports, setExpenseReports] = useState<ExpenseReportRow[]>([])
  const [eventNotes, setEventNotes] = useState<EventNoteRow[]>([])
  const [waitlist, setWaitlist] = useState<WaitlistRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [savingRate, setSavingRate] = useState<string | null>(null)
  const [payingFor, setPayingFor] = useState<string | null>(null)
  const [manifestsByEvent, setManifestsByEvent] = useState<Record<string, ShippingManifest[]>>({})
  const [manifestCaptureFor, setManifestCaptureFor] = useState<Event | null>(null)
  const [manifestCapturePrefill, setManifestCapturePrefill] = useState<string | null>(null)
  const [manifestViewerFor, setManifestViewerFor] = useState<Event | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      const todayIso = new Date().toISOString().slice(0, 10)
      const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - LOOKBACK_DAYS)
      const cutoffIso = cutoff.toISOString().slice(0, 10)

      // Brand-scoped — AppContext.events is loaded with this same
      // filter; mirror it here so a Liberty event doesn't show up
      // in the BEB Post-Event tab (or vice versa).
      const { data: evRows } = await supabase
        .from('events')
        .select('*')
        .eq('brand', brand)
        .gte('start_date', cutoffIso)
        .order('start_date', { ascending: false })

      const past = ((evRows || []) as any[])
        .map(e => ({ ...e, days: e.days || [] }))
        .filter(e => e.status !== 'cancelled')
        .filter(e => !!e.start_date && eventEndIso(e.start_date) < todayIso) as Event[]

      const ids = past.map(e => e.id)
      const [apptsRes, payoutsRes, reportsRes, notesRes, waitRes] = await Promise.all([
        ids.length === 0 ? Promise.resolve({ data: [] }) :
          supabase.from('appointments')
            .select('event_id, appointment_employee_id, store_employees(name)')
            .in('event_id', ids)
            .eq('status', 'completed')
            .not('appointment_employee_id', 'is', null),
        ids.length === 0 ? Promise.resolve({ data: [] }) :
          supabase.from('buying_event_spiff_payouts')
            .select('id, event_id, appointment_employee_id, employee_name, amount, appointments_count, paid_at, paid_by_name')
            .in('event_id', ids),
        ids.length === 0 ? Promise.resolve({ data: [] }) :
          supabase.from('expense_reports')
            .select('event_id, user_id, status')
            .in('event_id', ids),
        ids.length === 0 ? Promise.resolve({ data: [] }) :
          supabase.from('event_notes')
            .select('event_id, category')
            .in('event_id', ids),
        ids.length === 0 ? Promise.resolve({ data: [] }) :
          supabase.from('event_waitlist')
            .select('event_id, how_heard, status')
            .in('event_id', ids),
      ])

      if (cancelled) return
      setEvents(past)
      setCompletedAppts((apptsRes.data || []) as CompletedAppt[])
      setPayouts((payoutsRes.data || []) as Payout[])
      setExpenseReports((reportsRes.data || []) as ExpenseReportRow[])
      setEventNotes((notesRes.data || []) as EventNoteRow[])
      setWaitlist((waitRes.data || []) as WaitlistRow[])
      setLoading(false)

      // Manifests for the visible past events — best-effort, doesn't
      // block the rest of the tab from rendering. fetchManifestsForEvents
      // returns a flat array; group by event_id here.
      if (ids.length > 0) {
        const flat = await fetchManifestsForEvents(ids).catch(() => [] as ShippingManifest[])
        if (!cancelled) {
          const grouped: Record<string, ShippingManifest[]> = {}
          for (const m of flat) {
            const eid = (m as any).event_id || (m as any).box_id
            if (!eid) continue
            if (!grouped[eid]) grouped[eid] = []
            grouped[eid].push(m)
          }
          setManifestsByEvent(grouped)
        }
      }
    })()
    return () => { cancelled = true }
  }, [brand])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return events
    return events.filter(e => {
      const name = eventDisplayName(e, stores).toLowerCase()
      const store = stores.find(s => s.id === e.store_id)
      const cs = `${store?.city || ''} ${store?.state || ''}`.toLowerCase()
      return name.includes(q) || cs.includes(q)
    })
  }, [events, search, stores])

  // Earned spiffs per (event_id, employee_id) = completed appointments
  // grouped. Returned as a Map<eventId, Array<{employeeId, name, count}>>.
  const earnedByEvent = useMemo(() => {
    const m = new Map<string, Map<string, { name: string; count: number }>>()
    for (const a of completedAppts) {
      if (!a.appointment_employee_id) continue
      let inner = m.get(a.event_id)
      if (!inner) { inner = new Map(); m.set(a.event_id, inner) }
      const prev = inner.get(a.appointment_employee_id)
      const rel = a.store_employees
      const name =
        (Array.isArray(rel) ? rel[0]?.name : rel?.name) || 'Unknown employee'
      inner.set(a.appointment_employee_id, { name, count: (prev?.count || 0) + 1 })
    }
    return m
  }, [completedAppts])

  const payoutsByEvent = useMemo(() => {
    const m = new Map<string, Payout[]>()
    for (const p of payouts) {
      const arr = m.get(p.event_id) || []
      arr.push(p); m.set(p.event_id, arr)
    }
    return m
  }, [payouts])

  const reportsByEvent = useMemo(() => {
    const m = new Map<string, ExpenseReportRow[]>()
    for (const r of expenseReports) {
      const arr = m.get(r.event_id) || []
      arr.push(r); m.set(r.event_id, arr)
    }
    return m
  }, [expenseReports])

  const waitlistByEvent = useMemo(() => {
    const m = new Map<string, { total: number; served: number; noShow: number; heardCounts: Record<string, number> }>()
    for (const w of waitlist) {
      const cur = m.get(w.event_id) || { total: 0, served: 0, noShow: 0, heardCounts: {} }
      cur.total += 1
      if (w.status === 'served') cur.served += 1
      if (w.status === 'no_show') cur.noShow += 1
      const key = (w.how_heard || 'Not specified').trim()
      cur.heardCounts[key] = (cur.heardCounts[key] || 0) + 1
      m.set(w.event_id, cur)
    }
    return m
  }, [waitlist])

  const notesByEvent = useMemo(() => {
    const m = new Map<string, { worked: number; didnt_work: number; do_differently: number }>()
    for (const n of eventNotes) {
      const cur = m.get(n.event_id) || { worked: 0, didnt_work: 0, do_differently: 0 }
      cur[n.category] += 1
      m.set(n.event_id, cur)
    }
    return m
  }, [eventNotes])

  async function updateRate(ev: Event, value: string) {
    const num = Number(value)
    if (!Number.isFinite(num) || num < 0) { alert('Rate must be a non-negative number'); return }
    setSavingRate(ev.id)
    const { error } = await supabase.from('events').update({ spiff_amount_per_show: num }).eq('id', ev.id)
    setSavingRate(null)
    if (error) { alert('Failed to update rate: ' + error.message); return }
    setEvents(es => es.map(e => e.id === ev.id ? { ...e, spiff_amount_per_show: num } : e))
  }

  async function markPaid(ev: Event, employeeId: string, employeeName: string, count: number) {
    const rate = (ev as any).spiff_amount_per_show ?? 10
    const amount = +(rate * count).toFixed(2)
    const ok = confirm(`Mark ${employeeName} as paid?\n\n${count} show-up appointment${count === 1 ? '' : 's'} × ${fmtMoney(rate)} = ${fmtMoney(amount)}\n\nThis is a one-step action and cannot be undone from the UI.`)
    if (!ok) return
    const key = `${ev.id}:${employeeId}`
    setPayingFor(key)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/buying-event-spiffs/payouts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          event_id: ev.id,
          appointment_employee_id: employeeId,
          employee_name: employeeName,
          amount,
          appointments_count: count,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { alert('Failed: ' + (json.error || res.status)); return }
      if (json.payout) setPayouts(ps => [...ps, json.payout])
    } finally {
      setPayingFor(null)
    }
  }

  if (loading) {
    return <div style={{ padding: 24, color: 'var(--mist)', fontSize: 13 }}>Loading reconciliation…</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <SearchBox value={search} onChange={setSearch} placeholder="Search by store or city…" />

      {filtered.length === 0 && (
        <div style={{
          background: '#fff', border: '1px solid var(--cream2)', borderRadius: 10,
          padding: 32, textAlign: 'center', color: 'var(--mist)', fontSize: 14,
        }}>
          {search.trim()
            ? <>No completed events match "<strong>{search}</strong>".</>
            : <>No completed buying events in the last {LOOKBACK_DAYS} days.</>}
        </div>
      )}

      {filtered.map(ev => {
        const earned = earnedByEvent.get(ev.id) || new Map()
        const paid = payoutsByEvent.get(ev.id) || []
        const paidEmployeeIds = new Set(paid.map(p => p.appointment_employee_id))

        const totalCustomers = (ev.days || []).reduce((s, d) => s + Number(d.customers || 0), 0)
        const totalPurchases = (ev.days || []).reduce((s, d) => s + Number(d.purchases || 0), 0)
        const totalSpend = eventSpend(ev)
        const totalCommission = eventCommission(ev)

        const rate = (ev as any).spiff_amount_per_show ?? 10
        const spiffsTotal = Array.from(earned.values()).reduce((s, e) => s + e.count * rate, 0)
        const spiffsPaid = paid.reduce((s, p) => s + Number(p.amount), 0)

        const wait = waitlistByEvent.get(ev.id) || { total: 0, served: 0, noShow: 0, heardCounts: {} as Record<string, number> }
        const reports = reportsByEvent.get(ev.id) || []
        const noteCounts = notesByEvent.get(ev.id) || { worked: 0, didnt_work: 0, do_differently: 0 }
        const totalNotes = noteCounts.worked + noteCounts.didnt_work + noteCounts.do_differently

        const store = stores.find(s => s.id === ev.store_id)
        const display = eventDisplayName(ev, stores)

        return (
          <div key={ev.id} style={{
            background: '#fff', border: '1px solid var(--cream2)',
            borderLeft: '4px solid #6B7280', borderRadius: 10, padding: '14px 16px',
          }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)' }}>
                  <span style={{
                    display: 'inline-block', fontSize: 10, fontWeight: 800,
                    background: '#e5e7eb', color: '#374151', padding: '2px 6px', borderRadius: 4,
                    marginRight: 8, verticalAlign: 'middle',
                  }}>✓ COMPLETED</span>
                  {display}
                </div>
                <div style={{ fontSize: 12, color: 'var(--mist)', marginTop: 2 }}>
                  {store?.city}{store?.state ? `, ${store.state}` : ''} · {ev.start_date ? formatEventRange(ev.start_date) : ''}
                </div>
              </div>
              {(() => {
                const manifestCount = manifestsByEvent[ev.id]?.length ?? 0
                return (
                  <button
                    onClick={() => {
                      if (manifestCount > 0) setManifestViewerFor(ev)
                      else setManifestCaptureFor(ev)
                    }}
                    className="btn-outline btn-sm"
                    style={{ flexShrink: 0 }}
                    title={manifestCount > 0 ? `View ${manifestCount} manifest photo${manifestCount === 1 ? '' : 's'}` : 'Take or upload a manifest photo'}
                  >
                    📷 {manifestCount > 0 ? `Manifest (${manifestCount})` : 'Manifest'}
                  </button>
                )
              })()}
            </div>

            {/* Final totals */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 14 }}>
              <Tile label="Customers" value={String(totalCustomers)} />
              <Tile label="Purchases" value={String(totalPurchases)} />
              <Tile label="Total spend" value={fmtMoney(totalSpend)} />
              <Tile label="Commission" value={fmtMoney(totalCommission)} accent />
            </div>

            {/* Spiffs */}
            <Section
              title="💰 Spiff queue"
              right={
                isAdmin && (
                  <span style={{ fontSize: 12, color: 'var(--mist)' }}>
                    Rate per show:{' '}
                    <input
                      type="number" min="0" step="0.01"
                      defaultValue={String(rate)}
                      disabled={savingRate === ev.id}
                      onBlur={e => {
                        if (e.target.value !== String(rate)) updateRate(ev, e.target.value)
                      }}
                      style={{
                        width: 70, padding: '2px 6px', fontSize: 12,
                        border: '1px solid var(--cream2)', borderRadius: 4, fontFamily: 'inherit',
                      }}
                    />
                  </span>
                )
              }
            >
              {earned.size === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--mist)', padding: '6px 0' }}>
                  No completed appointments attributed to staff for this event.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {Array.from(earned.entries()).map(([empId, info]) => {
                    const isPaid = paidEmployeeIds.has(empId)
                    const payRow = paid.find(p => p.appointment_employee_id === empId)
                    return (
                      <div key={empId} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '6px 8px', borderRadius: 6,
                        background: isPaid ? '#ecfdf5' : 'var(--cream2)',
                        border: `1px solid ${isPaid ? '#a7f3d0' : 'var(--cream2)'}`,
                      }}>
                        <div style={{ fontSize: 13 }}>
                          <strong>{info.name}</strong>
                          <span style={{ color: 'var(--mist)', marginLeft: 8 }}>
                            {info.count} show{info.count === 1 ? '' : 's'} × {fmtMoney(rate)} = {fmtMoney(info.count * rate)}
                          </span>
                        </div>
                        {isPaid ? (
                          <span style={{ fontSize: 11, fontWeight: 700, color: '#065f46' }}>
                            ✓ Paid {fmtMoney(Number(payRow?.amount || 0))} by {payRow?.paid_by_name}
                          </span>
                        ) : isPartner ? (
                          <button
                            onClick={() => markPaid(ev, empId, info.name, info.count)}
                            disabled={payingFor === `${ev.id}:${empId}`}
                            className="btn-primary btn-xs"
                          >
                            {payingFor === `${ev.id}:${empId}` ? '…' : 'Mark Paid'}
                          </button>
                        ) : (
                          <span style={{ fontSize: 11, color: 'var(--mist)' }}>(partner only)</span>
                        )}
                      </div>
                    )
                  })}
                  {(spiffsTotal > 0 || spiffsPaid > 0) && (
                    <div style={{ fontSize: 11, color: 'var(--mist)', textAlign: 'right', marginTop: 2 }}>
                      Earned {fmtMoney(spiffsTotal)} · Paid {fmtMoney(spiffsPaid)}
                    </div>
                  )}
                </div>
              )}
            </Section>

            {/* Expense reports */}
            <Section
              title="🧾 Expense reports"
              right={
                <button onClick={() => setNav?.('expenses')} className="btn-outline btn-xs">
                  Open module →
                </button>
              }
            >
              {(ev.workers || []).filter(w => !(w as any).deleted).length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--mist)' }}>No buyers were assigned to this event.</div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {(ev.workers || []).filter(w => !(w as any).deleted).map(w => {
                    const r = reports.find(x => x.user_id === w.id)
                    const status = r?.status || 'not_started'
                    return <ExpensePill key={w.id} name={w.name} status={status} />
                  })}
                </div>
              )}
            </Section>

            {/* Debrief */}
            {wait.total > 0 && (
              <Section title={`🪑 Waitlist · ${wait.total} total`}>
                <div style={{ fontSize: 12, color: 'var(--ash)', marginBottom: 8 }}>
                  <strong style={{ color: '#065f46' }}>{wait.served}</strong> served ·{' '}
                  <strong style={{ color: '#7a1f0f' }}>{wait.noShow}</strong> no-show ·{' '}
                  <strong style={{ color: 'var(--mist)' }}>{wait.total - wait.served - wait.noShow}</strong> uncategorized
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {Object.entries(wait.heardCounts)
                    .sort((a, b) => b[1] - a[1])
                    .map(([source, n]) => (
                      <span key={source} style={{
                        fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
                        background: 'var(--cream2)', color: 'var(--ash)',
                      }}>
                        {source} · {n}
                      </span>
                    ))}
                </div>
              </Section>
            )}

            <Section title="📝 Debrief">
              {totalNotes === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--mist)' }}>No debrief notes yet.</div>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--ash)' }}>
                  <strong style={{ color: '#065f46' }}>{noteCounts.worked}</strong> worked ·{' '}
                  <strong style={{ color: '#7a1f0f' }}>{noteCounts.didnt_work}</strong> didn't ·{' '}
                  <strong style={{ color: '#7a5b00' }}>{noteCounts.do_differently}</strong> do differently
                </div>
              )}
            </Section>
          </div>
        )
      })}

      {manifestCaptureFor && (
        <ManifestCaptureModal
          boxId={manifestCaptureFor.id}
          boxLabel={eventDisplayName(manifestCaptureFor, stores)}
          existingBoxLabels={(manifestsByEvent[manifestCaptureFor.id] || []).map((m: any) => m.box_label).filter(Boolean)}
          initialBoxLabel={manifestCapturePrefill || undefined}
          onClose={() => { setManifestCaptureFor(null); setManifestCapturePrefill(null) }}
          onUploaded={(m) => {
            setManifestsByEvent(prev => ({
              ...prev,
              [manifestCaptureFor.id]: [...(prev[manifestCaptureFor.id] || []), m],
            }))
            setManifestCaptureFor(null)
            setManifestCapturePrefill(null)
          }}
        />
      )}

      {manifestViewerFor && (
        <ManifestViewerModal
          boxLabel={eventDisplayName(manifestViewerFor, stores)}
          manifests={manifestsByEvent[manifestViewerFor.id] || []}
          onClose={() => setManifestViewerFor(null)}
          onAddAnother={(currentBoxLabel) => {
            const ev = manifestViewerFor
            setManifestViewerFor(null)
            if (ev) {
              setManifestCapturePrefill(currentBoxLabel)
              setManifestCaptureFor(ev)
            }
          }}
          onDeleted={(id) => {
            const ev = manifestViewerFor
            if (!ev) return
            setManifestsByEvent(prev => ({
              ...prev,
              [ev.id]: (prev[ev.id] || []).filter(x => x.id !== id),
            }))
          }}
        />
      )}
    </div>
  )
}

// ── Helpers ─────────────────────────────────────────────────

function Tile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{
      background: '#fff', border: '1px solid var(--cream2)',
      borderRadius: 8, padding: '8px 10px',
    }}>
      <div style={{ fontSize: 10, color: 'var(--mist)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '.04em' }}>
        {label}
      </div>
      <div style={{ fontSize: 16, fontWeight: 800, color: accent ? 'var(--green-dark)' : 'var(--ink)', marginTop: 2 }}>
        {value}
      </div>
    </div>
  )
}

function Section({
  title, right, children,
}: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 6,
      }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
          {title}
        </div>
        {right}
      </div>
      {children}
    </div>
  )
}

function ExpensePill({ name, status }: { name: string; status: string }) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    not_started:              { bg: 'var(--cream2)', fg: 'var(--mist)', label: 'Not started' },
    active:                   { bg: '#fff8e1', fg: '#7a5b00', label: 'Open' },
    submitted_pending_review: { bg: '#fef3c7', fg: '#7a5b00', label: 'Submitted' },
    approved:                 { bg: '#dbeafe', fg: '#1e40af', label: 'Approved' },
    paid:                     { bg: '#dcfce7', fg: '#065f46', label: 'Paid' },
  }
  const c = map[status] || map.not_started
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: '4px 8px', borderRadius: 6,
      background: c.bg, color: c.fg, border: `1px solid ${c.bg}`,
    }}>
      {name} · {c.label}
    </span>
  )
}

function SearchBox({
  value, onChange, placeholder,
}: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div style={{ position: 'relative' }}>
      <span style={{
        position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
        color: 'var(--mist)', fontSize: 13, pointerEvents: 'none',
      }}>🔍</span>
      <input
        type="search" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={{
          width: '100%', boxSizing: 'border-box',
          padding: '8px 32px', fontSize: 13, fontFamily: 'inherit',
          background: '#fff', color: 'var(--ink)',
          border: '1px solid var(--cream2)', borderRadius: 8,
        }}
      />
      {value && (
        <button
          onClick={() => onChange('')}
          aria-label="Clear search"
          style={{
            position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--mist)', fontSize: 14, padding: 4, lineHeight: 1,
          }}
        >✕</button>
      )}
    </div>
  )
}
