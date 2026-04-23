'use client'

import { useState, useEffect, useRef } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import { useAutosave, AutosaveIndicator } from '@/lib/useAutosave'
import { rollupEventDay } from '@/lib/dayRollup'
import EventNotesNudge from '@/components/events/EventNotesNudge'

interface BuyerEntry {
  id: string
  event_id: string
  day_number: number
  buyer_id: string
  buyer_name: string
  customers_seen: number
  purchases_made: number | null
  dollars_at_10pct: number | null
  dollars_at_5pct: number | null
  submitted_at: string | null
  src_vdp: number; src_postcard: number; src_social: number
  src_wordofmouth: number; src_repeat: number; src_store: number
  src_text: number; src_newspaper: number; src_other: number
}

interface BuyerCheck {
  id: string
  entry_id: string
  check_number: string
  buy_form_number: string
  amount: number
  payment_type: string
  commission_rate: number
}

type InputMode = 'grid' | 'card'

const LEAD_SOURCES = [
  { key: 'src_vdp', label: 'VDP' },
  { key: 'src_postcard', label: 'Postcard' },
  { key: 'src_social', label: 'Social' },
  { key: 'src_wordofmouth', label: 'Word of Mouth' },
  { key: 'src_repeat', label: 'Repeat' },
  { key: 'src_store', label: 'Store' },
  { key: 'src_text', label: 'Text' },
  { key: 'src_newspaper', label: 'Newspaper' },
  { key: 'src_other', label: 'Other' },
]

