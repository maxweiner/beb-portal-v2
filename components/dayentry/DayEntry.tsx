'use client'

import { useState, useEffect, useRef } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import { useAutosave, AutosaveIndicator } from '@/lib/useAutosave'
import { canEditEvent } from '@/lib/permissions'
import EventNotesNudge from '@/components/events/EventNotesNudge'

/* ── Lead sources — day-level aggregates on event_days ── */
const LEAD_SOURCES = [
  { key: 'src_vdp',         label: 'VDP' },
  { key: 'src_postcard',    label: 'Postcard' },
  { key: 'src_social',      label: 'Social' },
  { key: 'src_wordofmouth', label: 'Word of Mouth' },
  { key: 'src_repeat',      label: 'Repeat' },
  { key: 'src_store',       label: 'Store' },
  { key: 'src_text',        label: 'Text' },
  { key: 'src_newspaper',   label: 'Newspaper' },
  { key: 'src_other',       label: 'Other' },
]

interface CheckRow {
  id?: string
  check_number: string
  buy_form_number: string
  amount: string
  payment_type: string
  commission_rate: number
}
const emptyCheck = (): CheckRow => ({
  check_number: '', buy_form_number: '', amount: '',
  payment_type: 'check', commission_rate: 10,
})
const nextCheckNumber = (rows: CheckRow[]): string => {
  const last = rows[rows.length - 1]?.check_number.trim() || ''
  if (!last) return ''
  const n = parseInt(last, 10)
  if (isNaN(n) || String(n) !== last) return ''
  return String(n + 1)
}
const MAX_CHECKS = 40

type InputMode = 'grid' | 'card'

export default function DayEntry() {
  const { events, users, user, stores, reload, dayEntryIntent, setDayEntryIntent } = useApp()
  const isSuperAdmin = user?.role === 'superadmin'
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin' || (user as any)?.role === 'non_buyer_admin'

  // Events this user can edit — admins see all; buyers only events where
  // they appear in the workers array.
  const myEvents = events.filter(ev => {
    if (isAdmin) return true
    return (ev.workers || []).some((w: any) => w.id === user?.id)
  }).sort((a, b) => b.start_date.localeCompare(a.start_date))

  const [selectedEventId, setSelectedEventId] = useState('')
  const [selectedDay, setSelectedDay] = useState(1)

  // Form state — matches event_days columns
  const [customers, setCustomers] = useState('')
  const [purchases, setPurchases] = useState('')
  const [dollars10, setDollars10] = useState('')
  const [dollars5, setDollars5]  = useState('')
  const [sources, setSources] = useState<Record<string, string>>(
    Object.fromEntries(LEAD_SOURCES.map(s => [s.key, '']))
  )
  const [checks, setChecks] = useState<CheckRow[]>([emptyCheck()])
  const [inputMode, setInputMode] = useState<InputMode>('grid')
  const [existingRow, setExistingRow] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const rowIdRef = useRef<string | null>(null)
  const hydratedRef = useRef(false)
  const persistInFlightRef = useRef(false)

  // Nudge state (Day 3 soft prompt for event notes)
  const [showNotesNudge, setShowNotesNudge] = useState(false)

  // Superadmin "+ Create past event" flow
  const [creatingPastEvent, setCreatingPastEvent] = useState(false)
  const [pastStoreId, setPastStoreId] = useState('')
  const [pastStartDate, setPastStartDate] = useState('')
  const [creatingSaving, setCreatingSaving] = useState(false)

  /* ── Consume deep-link intent from Events pill tap ── */
  useEffect(() => {
    if (!dayEntryIntent) return
    setSelectedEventId(dayEntryIntent.eventId)
    setSelectedDay(dayEntryIntent.day)
    setDayEntryIntent(null)
  }, [dayEntryIntent])

  /* ── Load existing data whenever event+day changes ── */
  useEffect(() => {
    if (!selectedEventId) return
    loadExisting()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEventId, selectedDay])

  const loadExisting = async () => {
    setLoading(true)
    hydratedRef.current = false
    const [{ data: rowData }, { data: checkRows }] = await Promise.all([
      supabase.from('event_days').select('*')
        .eq('event_id', selectedEventId).eq('day_number', selectedDay).maybeSingle(),
      supabase.from('buyer_checks').select('*')
        .eq('event_id', selectedEventId).eq('day_number', selectedDay)
        .is('entry_id', null)
        .order('created_at'),
    ])
    if (rowData) {
      setExistingRow(rowData)
      rowIdRef.current = rowData.id
      setCustomers(String(rowData.customers ?? ''))
      setPurchases(String(rowData.purchases ?? ''))
      setDollars10(rowData.dollars10 != null ? String(rowData.dollars10) : '')
      setDollars5(rowData.dollars5 != null ? String(rowData.dollars5) : '')
      setSources(Object.fromEntries(LEAD_SOURCES.map(s => [s.key, String((rowData as any)[s.key] ?? '')])))
    } else {
      setExistingRow(null)
      rowIdRef.current = null
      setCustomers(''); setPurchases(''); setDollars10(''); setDollars5('')
      setSources(Object.fromEntries(LEAD_SOURCES.map(s => [s.key, ''])))
    }
    setChecks(checkRows && checkRows.length > 0
      ? checkRows.map((c: any) => ({
          id: c.id,
          check_number: c.check_number || '',
          buy_form_number: c.buy_form_number || '',
          amount: c.amount != null ? String(c.amount) : '',
          payment_type: c.payment_type || 'check',
          commission_rate: c.commission_rate === 5 ? 5 : 10,
        }))
      : [emptyCheck()])
    setLoading(false)
    setTimeout(() => { hydratedRef.current = true }, 0)
  }

  /* ── Derived ── */
  const nF = (s: string) => parseFloat(s) || 0
  const validChecks = checks.filter(c => c.amount && parseFloat(c.amount) > 0)
  const checksTotal = validChecks.reduce((s, c) => s + parseFloat(c.amount || '0'), 0)
  const derivedPurchases = validChecks.length
  const derived10 = validChecks.filter(c => c.commission_rate === 10).reduce((s, c) => s + parseFloat(c.amount), 0)
  const derived5  = validChecks.filter(c => c.commission_rate === 5 ).reduce((s, c) => s + parseFloat(c.amount), 0)
  const hasValidChecks = validChecks.length > 0

  const totalSpend = nF(dollars10) + nF(dollars5)
  const closeRate = nF(customers) > 0 ? Math.round((nF(purchases) / nF(customers)) * 100) : 0
  const commission = nF(dollars10) * 0.1 + nF(dollars5) * 0.05

  /* ── Persist ── */
  type Overrides = Partial<{ purchases: string; dollars10: string; dollars5: string }>
  const persist = async (overrides: Overrides = {}) => {
    if (persistInFlightRef.current) return
    if (!selectedEventId || !user?.id) return
    const ev = events.find(e => e.id === selectedEventId)
    if (!canEditEvent(user, ev as any)) {
      alert("You're not assigned to this event — save blocked.")
      return
    }
    persistInFlightRef.current = true
    try {
      const effPurch = overrides.purchases ?? purchases
      const eff10    = overrides.dollars10 ?? dollars10
      const eff5     = overrides.dollars5  ?? dollars5
      const payload: any = {
        event_id: selectedEventId,
        day_number: selectedDay,
        day: selectedDay,
        customers: parseInt(customers) || 0,
        purchases: parseInt(effPurch) || 0,
        dollars10: eff10 !== '' ? parseFloat(eff10) || 0 : 0,
        dollars5:  eff5  !== '' ? parseFloat(eff5)  || 0 : 0,
        ...Object.fromEntries(LEAD_SOURCES.map(s => [s.key, parseInt(sources[s.key]) || 0])),
        entered_by: user.id,
        entered_by_name: user.name,
        entered_at: new Date().toISOString(),
      }

      // Fresh-existing check — belt-and-braces against races.
      let rowId = rowIdRef.current
      if (!rowId) {
        const { data: existing } = await supabase.from('event_days').select('id')
          .eq('event_id', selectedEventId).eq('day_number', selectedDay)
          .limit(1)
        if (existing && existing.length > 0) {
          rowId = existing[0].id
          rowIdRef.current = rowId
        }
      }

      if (rowId) {
        const { error } = await supabase.from('event_days').update(payload).eq('id', rowId)
        if (error) throw error
      } else {
        const { data, error } = await supabase.from('event_days').insert(payload).select().single()
        if (error) throw error
        rowId = data?.id || null
        rowIdRef.current = rowId
      }
      if (!rowId) throw new Error('Failed to save day')

      // Day-level checks: delete all old day-level rows then insert fresh.
      const { error: delErr } = await supabase.from('buyer_checks').delete()
        .eq('event_id', selectedEventId).eq('day_number', selectedDay).is('entry_id', null)
      if (delErr) throw delErr
      if (validChecks.length > 0) {
        const { error } = await supabase.from('buyer_checks').insert(
          validChecks.map(c => ({
            entry_id: null,
            event_id: selectedEventId,
            day_number: selectedDay,
            check_number: c.check_number,
            buy_form_number: c.buy_form_number,
            amount: parseFloat(c.amount) || 0,
            payment_type: c.payment_type,
            commission_rate: c.commission_rate === 5 ? 5 : 10,
          }))
        )
        if (error) throw error
      }
    } finally {
      persistInFlightRef.current = false
    }
  }

  const autosaveStatus = useAutosave(
    { customers, purchases, dollars10, dollars5, sources, checks },
    async () => { await persist() },
    { enabled: hydratedRef.current && !!selectedEventId && !saving, delay: 1000 },
  )

  const submit = async () => {
    if (saving) return
    if (!selectedEventId) return
    // On Submit, check totals OVERWRITE the top aggregate fields when
    // checks exist (same pattern as the old mobile Quick mode).
    const overrides: Overrides = hasValidChecks ? {
      purchases: String(derivedPurchases),
      dollars10: derived10 > 0 ? String(derived10) : '',
      dollars5:  derived5  > 0 ? String(derived5)  : '',
    } : {}
    if (hasValidChecks) {
      setPurchases(overrides.purchases!)
      setDollars10(overrides.dollars10!)
      setDollars5(overrides.dollars5!)
    }
    setSaving(true)
    try {
      await persist(overrides)
      await loadExisting()
      // Day 3 nudge — only shows once per (event, user).
      if (selectedDay === 3 && user?.id) {
        const flagKey = `beb_notes_nudge_${selectedEventId}_${user.id}`
        const alreadyShown = typeof window !== 'undefined' && localStorage.getItem(flagKey) === '1'
        if (!alreadyShown) {
          try {
            const { data: existing } = await supabase.from('event_notes').select('id')
              .eq('event_id', selectedEventId).eq('user_id', user.id).limit(1)
            if (!existing || existing.length === 0) setShowNotesNudge(true)
          } catch { /* non-blocking */ }
        }
      }
      // Fire notifications (existing pattern — API reads event_days).
      try {
        await fetch('/api/day-entry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event_id: selectedEventId, day_number: selectedDay, entered_by_name: user?.name }),
        })
      } catch { /* non-critical */ }
      alert(`✅ Day ${selectedDay} saved!`)
    } catch (err: any) {
      alert('Error: ' + (err?.message || 'unknown'))
    }
    setSaving(false)
  }

  const dismissNudge = () => {
    if (user?.id) {
      try { localStorage.setItem(`beb_notes_nudge_${selectedEventId}_${user.id}`, '1') } catch {}
    }
    setShowNotesNudge(false)
  }

  /* ── Superadmin "+ Create past event" ── */
  const createOrFindPastEvent = async () => {
    if (!pastStoreId || !pastStartDate) return
    setCreatingSaving(true)
    try {
      const { data: existing } = await supabase.from('events').select('id')
        .eq('store_id', pastStoreId).eq('start_date', pastStartDate).maybeSingle()
      let eventId: string | null = existing?.id ?? null
      if (!eventId) {
        const store = stores.find(s => s.id === pastStoreId)
        const { data: newEv, error } = await supabase.from('events')
          .insert({ store_id: pastStoreId, store_name: store?.name || '', start_date: pastStartDate, created_by: user?.id })
          .select('id').single()
        if (error) { alert(error.message); setCreatingSaving(false); return }
        eventId = newEv.id
      }
      await reload()
      if (eventId) setSelectedEventId(eventId)
      setSelectedDay(1)
      setCreatingPastEvent(false)
      setPastStoreId(''); setPastStartDate('')
    } finally {
      setCreatingSaving(false)
    }
  }

  /* ── Check-grid helpers ── */
  const updateCheck = (i: number, field: keyof CheckRow, value: string | number) => {
    setChecks(p => p.map((c, idx) => idx === i ? { ...c, [field]: value } : c))
  }
  const addCheck = () => setChecks(p => p.length >= MAX_CHECKS ? p : [...p, { ...emptyCheck(), check_number: nextCheckNumber(p) }])
  const addRows = () => setChecks(p => {
    if (p.length >= MAX_CHECKS) return p
    const next = [...p]
    const slots = Math.min(5, MAX_CHECKS - next.length)
    for (let i = 0; i < slots; i++) {
      next.push({ ...emptyCheck(), check_number: nextCheckNumber(next) })
    }
    return next
  })
  const removeCheck = (i: number) => setChecks(p => p.filter((_, idx) => idx !== i))

  /* ── Render ── */
  const selectedEvent = myEvents.find(e => e.id === selectedEventId)
  const selectedStore = selectedEvent ? stores.find(s => s.id === selectedEvent.store_id) : undefined
  const fmt = (ds: string) => new Date(ds + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const fmtTime = (ts: string) => new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {showNotesNudge && selectedEvent && user && (
        <EventNotesNudge event={selectedEvent as any} store={selectedStore as any}
          userId={user.id} userName={user.name}
          onClose={dismissNudge} onSaved={dismissNudge} />
      )}

      <div className="mb-6">
        <h1 className="text-2xl font-black" style={{ color: 'var(--ink)' }}>Enter Day Data</h1>
        <div style={{ fontSize: 13, color: 'var(--mist)', marginTop: 4 }}>
          Enter today's sales for the event you're working. Changes autosave.
        </div>
      </div>

      {/* Event + Day selector */}
      <div className="card mb-5">
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: 2, minWidth: 200 }}>
            <label className="fl">Event</label>
            <select value={selectedEventId}
              onChange={e => { setSelectedEventId(e.target.value); setSelectedDay(1) }}>
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
          </div>
        )}
      </div>

      {/* Empty states */}
      {myEvents.length === 0 && (
        <div className="card text-center" style={{ padding: 40, color: 'var(--mist)' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>
            You're not assigned to any events
          </div>
          <div style={{ fontSize: 13, marginTop: 6 }}>Contact your admin to get added to an event.</div>
        </div>
      )}

      {!selectedEventId && myEvents.length > 0 && (
        <div className="card text-center" style={{ padding: 40, color: 'var(--mist)' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📝</div>
          <div className="font-bold" style={{ color: 'var(--ink)' }}>Select an event above</div>
        </div>
      )}

      {selectedEventId && (
        <>
          {/* Info line: store + last updated */}
          <div className="card mb-4" style={{ background: 'var(--cream2)', padding: '12px 14px' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'baseline', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 900, color: 'var(--ink)' }}>
                  {selectedEvent?.store_name} — Day {selectedDay}
                </div>
                <div style={{ fontSize: 12, color: 'var(--mist)' }}>
                  {selectedStore?.city}{selectedStore?.state ? ', ' + selectedStore.state : ''} · {selectedEvent && fmt(selectedEvent.start_date)}
                </div>
              </div>
              {existingRow?.entered_by_name && existingRow?.entered_at && (
                <div style={{ fontSize: 12, color: 'var(--mist)' }}>
                  Last edit: <b>{existingRow.entered_by_name}</b> · {fmtTime(existingRow.entered_at)}
                </div>
              )}
            </div>
          </div>

          {loading ? (
            <div className="card text-center" style={{ padding: 30, color: 'var(--mist)' }}>Loading Day {selectedDay}…</div>
          ) : (
            <>
              {/* Sales numbers */}
              <div className="card card-accent mb-4" style={{ margin: 0, border: '2px solid var(--green)' }}>
                <div className="card-title" style={{ display: 'flex', alignItems: 'center' }}>
                  Day Totals
                  <AutosaveIndicator status={autosaveStatus} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
                  <div>
                    <label className="fl">Purchases Made</label>
                    <input type="number" min="0" value={purchases}
                      onChange={e => setPurchases(e.target.value)} placeholder="0" />
                  </div>
                  <div>
                    <label className="fl">Customers Seen</label>
                    <input type="number" min="0" value={customers}
                      onChange={e => setCustomers(e.target.value)} placeholder="0" />
                  </div>
                  <div>
                    <label className="fl">$ @ 10% Commission</label>
                    <div style={{ position: 'relative' }}>
                      <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--mist)' }}>$</span>
                      <input type="number" min="0" step="0.01" value={dollars10}
                        onChange={e => setDollars10(e.target.value)} placeholder="0" style={{ paddingLeft: 20 }} />
                    </div>
                  </div>
                  <div>
                    <label className="fl">$ @ 5% Commission</label>
                    <div style={{ position: 'relative' }}>
                      <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--mist)' }}>$</span>
                      <input type="number" min="0" step="0.01" value={dollars5}
                        onChange={e => setDollars5(e.target.value)} placeholder="0" style={{ paddingLeft: 20 }} />
                    </div>
                  </div>
                </div>
                {hasValidChecks && (
                  <div style={{ marginTop: 12, padding: 10, background: 'var(--green-pale)', border: '1px solid var(--green3)', borderRadius: 'var(--r)', fontSize: 12, color: 'var(--green-dark)' }}>
                    ℹ On Submit, the $ and Purchases fields will be replaced with your check totals ({derivedPurchases} checks · ${checksTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}).
                  </div>
                )}
              </div>

              {/* Live calcs */}
              {(nF(customers) + nF(purchases) + totalSpend > 0) && (
                <div className="card mb-4" style={{ background: 'var(--green-pale)', border: '1px solid var(--green3)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                    <Stat label="Total Spend" value={`$${totalSpend.toLocaleString()}`} />
                    <Stat label="Close Rate" value={`${closeRate}%`} />
                    <Stat label="Commission (est)" value={`$${commission.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} />
                  </div>
                </div>
              )}

              {/* Lead sources */}
              <div className="card card-accent mb-4" style={{ margin: 0 }}>
                <div className="card-title">Lead Sources</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
                  {LEAD_SOURCES.map(s => (
                    <div key={s.key}>
                      <label className="fl">{s.label}</label>
                      <input type="number" min="0" value={sources[s.key]}
                        onChange={e => setSources(p => ({ ...p, [s.key]: e.target.value }))} placeholder="0" />
                    </div>
                  ))}
                </div>
              </div>

              {/* Checks */}
              <div className="card card-accent mb-4" style={{ margin: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
                  <div>
                    <div className="card-title" style={{ margin: 0 }}>Checks & Payments</div>
                    <div style={{ fontSize: 12, color: 'var(--mist)', marginTop: 2 }}>
                      {derivedPurchases} purchase{derivedPurchases !== 1 ? 's' : ''} · ${checksTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} total
                      {derived5 > 0 && (
                        <span style={{ marginLeft: 8 }}>
                          (${derived10.toLocaleString('en-US', { minimumFractionDigits: 0 })} @ 10% · ${derived5.toLocaleString('en-US', { minimumFractionDigits: 0 })} @ 5%)
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 4, background: 'var(--cream2)', padding: 3, borderRadius: 'var(--r)', border: '1px solid var(--pearl)' }}>
                    {(['grid', 'card'] as InputMode[]).map(m => (
                      <button key={m} onClick={() => setInputMode(m)} style={{
                        padding: '4px 12px', borderRadius: 'calc(var(--r) - 2px)', border: 'none', cursor: 'pointer',
                        background: inputMode === m ? 'var(--gradient-primary)' : 'transparent',
                        color: inputMode === m ? '#fff' : 'var(--ash)', fontWeight: 700, fontSize: 12,
                      }}>
                        {m === 'grid' ? '⊞ Grid' : '☰ Cards'}
                      </button>
                    ))}
                  </div>
                </div>

                {inputMode === 'grid' ? (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr style={{ borderBottom: '2px solid var(--pearl)' }}>
                          {['#', 'Type', 'Check #', 'Amount', 'Buy Form #', '5%', ''].map(h => (
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
                              <div style={{ position: 'relative', width: 110 }}>
                                <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--mist)', fontSize: 13 }}>$</span>
                                <input type="number" min="0" step="0.01" value={c.amount || ''} onChange={e => updateCheck(i, 'amount', e.target.value)}
                                  placeholder="0.00" style={{ paddingLeft: 20, width: '100%', fontSize: 13, padding: '4px 8px 4px 20px' }} />
                              </div>
                            </td>
                            <td style={{ padding: '4px 8px' }}>
                              <input type="text" value={c.buy_form_number} onChange={e => updateCheck(i, 'buy_form_number', e.target.value)}
                                placeholder="—" style={{ width: 90, fontSize: 13, padding: '4px 8px' }} />
                            </td>
                            <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                              <input type="checkbox" checked={c.commission_rate === 5}
                                onChange={e => updateCheck(i, 'commission_rate', e.target.checked ? 5 : 10)}
                                className="w-4 h-4 cursor-pointer" style={{ accentColor: 'var(--green)' }} aria-label="5% commission rate" />
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
                          <label className="fl">Amount</label>
                          <div style={{ position: 'relative' }}>
                            <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--mist)' }}>$</span>
                            <input type="number" min="0" step="0.01" value={c.amount || ''} onChange={e => updateCheck(i, 'amount', e.target.value)}
                              placeholder="0.00" style={{ paddingLeft: 20, width: 110 }} />
                          </div>
                        </div>
                        <div>
                          <label className="fl">Buy Form #</label>
                          <input type="text" value={c.buy_form_number} onChange={e => updateCheck(i, 'buy_form_number', e.target.value)} placeholder="—" style={{ width: 100 }} />
                        </div>
                        <label style={{
                          display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                          padding: '6px 10px', borderRadius: 'var(--r)',
                          background: c.commission_rate === 5 ? 'var(--green-pale)' : 'transparent',
                          border: `1px solid ${c.commission_rate === 5 ? 'var(--green3)' : 'var(--pearl)'}`, marginBottom: 2,
                        }}>
                          <input type="checkbox" checked={c.commission_rate === 5}
                            onChange={e => updateCheck(i, 'commission_rate', e.target.checked ? 5 : 10)}
                            className="w-4 h-4 cursor-pointer" style={{ accentColor: 'var(--green)' }} />
                          <span style={{ fontSize: 12, fontWeight: 700, color: c.commission_rate === 5 ? 'var(--green-dark)' : 'var(--mist)' }}>5%</span>
                        </label>
                        <button onClick={() => removeCheck(i)} style={{ background: 'none', border: 'none', color: 'var(--mist)', cursor: 'pointer', fontSize: 18, padding: '0 4px', marginBottom: 2 }}>×</button>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button className="btn-outline btn-sm" onClick={addRows} disabled={checks.length >= MAX_CHECKS}>
                    + Add 5 More Rows
                  </button>
                  <button className="btn-outline btn-sm" onClick={addCheck} disabled={checks.length >= MAX_CHECKS}>
                    + Add One
                  </button>
                  {checks.length >= MAX_CHECKS && (
                    <span style={{ fontSize: 12, color: 'var(--mist)' }}>Max {MAX_CHECKS} rows</span>
                  )}
                </div>
              </div>

              {/* Submit */}
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <AutosaveIndicator status={autosaveStatus} />
                <button className="btn-primary" onClick={submit} disabled={saving} style={{ flex: 1 }}>
                  {saving ? 'Submitting…' : existingRow ? `✓ Re-Submit Day ${selectedDay}` : `✓ Submit Day ${selectedDay}`}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--green-dark)' }}>{value}</div>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--green-dark)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</div>
    </div>
  )
}