export default function DayEntry() {
  const { events, users, user, stores, reload, dayEntryIntent, setDayEntryIntent } = useApp()
  const isSuperAdmin = user?.role === 'superadmin'
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin'
  const [creatingPastEvent, setCreatingPastEvent] = useState(false)
  const [pastStoreId, setPastStoreId] = useState('')
  const [pastStartDate, setPastStartDate] = useState('')
  const [creatingSaving, setCreatingSaving] = useState(false)

  const createOrFindPastEvent = async () => {
    if (!pastStoreId || !pastStartDate) return
    setCreatingSaving(true)
    try {
      const { data: existing } = await supabase
        .from('events')
        .select('id')
        .eq('store_id', pastStoreId)
        .eq('start_date', pastStartDate)
        .maybeSingle()
      let eventId: string | null = existing?.id ?? null
      if (!eventId) {
        const store = stores.find(s => s.id === pastStoreId)
        const { data: newEv, error } = await supabase
          .from('events')
          .insert({ store_id: pastStoreId, store_name: store?.name || '', start_date: pastStartDate, created_by: user?.id })
          .select('id')
          .single()
        if (error) { alert(error.message); setCreatingSaving(false); return }
        eventId = newEv.id
      }
      await reload()
      if (eventId) setSelectedEventId(eventId)
      setMode('all') // land in Combined mode for past-event aggregate entry
      setSelectedDay(1)
      setCreatingPastEvent(false)
      setPastStoreId('')
      setPastStartDate('')
    } finally {
      setCreatingSaving(false)
    }
  }

  // Only show events this buyer is assigned to (or all for admin)
  const myEvents = events.filter(ev => {
    if (isAdmin) return true
    return (ev.workers || []).some((w: any) => w.id === user?.id)
  }).sort((a, b) => b.start_date.localeCompare(a.start_date))

  const [selectedEventId, setSelectedEventId] = useState('')
  const [selectedDay, setSelectedDay] = useState(1)
  const [mode, setMode] = useState<'buyer' | 'all'>('buyer') // buyer = individual, all = superadmin combined
  const [buyerEntries, setBuyerEntries] = useState<BuyerEntry[]>([])
  const [selectedBuyerId, setSelectedBuyerId] = useState(user?.id || '')
  const [loading, setLoading] = useState(false)

  const selectedEvent = myEvents.find(e => e.id === selectedEventId)
  const eventWorkers = (selectedEvent?.workers || []) as { id: string; name: string }[]

  // Auto-select the logged-in user on login and whenever the event changes.
  // Superadmins can still click any pill to view another buyer afterwards;
  // non-superadmins can't click other pills (onClick guard below), so they
  // stay locked to themselves.
  useEffect(() => {
    if (user?.id) setSelectedBuyerId(user.id)
  }, [user?.id, selectedEventId])

  // Consume a deep-link intent (e.g. tapped an Events day pill). One-shot.
  useEffect(() => {
    if (!dayEntryIntent) return
    setSelectedEventId(dayEntryIntent.eventId)
    setSelectedDay(dayEntryIntent.day)
    if (dayEntryIntent.mode && isSuperAdmin) setMode(dayEntryIntent.mode === 'combined' ? 'all' : 'buyer')
    setDayEntryIntent(null)
  }, [dayEntryIntent, isSuperAdmin])

  useEffect(() => {
    if (selectedEventId) loadBuyerEntries()
  }, [selectedEventId, selectedDay])

  const loadBuyerEntries = async () => {
    setLoading(true)
    const { data } = await supabase.from('buyer_entries')
      .select('*')
      .eq('event_id', selectedEventId)
      .eq('day_number', selectedDay)
    setBuyerEntries(data || [])
    setLoading(false)
  }

  const myEntry = buyerEntries.find(e => e.buyer_id === selectedBuyerId)
  const selectedWorker = eventWorkers.find(w => w.id === selectedBuyerId)

  const fmt = (ds: string) => new Date(ds + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-2xl font-black" style={{ color: 'var(--ink)' }}>Enter Day Data</h1>
        {isSuperAdmin && (
          <div style={{ display: 'flex', gap: 4, background: 'var(--cream2)', padding: 4, borderRadius: 'var(--r)', border: '1px solid var(--pearl)' }}>
            {(['buyer', 'all'] as const).map(m => (
              <button key={m} onClick={() => setMode(m)} style={{
                padding: '6px 14px', borderRadius: 'calc(var(--r) - 2px)', border: 'none', cursor: 'pointer',
                background: mode === m ? 'var(--sidebar-bg)' : 'transparent',
                color: mode === m ? '#fff' : 'var(--ash)', fontWeight: 700, fontSize: 13,
              }}>
                {m === 'buyer' ? '👤 By Buyer' : '📊 Combined'}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Event + Day selector */}
      <div className="card mb-5">
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: 2, minWidth: 200 }}>
            <label className="fl">Event</label>
            <select value={selectedEventId} onChange={e => { setSelectedEventId(e.target.value); setSelectedDay(1) }}>
              <option value="">Select event…</option>
              {myEvents.map(ev => (
                <option key={ev.id} value={ev.id}>{ev.store_name} — {fmt(ev.start_date)}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="fl">Day</label>
            <select value={selectedDay} onChange={e => setSelectedDay(Number(e.target.value))}>
              <option value={1}>Day 1</option>
              <option value={2}>Day 2</option>
              <option value={3}>Day 3</option>
            </select>
          </div>
          {isSuperAdmin && !creatingPastEvent && (
            <button className="btn-outline btn-sm" onClick={() => setCreatingPastEvent(true)}>
              + Create past event
            </button>
          )}
        </div>
        {isSuperAdmin && creatingPastEvent && (
          <div style={{ marginTop: 14, padding: 14, background: 'var(--cream2)', border: '1px solid var(--pearl)', borderRadius: 'var(--r)' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', marginBottom: 10 }}>Create a past event</div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div className="field" style={{ flex: 2, minWidth: 200 }}>
                <label className="fl">Store</label>
                <select value={pastStoreId} onChange={e => setPastStoreId(e.target.value)}>
                  <option value="">Select store…</option>
                  {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label className="fl">Start date</label>
                <input type="date" value={pastStartDate} onChange={e => setPastStartDate(e.target.value)} />
              </div>
              <button className="btn-primary btn-sm" disabled={!pastStoreId || !pastStartDate || creatingSaving} onClick={createOrFindPastEvent}>
                {creatingSaving ? 'Saving…' : 'Create & select'}
              </button>
              <button className="btn-outline btn-sm" onClick={() => { setCreatingPastEvent(false); setPastStoreId(''); setPastStartDate('') }}>
                Cancel
              </button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--mist)', marginTop: 8 }}>
              If an event already exists for that store and date, it will be selected instead of duplicated.
            </div>
          </div>
        )}
      </div>

      {!selectedEventId && (
        <div className="card text-center py-12" style={{ color: 'var(--mist)' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📝</div>
          <div className="font-bold">Select an event to enter day data</div>
          {myEvents.length === 0 && <div style={{ fontSize: 13, marginTop: 8 }}>You are not assigned to any events yet.</div>}
        </div>
      )}

      {selectedEventId && !loading && (
        <>
          {/* Mode: Combined (superadmin only) */}
          {mode === 'all' && isSuperAdmin && (
            <CombinedEntryForm
              event={selectedEvent!}
              dayNumber={selectedDay}
              onSaved={() => { loadBuyerEntries(); reload() }}
            />
          )}

          {/* Mode: By Buyer */}
          {mode === 'buyer' && (
            <>
              {/* Buyer status overview */}
              <div className="card mb-5">
                <div className="card-title">Day {selectedDay} — Buyer Status</div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {eventWorkers.length === 0 && (
                    <div style={{ color: 'var(--mist)', fontSize: 13 }}>No buyers assigned to this event.</div>
                  )}
                  {eventWorkers.map(w => {
                    const entry = buyerEntries.find(e => e.buyer_id === w.id)
                    const submitted = !!entry?.submitted_at
                    const started = !!entry && !submitted
                    return (
                      <div key={w.id}
                        onClick={() => (isSuperAdmin || w.id === user?.id) && setSelectedBuyerId(w.id)}
                        style={{
                          padding: '10px 16px', borderRadius: 'var(--r)', border: `2px solid ${submitted ? 'var(--green)' : started ? '#f59e0b' : 'var(--pearl)'}`,
                          background: selectedBuyerId === w.id ? 'var(--green-pale)' : 'var(--cream)',
                          cursor: (isSuperAdmin || w.id === user?.id) ? 'pointer' : 'default',
                          display: 'flex', alignItems: 'center', gap: 10,
                        }}>
                        <div style={{ width: 10, height: 10, borderRadius: '50%', background: submitted ? 'var(--green)' : started ? '#f59e0b' : 'var(--silver)', flexShrink: 0 }} />
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--ink)' }}>{w.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--mist)' }}>
                            {submitted ? `✓ Submitted` : started ? 'In progress' : 'Not started'}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Individual buyer entry — also renders for superadmins
                  viewing their own data on events where they aren't on
                  the worker roster. */}
              {selectedBuyerId && (eventWorkers.some(w => w.id === selectedBuyerId) || selectedBuyerId === user?.id) && (
                <>
                  {!eventWorkers.some(w => w.id === selectedBuyerId) && selectedBuyerId === user?.id && (
                    <div className="card mb-3" style={{ padding: '10px 14px', fontSize: 13, color: 'var(--mist)', background: 'var(--amber-pale)', border: '1px solid var(--amber)' }}>
                      ⚠ You're not on this event's worker roster. Viewing your own data anyway.
                    </div>
                  )}
                  <BuyerEntryForm
                    eventId={selectedEventId}
                    dayNumber={selectedDay}
                    buyerId={selectedBuyerId}
                    buyerName={eventWorkers.find(w => w.id === selectedBuyerId)?.name || user?.name || 'You'}
                    existingEntry={myEntry || null}
                    otherBuyers={eventWorkers.filter(w => w.id !== selectedBuyerId)}
                    onSaved={loadBuyerEntries}
                  />
                </>
              )}

              {selectedBuyerId && !eventWorkers.some(w => w.id === selectedBuyerId) && selectedBuyerId !== user?.id && (
                <div className="card text-center py-8" style={{ color: 'var(--mist)' }}>
                  Selected buyer is not assigned to this event.
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

/* ── BUYER ENTRY FORM ── */
function BuyerEntryForm({ eventId, dayNumber, buyerId, buyerName, existingEntry, otherBuyers, onSaved }: {
  eventId: string; dayNumber: number; buyerId: string; buyerName: string
  existingEntry: BuyerEntry | null; otherBuyers: { id: string; name: string }[]
  onSaved: () => void
}) {
  const { user, events, stores } = useApp()
  const [inputMode, setInputMode] = useState<InputMode>('grid')
  const [showNotesNudge, setShowNotesNudge] = useState(false)
  const [customersSeeen, setCustomersSeen] = useState(String(existingEntry?.customers_seen || ''))
  const [purchases, setPurchases] = useState(existingEntry?.purchases_made != null ? String(existingEntry.purchases_made) : '')
  const [tenPct, setTenPct] = useState(existingEntry?.dollars_at_10pct != null ? String(existingEntry.dollars_at_10pct) : '')
  const [fivePct, setFivePct] = useState(existingEntry?.dollars_at_5pct != null ? String(existingEntry.dollars_at_5pct) : '')
  const [sources, setSources] = useState<Record<string, string>>(
    Object.fromEntries(LEAD_SOURCES.map(s => [s.key, String((existingEntry as any)?.[s.key] || '')]))
  )
  const [checks, setChecks] = useState<Omit<BuyerCheck, 'id' | 'entry_id'>[]>([])
  const [loadingChecks, setLoadingChecks] = useState(false)
  const [saving, setSaving] = useState(false)
  const [submitted, setSubmitted] = useState(!!existingEntry?.submitted_at)
  const isSubmitted = submitted
  const entryIdRef = useRef<string | null>(existingEntry?.id || null)
  const hydratedRef = useRef(false)

  useEffect(() => {
    hydratedRef.current = false
    entryIdRef.current = existingEntry?.id || null
    setCustomersSeen(String(existingEntry?.customers_seen || ''))
    setPurchases(existingEntry?.purchases_made != null ? String(existingEntry.purchases_made) : '')
    setTenPct(existingEntry?.dollars_at_10pct != null ? String(existingEntry.dollars_at_10pct) : '')
    setFivePct(existingEntry?.dollars_at_5pct != null ? String(existingEntry.dollars_at_5pct) : '')
    setSources(Object.fromEntries(LEAD_SOURCES.map(s => [s.key, String((existingEntry as any)?.[s.key] || '')])))
    setSubmitted(!!existingEntry?.submitted_at)
    if (existingEntry?.id) loadChecks(existingEntry.id)
    else {
      setChecks([emptyCheck()])
      setLoadingChecks(false)
      setTimeout(() => { hydratedRef.current = true }, 0)
    }
  }, [existingEntry?.id])

  const loadChecks = async (entryId: string) => {
    setLoadingChecks(true)
    const { data } = await supabase.from('buyer_checks').select('*').eq('entry_id', entryId).order('created_at')
    setChecks(data && data.length > 0
      ? data.map((c: any) => ({ ...c, commission_rate: c.commission_rate === 5 ? 5 : 10 }))
      : [emptyCheck()])
    setLoadingChecks(false)
    setTimeout(() => { hydratedRef.current = true }, 0)
  }

  const emptyCheck = () => ({
    check_number: '', buy_form_number: '', amount: '' as any,
    payment_type: 'check', event_id: eventId, commission_rate: 10,
  })

  const addRows = () => setChecks(p => [...p, emptyCheck(), emptyCheck(), emptyCheck(), emptyCheck(), emptyCheck()])

  const updateCheck = (i: number, field: string, value: string | number) => {
    setChecks(p => p.map((c, idx) => idx === i ? { ...c, [field]: value } : c))
  }

  const removeCheck = (i: number) => setChecks(p => p.filter((_, idx) => idx !== i))

  const validChecks = checks.filter(c => c.amount && parseFloat(String(c.amount)) > 0)
  const totalAmount = validChecks.reduce((s, c) => s + parseFloat(String(c.amount) || '0'), 0)
  const totalPurchases = validChecks.length
  const derived10 = validChecks.filter(c => c.commission_rate === 10).reduce((s, c) => s + parseFloat(String(c.amount)), 0)
  const derived5  = validChecks.filter(c => c.commission_rate === 5 ).reduce((s, c) => s + parseFloat(String(c.amount)), 0)
  const hasValidChecks = validChecks.length > 0

  type Overrides = Partial<{ purchases: string; tenPct: string; fivePct: string }>
  // Mutex so overlapping autosave + manual-submit calls don't both INSERT
  // before the first one's id has been written back into entryIdRef.
  const persistInFlightRef = useRef(false)
  const persist = async (submit: boolean, overrides: Overrides = {}) => {
    if (persistInFlightRef.current) return
    persistInFlightRef.current = true
    try {
      const effPurchases = overrides.purchases ?? purchases
      const effTenPct    = overrides.tenPct    ?? tenPct
      const effFivePct   = overrides.fivePct   ?? fivePct
      const entryPayload: any = {
        event_id: eventId, day_number: dayNumber, day: dayNumber,
        buyer_id: buyerId, buyer_name: buyerName,
        customers_seen: parseInt(customersSeeen) || 0,
        purchases_made: effPurchases !== '' ? parseInt(effPurchases) || 0 : null,
        dollars_at_10pct: effTenPct !== '' ? parseFloat(effTenPct) : null,
        dollars_at_5pct: effFivePct !== '' ? parseFloat(effFivePct) : null,
        ...Object.fromEntries(LEAD_SOURCES.map(s => [s.key, parseInt(sources[s.key]) || 0])),
        submitted_at: submit ? new Date().toISOString() : existingEntry?.submitted_at || null,
      }

      // Fresh-existing check — DB wins over stale state. Adopts an existing
      // row's id instead of INSERTing a new one, which stops concurrent
      // autosave + submit from creating duplicates.
      let entryId = entryIdRef.current
      if (!entryId && eventId && buyerId) {
        const { data: existingRows } = await supabase.from('buyer_entries')
          .select('id')
          .eq('event_id', eventId)
          .eq('day_number', dayNumber)
          .eq('buyer_id', buyerId)
          .limit(1)
        if (existingRows && existingRows.length > 0) {
          entryId = existingRows[0].id
          entryIdRef.current = entryId
        }
      }

      if (entryId) {
        const { error } = await supabase.from('buyer_entries').update(entryPayload).eq('id', entryId)
        if (error) throw error
      } else {
        const { data, error } = await supabase.from('buyer_entries').insert(entryPayload).select().single()
        if (error) throw error
        entryId = data?.id || null
        entryIdRef.current = entryId
      }

      if (!entryId) throw new Error('Failed to save entry')

      const { error: delErr } = await supabase.from('buyer_checks').delete().eq('entry_id', entryId)
      if (delErr) throw delErr
      if (validChecks.length > 0) {
        const { error } = await supabase.from('buyer_checks').insert(
          validChecks.map(c => ({
            entry_id: entryId!,
            event_id: eventId,
            check_number: c.check_number,
            buy_form_number: c.buy_form_number,
            amount: parseFloat(String(c.amount)) || 0,
            payment_type: c.payment_type,
            commission_rate: c.commission_rate === 5 ? 5 : 10,
          }))
        )
        if (error) throw error
      }

      // Roll the per-buyer totals up into event_days so Dashboard / Events
      // pills / Reports show consistent numbers.
      await rollupEventDay(eventId, dayNumber)
    } finally {
      persistInFlightRef.current = false
    }
  }

  const autosaveStatus = useAutosave(
    { customersSeeen, purchases, tenPct, fivePct, sources, checks },
    async () => { await persist(false) },
    { enabled: hydratedRef.current && !loadingChecks && !saving, delay: 1000 }
  )

  const submit = async () => {
    if (saving) return            // guard against rapid double-clicks
    setSaving(true)
    // On Submit, check totals OVERWRITE top aggregate fields (Q7).
    const overrides: Overrides = hasValidChecks ? {
      purchases: String(totalPurchases),
      tenPct: derived10 > 0 ? String(derived10) : '',
      fivePct: derived5 > 0 ? String(derived5) : '',
    } : {}
    if (hasValidChecks) {
      setPurchases(overrides.purchases!)
      setTenPct(overrides.tenPct!)
      setFivePct(overrides.fivePct!)
    }
    try {
      await persist(true, overrides)
      if (otherBuyers.length > 0) {
        try {
          await fetch('/api/day-entry', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event_id: eventId, day_number: dayNumber, entered_by_name: buyerName, notify_buyers: otherBuyers.map(b => b.id) }),
          })
        } catch (e) { /* non-critical */ }
      }
      setSubmitted(true)
      onSaved()
      alert(`✅ Day ${dayNumber} submitted! ${otherBuyers.length > 0 ? 'Other buyers have been notified.' : ''}`)
      // Day 3 soft nudge — only shows once per (event, user).
      if (dayNumber === 3 && user?.id) {
        const flagKey = `beb_notes_nudge_${eventId}_${user.id}`
        const alreadyShown = typeof window !== 'undefined' && localStorage.getItem(flagKey) === '1'
        if (!alreadyShown) {
          try {
            const { data: existing } = await supabase.from('event_notes')
              .select('id').eq('event_id', eventId).eq('user_id', user.id).limit(1)
            if (!existing || existing.length === 0) setShowNotesNudge(true)
          } catch { /* non-blocking */ }
        }
      }
    } catch (err: any) {
      alert('Error: ' + err.message)
    }
    setSaving(false)
  }

  const dismissNudge = () => {
    if (user?.id) {
      try { localStorage.setItem(`beb_notes_nudge_${eventId}_${user.id}`, '1') } catch {}
    }
    setShowNotesNudge(false)
  }
  const nudgeEvent = events.find(e => e.id === eventId)
  const nudgeStore = nudgeEvent ? stores.find(s => s.id === nudgeEvent.store_id) : undefined

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {showNotesNudge && nudgeEvent && user && (
        <EventNotesNudge
          event={nudgeEvent}
          store={nudgeStore}
          userId={user.id}
          userName={user.name}
          onClose={dismissNudge}
          onSaved={dismissNudge}
        />
      )}
      {/* Buyer header */}
      <div className="card" style={{ background: isSubmitted ? 'var(--green-pale)' : 'var(--cream)', border: `2px solid ${isSubmitted ? 'var(--green)' : 'var(--pearl)'}` }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--mist)' }}>Entering data for</div>
            <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--ink)', marginTop: 2 }}>👤 {buyerName} — Day {dayNumber}</div>
          </div>
          {isSubmitted && <span className="badge badge-jade">✓ Submitted</span>}
        </div>
        {isSubmitted && (
          <div style={{ marginTop: 10, fontSize: 13, color: 'var(--green-dark)', fontWeight: 600 }}>
            This day has been submitted. You can still make edits and re-save.
          </div>
        )}
      </div>

      {/* Day totals — top aggregate fields, reporting source of truth.
          Populated by user or auto-filled from check totals on Submit (Q7). */}
      <div className="card card-accent" style={{ margin: 0 }}>
        <div className="card-title" style={{ display: 'flex', alignItems: 'center' }}>
          Day Totals
          <AutosaveIndicator status={autosaveStatus} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
          <div>
            <label className="fl">Customers Seen</label>
            <input type="number" min="0" value={customersSeeen}
              onChange={e => setCustomersSeen(e.target.value)}
              placeholder="0" />
          </div>
          <div>
            <label className="fl">Purchases Made</label>
            <input type="number" min="0" value={purchases}
              onChange={e => setPurchases(e.target.value)}
              placeholder="0" />
          </div>
          <div>
            <label className="fl">$ @ 10% Commission</label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--mist)' }}>$</span>
              <input type="number" min="0" step="0.01" value={tenPct}
                onChange={e => setTenPct(e.target.value)}
                placeholder="0" style={{ paddingLeft: 20 }} />
            </div>
          </div>
          <div>
            <label className="fl">$ @ 5% Commission</label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--mist)' }}>$</span>
              <input type="number" min="0" step="0.01" value={fivePct}
                onChange={e => setFivePct(e.target.value)}
                placeholder="0" style={{ paddingLeft: 20 }} />
            </div>
          </div>
        </div>
        {hasValidChecks && (
          <div style={{ marginTop: 12, padding: 10, background: 'var(--green-pale)', border: '1px solid var(--green3)', borderRadius: 'var(--r)', fontSize: 12, color: 'var(--green-dark)' }}>
            ℹ On Submit, the $ and Purchases fields above will be replaced with your check totals ({totalPurchases} checks · ${totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}).
          </div>
        )}
      </div>

      {/* Lead sources */}
      <div className="card card-accent" style={{ margin: 0 }}>
        <div className="card-title">Lead Sources</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
          {LEAD_SOURCES.map(s => (
            <div key={s.key}>
              <label className="fl">{s.label}</label>
              <input type="number" min="0" value={sources[s.key]}
                onChange={e => setSources(p => ({ ...p, [s.key]: e.target.value }))}
                placeholder="0" />
            </div>
          ))}
        </div>
      </div>

      {/* Check entry */}
      <div className="card card-accent" style={{ margin: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div className="card-title" style={{ margin: 0 }}>Checks & Payments</div>
            <div style={{ fontSize: 12, color: 'var(--mist)', marginTop: 2 }}>
              {totalPurchases} purchase{totalPurchases !== 1 ? 's' : ''} · ${totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} total
            </div>
          </div>
          {/* Grid / Card switcher */}
          <div style={{ display: 'flex', gap: 4, background: 'var(--cream2)', padding: 3, borderRadius: 'var(--r)', border: '1px solid var(--pearl)' }}>
            {(['grid', 'card'] as InputMode[]).map(m => (
              <button key={m} onClick={() => setInputMode(m)} style={{
                padding: '4px 12px', borderRadius: 'calc(var(--r) - 2px)', border: 'none', cursor: 'pointer',
                background: inputMode === m ? 'var(--sidebar-bg)' : 'transparent',
                color: inputMode === m ? '#fff' : 'var(--ash)', fontWeight: 700, fontSize: 12,
              }}>
                {m === 'grid' ? '⊞ Grid' : '☰ Cards'}
              </button>
            ))}
          </div>
        </div>

        {loadingChecks ? (
          <div style={{ color: 'var(--mist)', fontSize: 13 }}>Loading…</div>
        ) : inputMode === 'grid' ? (
          /* GRID MODE */
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--pearl)' }}>
                  {['#', 'Type', 'Check #', 'Buy Form #', 'Amount', '5%', ''].map(h => (
                    <th key={h} style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--mist)', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {checks.map((c, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--cream2)' }}>
                    <td style={{ padding: '4px 8px', color: 'var(--mist)', fontSize: 12, fontWeight: 700 }}>{i + 1}</td>
                    <td style={{ padding: '4px 8px' }}>
                      <select value={c.payment_type} onChange={e => updateCheck(i, 'payment_type', e.target.value)}
                        style={{ fontSize: 12, padding: '4px 6px', width: 80 }}>
                        <option value="check">Check</option>
                        <option value="cash">Cash</option>
                      </select>
                    </td>
                    <td style={{ padding: '4px 8px' }}>
                      <input type="text" value={c.check_number} onChange={e => updateCheck(i, 'check_number', e.target.value)}
                        placeholder="—" style={{ width: 90, fontSize: 13, padding: '4px 8px' }} />
                    </td>
                    <td style={{ padding: '4px 8px' }}>
                      <input type="text" value={c.buy_form_number} onChange={e => updateCheck(i, 'buy_form_number', e.target.value)}
                        placeholder="—" style={{ width: 90, fontSize: 13, padding: '4px 8px' }} />
                    </td>
                    <td style={{ padding: '4px 8px' }}>
                      <div style={{ position: 'relative', width: 110 }}>
                        <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--mist)', fontSize: 13 }}>$</span>
                        <input type="number" min="0" step="0.01" value={c.amount || ''} onChange={e => updateCheck(i, 'amount', e.target.value)}
                          placeholder="0.00" style={{ paddingLeft: 20, width: '100%', fontSize: 13, padding: '4px 8px 4px 20px' }} />
                      </div>
                    </td>
                    <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                      <input type="checkbox"
                        checked={c.commission_rate === 5}
                        onChange={e => updateCheck(i, 'commission_rate', e.target.checked ? 5 : 10)}
                        className="w-4 h-4 cursor-pointer"
                        style={{ accentColor: 'var(--green)' }}
                        aria-label="5% commission rate" />
                    </td>
                    <td style={{ padding: '4px 8px' }}>
                      <button onClick={() => removeCheck(i)} style={{ background: 'none', border: 'none', color: 'var(--mist)', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}>×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          /* CARD MODE */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {checks.map((c, i) => (
              <div key={i} style={{ background: 'var(--cream)', borderRadius: 'var(--r)', padding: '12px 14px', border: '1px solid var(--pearl)', display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div style={{ fontWeight: 900, fontSize: 13, color: 'var(--mist)', minWidth: 24, paddingBottom: 8 }}>#{i + 1}</div>
                <div>
                  <label className="fl">Type</label>
                  <select value={c.payment_type} onChange={e => updateCheck(i, 'payment_type', e.target.value)} style={{ width: 90 }}>
                    <option value="check">Check</option>
                    <option value="cash">Cash</option>
                  </select>
                </div>
                <div>
                  <label className="fl">Check #</label>
                  <input type="text" value={c.check_number} onChange={e => updateCheck(i, 'check_number', e.target.value)} placeholder="—" style={{ width: 100 }} />
                </div>
                <div>
                  <label className="fl">Buy Form #</label>
                  <input type="text" value={c.buy_form_number} onChange={e => updateCheck(i, 'buy_form_number', e.target.value)} placeholder="—" style={{ width: 100 }} />
                </div>
                <div>
                  <label className="fl">Amount</label>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--mist)' }}>$</span>
                    <input type="number" min="0" step="0.01" value={c.amount || ''} onChange={e => updateCheck(i, 'amount', e.target.value)}
                      placeholder="0.00" style={{ paddingLeft: 20, width: 110 }} />
                  </div>
                </div>
                <label style={{
                  display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                  padding: '6px 10px', borderRadius: 'var(--r)',
                  background: c.commission_rate === 5 ? 'var(--green-pale)' : 'transparent',
                  border: `1px solid ${c.commission_rate === 5 ? 'var(--green3)' : 'var(--pearl)'}`,
                  marginBottom: 2,
                }}>
                  <input type="checkbox"
                    checked={c.commission_rate === 5}
                    onChange={e => updateCheck(i, 'commission_rate', e.target.checked ? 5 : 10)}
                    className="w-4 h-4 cursor-pointer"
                    style={{ accentColor: 'var(--green)' }} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: c.commission_rate === 5 ? 'var(--green-dark)' : 'var(--mist)' }}>
                    5%
                  </span>
                </label>
                <button onClick={() => removeCheck(i)} style={{ background: 'none', border: 'none', color: 'var(--mist)', cursor: 'pointer', fontSize: 18, padding: '0 4px', marginBottom: 2 }}>×</button>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn-outline btn-sm" onClick={addRows}>+ Add 5 More Rows</button>
          {totalPurchases > 0 && (
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--green-dark)', marginLeft: 8 }}>
              {totalPurchases} purchases · ${totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              {derived5 > 0 && (
                <span style={{ fontWeight: 500, color: 'var(--mist)', marginLeft: 6 }}>
                  (${derived10.toLocaleString('en-US', { minimumFractionDigits: 0 })} @ 10% · ${derived5.toLocaleString('en-US', { minimumFractionDigits: 0 })} @ 5%)
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Submit */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <AutosaveIndicator status={autosaveStatus} />
        <button className="btn-primary" onClick={submit} disabled={saving} style={{ flex: 1 }}>
          {saving ? 'Submitting…' : isSubmitted ? '✓ Re-Submit Day ' + dayNumber : '✓ Submit Day ' + dayNumber}
        </button>
      </div>
    </div>
  )
}

/* ── COMBINED ENTRY FORM (superadmin only) ── */
function CombinedEntryForm({ event, dayNumber, onSaved }: {
  event: any; dayNumber: number; onSaved: () => void
}) {
  const { user } = useApp()
  const [existingRow, setExistingRow] = useState<any>(event.days?.find((d: any) => d.day_number === dayNumber) || null)
  const n = (v: string) => parseInt(v) || 0

  const [form, setForm] = useState({
    customers: String(existingRow?.customers || ''),
    purchases: String(existingRow?.purchases || ''),
    dollars10: String(existingRow?.dollars10 || ''),
    dollars5: String(existingRow?.dollars5 || ''),
    ...Object.fromEntries(LEAD_SOURCES.map(s => [s.key, String((existingRow as any)?.[s.key] || '')])),
  })

  const status = useAutosave(
    form,
    async (f) => {
      const payload = {
        event_id: event.id, day_number: dayNumber, day: dayNumber,
        customers: n(f.customers), purchases: n(f.purchases),
        dollars10: n(f.dollars10), dollars5: n(f.dollars5),
        ...Object.fromEntries(LEAD_SOURCES.map(s => [s.key, n((f as any)[s.key])])),
        entered_by: user?.id, entered_by_name: user?.name,
        entered_at: new Date().toISOString(),
      }
      if (existingRow) {
        const { error } = await supabase.from('event_days').update(payload).eq('id', existingRow.id)
        if (error) throw error
      } else {
        const { data, error } = await supabase.from('event_days').insert(payload).select().single()
        if (error) throw error
        if (data) setExistingRow(data)
      }
      onSaved()
    },
    { delay: 1000 }
  )

  const field = (label: string, key: string) => (
    <div key={key}>
      <label className="fl">{label}</label>
      <input type="number" min="0" value={(form as any)[key]}
        onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))} placeholder="0" />
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card card-accent" style={{ margin: 0, border: '2px solid var(--green)' }}>
        <div className="card-title" style={{ display: 'flex', alignItems: 'center' }}>
          Combined Day {dayNumber} Data
          <AutosaveIndicator status={status} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
          {field('Customers Seen', 'customers')}
          {field('Purchases Made', 'purchases')}
          {field('Commission @ 10%', 'dollars10')}
          {field('Commission @ 5%', 'dollars5')}
        </div>
        <div className="card-title">Lead Sources</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          {LEAD_SOURCES.map(s => field(s.label, s.key))}
        </div>
      </div>
    </div>
  )
}
