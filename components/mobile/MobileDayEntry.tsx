'use client'

import { useState, useEffect, useRef } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import { useAutosave, AutosaveIndicator } from '@/lib/useAutosave'
import { rollupEventDay } from '@/lib/dayRollup'

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

interface CheckRow {
  id?: string
  check_number: string
  buy_form_number: string
  amount: string
  payment_type: string
  commission_rate: number // 10 (default) or 5
}
function emptyCheck(): CheckRow {
  return { check_number: '', buy_form_number: '', amount: '', payment_type: 'check', commission_rate: 10 }
}
// When the user taps "+ Add Check" we pre-fill the next sequential number.
// Only auto-fills when the last row's number is a clean integer — otherwise
// blank so the user can correct without surprise.
function nextCheckNumber(checks: CheckRow[]): string {
  const last = checks[checks.length - 1]?.check_number.trim() || ''
  if (!last) return ''
  const n = parseInt(last, 10)
  if (isNaN(n) || String(n) !== last) return ''
  return String(n + 1)
}

// Display "1234.50" as "1,234.50" while the user types. State stores the
// un-formatted numeric string so downstream parseFloat() calls still work.
function formatMoneyInput(raw: string): string {
  if (!raw || raw === '.') return raw
  if (raw.includes('.')) {
    const [intPart, decPart = ''] = raw.split('.')
    const n = parseInt(intPart || '0', 10)
    const intStr = isNaN(n) ? '0' : n.toLocaleString('en-US')
    return `${intStr}.${decPart}`
  }
  const n = parseInt(raw, 10)
  return isNaN(n) ? raw : n.toLocaleString('en-US')
}
// Strip commas and anything that isn't a digit or the first decimal point.
function parseMoneyInput(input: string): string {
  const cleaned = input.replace(/[^\d.]/g, '')
  const parts = cleaned.split('.')
  if (parts.length <= 2) return cleaned
  return parts[0] + '.' + parts.slice(1).join('')
}

export default function MobileDayEntry() {
  const { events, user, dayEntryIntent, setDayEntryIntent } = useApp()
  const [selectedEventId, setSelectedEventId] = useState('')
  const [selectedDay, setSelectedDay] = useState(1)
  const [eventSwitcherOpen, setEventSwitcherOpen] = useState(false)
  const [mode, setMode] = useState<'quick' | 'detailed'>('quick')
  const [customers, setCustomers] = useState('')
  const [purchases, setPurchases] = useState('')
  const [tenPct, setTenPct] = useState('')
  const [fivePct, setFivePct] = useState('')
  const [sources, setSources] = useState<Record<string, string>>(
    Object.fromEntries(LEAD_SOURCES.map(s => [s.key, '']))
  )
  const [checks, setChecks] = useState<CheckRow[]>([emptyCheck()])
  const [daysStatus, setDaysStatus] = useState<Record<number, 'submitted' | 'draft' | null>>({ 1: null, 2: null, 3: null })
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loadingEntry, setLoadingEntry] = useState(false)
  const [showOverlay, setShowOverlay] = useState(false)
  const [showPastEvents, setShowPastEvents] = useState(false)
  const [existingEntry, setExistingEntry] = useState<any>(null)
  const entryIdRef = useRef<string | null>(null)
  const hydratedRef = useRef(false)
  // Mutex so overlapping autosave + manual-submit calls don't both INSERT
  // before the first one's id has been written back into entryIdRef.
  const persistInFlightRef = useRef(false)

  useEffect(() => {
    const saved = localStorage.getItem('dayentry-mode')
    if (saved === 'quick' || saved === 'detailed') setMode(saved)
  }, [])
  useEffect(() => { localStorage.setItem('dayentry-mode', mode) }, [mode])

  // When a deep-link intent lands (Events pill tap), the event+day we set
  // here must win — otherwise the "auto-pick today" effect below would
  // immediately overwrite the day on the next render.
  const skipAutoDayPickRef = useRef(false)

  // Consume a deep-link intent (e.g. tapped from an Events day pill) once.
  useEffect(() => {
    if (!dayEntryIntent) return
    skipAutoDayPickRef.current = true
    setSelectedEventId(dayEntryIntent.eventId)
    setSelectedDay(dayEntryIntent.day)
    setDayEntryIntent(null)
  }, [dayEntryIntent])

  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin'

  // Admins see every event in the system (they usually aren't on worker lists).
  // Buyers see only events they're assigned to.
  const availableEvents = (isAdmin
    ? events
    : events.filter(ev => (ev.workers || []).some((w: any) => w.id === user?.id))
  ).slice().sort((a, b) => b.start_date.localeCompare(a.start_date))

  const selectedEvent = availableEvents.find(e => e.id === selectedEventId)

  const isActive = (ev: any, today: Date) => {
    const start = new Date(ev.start_date + 'T12:00:00')
    const end = new Date(ev.start_date + 'T12:00:00'); end.setDate(end.getDate() + 2)
    return today >= start && today <= end
  }
  const isFuture = (ev: any, today: Date) => {
    const start = new Date(ev.start_date + 'T12:00:00')
    return today < start
  }

  // Default = active event, then next upcoming, else no selection (empty state
  // offers "View past events"). Admins use the full event list, buyers use
  // only their assigned ones.
  useEffect(() => {
    if (selectedEventId || availableEvents.length === 0) return
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const active = availableEvents.find(ev => isActive(ev, today))
    if (active) { setSelectedEventId(active.id); return }
    // Events are sorted newest-first; reverse to find the SOONEST upcoming.
    const upcoming = availableEvents.slice().reverse().find(ev => isFuture(ev, today))
    if (upcoming) { setSelectedEventId(upcoming.id); return }
    // All events are in the past — leave unselected to trigger empty state.
  }, [availableEvents.length, selectedEventId])

  // Auto-pick today's day within the event, else day 1.
  useEffect(() => {
    if (!selectedEvent) return
    if (skipAutoDayPickRef.current) { skipAutoDayPickRef.current = false; return }
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const start = new Date(selectedEvent.start_date + 'T12:00:00')
    const diff = Math.round((today.getTime() - start.getTime()) / 86400000)
    if (diff >= 0 && diff <= 2) setSelectedDay(diff + 1)
    else setSelectedDay(1)
  }, [selectedEventId])

  useEffect(() => {
    if (selectedEventId) loadEntries()
  }, [selectedEventId, selectedDay])

  const loadEntries = async () => {
    hydratedRef.current = false
    setLoadingEntry(true)
    const { data: rows } = await supabase.from('buyer_entries')
      .select('*')
      .eq('event_id', selectedEventId)
      .eq('buyer_id', user?.id)
      .in('day_number', [1, 2, 3])
    const byDay: Record<number, any> = {}
    ;(rows || []).forEach((r: any) => { byDay[r.day_number] = r })
    setDaysStatus({
      1: byDay[1]?.submitted_at ? 'submitted' : (byDay[1] ? 'draft' : null),
      2: byDay[2]?.submitted_at ? 'submitted' : (byDay[2] ? 'draft' : null),
      3: byDay[3]?.submitted_at ? 'submitted' : (byDay[3] ? 'draft' : null),
    })
    const current = byDay[selectedDay]
    if (current) {
      setExistingEntry(current)
      entryIdRef.current = current.id
      setCustomers(String(current.customers_seen || ''))
      setPurchases(current.purchases_made != null ? String(current.purchases_made) : '')
      setTenPct(current.dollars_at_10pct != null ? String(current.dollars_at_10pct) : '')
      setFivePct(current.dollars_at_5pct != null ? String(current.dollars_at_5pct) : '')
      setSources(Object.fromEntries(LEAD_SOURCES.map(s => [s.key, String((current as any)[s.key] || '')])))
      setSubmitted(!!current.submitted_at)
      const { data: chks } = await supabase.from('buyer_checks')
        .select('*').eq('entry_id', current.id).order('created_at')
      const loadedChecks: CheckRow[] = chks && chks.length > 0 ? chks.map((c: any) => ({
        id: c.id,
        check_number: c.check_number || '',
        buy_form_number: c.buy_form_number || '',
        amount: c.amount != null ? String(c.amount) : '',
        payment_type: c.payment_type || 'check',
        commission_rate: c.commission_rate === 5 ? 5 : 10,
      })) : [emptyCheck()]
      setChecks(loadedChecks)
    } else {
      setExistingEntry(null)
      entryIdRef.current = null
      setCustomers(''); setPurchases(''); setTenPct(''); setFivePct('')
      setSources(Object.fromEntries(LEAD_SOURCES.map(s => [s.key, ''])))
      setChecks([emptyCheck()])
      setSubmitted(false)
    }
    setLoadingEntry(false)
    setTimeout(() => { hydratedRef.current = true }, 0)
  }

  const nF = (s: string) => parseFloat(s) || 0
  const totalSpend = nF(tenPct) + nF(fivePct)
  const closeRate = nF(customers) > 0 ? Math.round((nF(purchases) / nF(customers)) * 100) : 0
  const commission = nF(tenPct) * 0.1 + nF(fivePct) * 0.05
  const touched = nF(customers) + nF(purchases) + totalSpend > 0

  const validChecks = checks.filter(c => c.amount && parseFloat(c.amount) > 0)
  const checksTotal = validChecks.reduce((s, c) => s + parseFloat(c.amount || '0'), 0)
  const derivedPurchases = validChecks.length
  const derived10 = validChecks.filter(c => c.commission_rate === 10).reduce((s, c) => s + parseFloat(c.amount), 0)
  const derived5  = validChecks.filter(c => c.commission_rate === 5 ).reduce((s, c) => s + parseFloat(c.amount), 0)
  const hasValidChecks = validChecks.length > 0

  // Top aggregate fields (purchases / $ @ 10% / $ @ 5%) stay raw-editable.
  // On Submit, check totals OVERWRITE these fields (Q7). To avoid stale
  // state on the same tick, persist() takes an `overrides` arg.
  type Overrides = Partial<{ purchases: string; tenPct: string; fivePct: string }>
  const persist = async (submit: boolean, overrides: Overrides = {}) => {
    // Drop concurrent persist calls — autosave + rapid Submit taps would
    // otherwise both read entryIdRef.current === null and both INSERT,
    // producing duplicate buyer_entries for the same (event, day, buyer).
    if (persistInFlightRef.current) return
    persistInFlightRef.current = true
    try {
      const effPurchases = overrides.purchases ?? purchases
      const effTenPct    = overrides.tenPct    ?? tenPct
      const effFivePct   = overrides.fivePct   ?? fivePct
      const payload: any = {
        event_id: selectedEventId,
        day_number: selectedDay,
        day: selectedDay,
        buyer_id: user?.id,
        buyer_name: user?.name,
        customers_seen: parseInt(customers) || 0,
        purchases_made: effPurchases !== '' ? parseInt(effPurchases) || 0 : null,
        dollars_at_10pct: effTenPct !== '' ? parseFloat(effTenPct) : null,
        dollars_at_5pct: effFivePct !== '' ? parseFloat(effFivePct) : null,
        ...Object.fromEntries(LEAD_SOURCES.map(s => [s.key, parseInt(sources[s.key]) || 0])),
        submitted_at: submit ? new Date().toISOString() : existingEntry?.submitted_at || null,
      }

      // Fresh-existing check — DB is the source of truth. Guards against
      // a stale null ref racing with a prior INSERT from another tab, or
      // pre-existing legacy duplicates in the table.
      let entryId = entryIdRef.current
      if (!entryId && selectedEventId && user?.id) {
        const { data: existingRows } = await supabase.from('buyer_entries')
          .select('id')
          .eq('event_id', selectedEventId)
          .eq('day_number', selectedDay)
          .eq('buyer_id', user.id)
          .limit(1)
        if (existingRows && existingRows.length > 0) {
          entryId = existingRows[0].id
          entryIdRef.current = entryId
        }
      }

      if (entryId) {
        const { error } = await supabase.from('buyer_entries').update(payload).eq('id', entryId)
        if (error) throw error
      } else {
        const { data, error } = await supabase.from('buyer_entries').insert(payload).select().single()
        if (error) throw error
        entryId = data?.id || null
        entryIdRef.current = entryId
      }
      if (!entryId) throw new Error('Failed to save entry')

      const { error: delErr } = await supabase.from('buyer_checks').delete().eq('entry_id', entryId)
      if (delErr) throw delErr
      if (validChecks.length > 0) {
        const { error } = await supabase.from('buyer_checks').insert(validChecks.map(c => ({
          entry_id: entryId!, event_id: selectedEventId,
          check_number: c.check_number, buy_form_number: c.buy_form_number,
          amount: parseFloat(c.amount) || 0, payment_type: c.payment_type,
          commission_rate: c.commission_rate === 5 ? 5 : 10,
        })))
        if (error) throw error
      }

      // Roll the per-buyer totals up into event_days so downstream readers
      // (Dashboard, Events pill fallback, Reports) stay consistent.
      await rollupEventDay(selectedEventId, selectedDay)
    } finally {
      persistInFlightRef.current = false
    }
  }

  const autosaveStatus = useAutosave(
    { customers, purchases, tenPct, fivePct, sources, checks },
    async () => { await persist(false) },
    { enabled: !!selectedEventId && hydratedRef.current && !saving, delay: 1000 }
  )

  const handleSubmit = async () => {
    if (saving) return              // guard against rapid double-taps
    if (!selectedEventId) return
    // On Submit, check totals overwrite the top aggregate fields (Q7).
    const overrides = hasValidChecks ? {
      purchases: String(derivedPurchases),
      tenPct: derived10 > 0 ? String(derived10) : '',
      fivePct: derived5 > 0 ? String(derived5) : '',
    } : {}
    if (hasValidChecks) {
      setPurchases(overrides.purchases!)
      setTenPct(overrides.tenPct!)
      setFivePct(overrides.fivePct!)
    }
    setSaving(true)
    try {
      await persist(true, overrides)
      // Re-load from DB so state (existingEntry, entryIdRef, check ids)
      // matches what just got written. Keeps subsequent saves on the
      // UPDATE path instead of racing into another INSERT.
      await loadEntries()
      setSubmitted(true)
      setDaysStatus(prev => ({ ...prev, [selectedDay]: 'submitted' }))
      setShowOverlay(true)
      setTimeout(() => setShowOverlay(false), 2200)
    } catch (err: any) {
      alert('Error: ' + (err?.message || 'unknown'))
    }
    setSaving(false)
  }

  const fmtMoney = (v: number) => '$' + v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })

  if (availableEvents.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>No events assigned</div>
        <div style={{ fontSize: 13, color: 'var(--mist)', marginTop: 6 }}>
          Once you're added to an event, it'll show up here.
        </div>
      </div>
    )
  }

  // User has events but none are active or upcoming — offer a past-events picker.
  if (!selectedEvent) {
    return (
      <div style={{ padding: '40px 20px', textAlign: 'center', background: '#F5F0E8', minHeight: '100%' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>📅</div>
        <div style={{ fontSize: 17, fontWeight: 800, color: '#1A1A16' }}>No active or upcoming events</div>
        <div style={{ fontSize: 13, color: '#737368', marginTop: 6, marginBottom: 18 }}>
          Check back when your next buy is scheduled.
        </div>
        <button onClick={() => setShowPastEvents(v => !v)} style={{
          padding: '10px 18px', borderRadius: 10, border: '1.5px solid #1D6B44',
          background: 'transparent', color: '#1D6B44', fontSize: 13, fontWeight: 700,
          cursor: 'pointer', fontFamily: 'inherit',
        }}>
          {showPastEvents ? 'Hide past events' : 'View past events'}
        </button>
        {showPastEvents && (
          <div style={{
            marginTop: 16, textAlign: 'left',
            background: '#FFFFFF', borderRadius: 12,
            border: '1px solid #EDE8DF', overflow: 'hidden',
          }}>
            {availableEvents.map(ev => (
              <button key={ev.id} onClick={() => setSelectedEventId(ev.id)} style={{
                width: '100%', padding: '12px 14px', background: 'transparent',
                border: 'none', borderBottom: '1px solid #EDE8DF',
                textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
              }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#1A1A16' }}>{ev.store_name}</div>
                <div style={{ fontSize: 11, color: '#737368' }}>
                  {new Date(ev.start_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{
      background: '#F5F0E8', minHeight: '100%',
      paddingBottom: 80,
    }}>
      {showOverlay && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(26,26,22,.78)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          animation: 'mdeFade .2s ease-out',
        }}>
          <div style={{
            background: '#FFFFFF', padding: '32px 36px', borderRadius: 20,
            textAlign: 'center', maxWidth: 300,
            animation: 'mdePop .3s cubic-bezier(.2,1.4,.4,1)',
          }}>
            <div style={{
              width: 72, height: 72, borderRadius: '50%',
              background: '#1D6B44', margin: '0 auto 16px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 38, color: '#FFF', fontWeight: 900,
            }}>✓</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: '#1A1A16', marginBottom: 6 }}>Day {selectedDay} Submitted!</div>
            <div style={{ fontSize: 13, color: '#737368' }}>Admins have been notified</div>
          </div>
        </div>
      )}
      <style>{`
        @keyframes mdeFade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes mdePop  { from { transform: scale(.85); opacity: 0 } to { transform: scale(1); opacity: 1 } }
        input[type=number]::-webkit-outer-spin-button,
        input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        input[type=number] { -moz-appearance: textfield; }
      `}</style>

      <div style={{ background: '#FFFFFF', padding: '16px 18px 14px', borderBottom: '1px solid #EDE8DF' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#737368', letterSpacing: '.1em', textTransform: 'uppercase' }}>Entering Data For</div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
          <div style={{
            fontSize: 20, fontWeight: 800, color: '#1A1A16', marginTop: 2,
            lineHeight: 1.15, flex: 1, minWidth: 0,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {selectedEvent.store_name}
          </div>
          {availableEvents.length > 1 && (
            <button onClick={() => setEventSwitcherOpen(v => !v)} style={{
              background: 'none', border: 'none', color: '#1D6B44',
              fontSize: 12, fontWeight: 700, cursor: 'pointer',
              padding: '4px 6px', fontFamily: 'inherit',
            }}>
              {eventSwitcherOpen ? 'Cancel' : 'Change'}
            </button>
          )}
        </div>
        <div style={{ fontSize: 13, color: '#737368', marginTop: 2 }}>
          {new Date(selectedEvent.start_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </div>
        {eventSwitcherOpen && (
          <div style={{
            marginTop: 10, background: '#F5F0E8', borderRadius: 10,
            border: '1px solid #EDE8DF', overflow: 'hidden',
          }}>
            {availableEvents.map(ev => (
              <button key={ev.id} onClick={() => { setSelectedEventId(ev.id); setEventSwitcherOpen(false) }} style={{
                width: '100%', padding: '10px 14px',
                background: ev.id === selectedEventId ? '#F0FDF4' : 'transparent',
                border: 'none', borderBottom: '1px solid #EDE8DF',
                textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
              }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#1A1A16' }}>{ev.store_name}</div>
                <div style={{ fontSize: 11, color: '#737368' }}>
                  {new Date(ev.start_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </div>
              </button>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
          {[1, 2, 3].map(d => {
            const status = daysStatus[d]
            const cur = selectedDay === d
            const bg = cur ? '#1D6B44'
              : status === 'submitted' ? '#86EFAC'
              : status === 'draft' ? '#FEF3C7'
              : '#EDE8DF'
            const color = cur ? '#FFF'
              : status === 'submitted' ? '#14532D'
              : status === 'draft' ? '#92400E'
              : '#737368'
            const marker = status === 'submitted' && !cur ? '✓ '
              : status === 'draft' && !cur ? '● '
              : ''
            return (
              <button key={d} onClick={() => setSelectedDay(d)} style={{
                flex: 1, padding: '8px 0', borderRadius: 8, border: 'none',
                background: bg, color,
                fontSize: 11, fontWeight: 800, textAlign: 'center', letterSpacing: '.08em',
                cursor: 'pointer', fontFamily: 'inherit',
              }}>
                {marker}DAY {d}{cur ? ' · TODAY' : ''}
              </button>
            )
          })}
        </div>
      </div>

      <div style={{
        margin: '10px 14px 0', padding: 4, borderRadius: 12,
        background: '#FFFFFF', display: 'flex', border: '1px solid #EDE8DF',
      }}>
        {(['quick', 'detailed'] as const).map(m => {
          const active = mode === m
          return (
            <button key={m} onClick={() => setMode(m)} style={{
              flex: 1, padding: '10px 0', borderRadius: 8, border: 'none',
              background: active ? '#1D6B44' : 'transparent',
              color: active ? '#FFFFFF' : '#737368',
              fontWeight: 800, fontSize: 13, cursor: 'pointer',
              fontFamily: 'inherit', letterSpacing: '.02em',
              transition: 'all .2s',
            }}>
              {m === 'quick' ? '⚡ Quick' : '📋 Detailed'}
            </button>
          )
        })}
      </div>

      {loadingEntry && (
        <div style={{
          margin: '10px 14px 0', padding: '10px 14px',
          background: '#EDE8DF', border: '1px solid #D8D3CA',
          borderRadius: 10, fontSize: 13, color: '#737368', fontWeight: 600,
          textAlign: 'center',
        }}>
          Loading Day {selectedDay} data…
        </div>
      )}

      {!loadingEntry && submitted && !showOverlay && (
        <div style={{
          margin: '10px 14px 0', padding: '10px 14px',
          background: '#F0FDF4', border: '1px solid #86EFAC',
          borderRadius: 10, fontSize: 13, color: '#14532D', fontWeight: 600,
        }}>
          ✓ Day {selectedDay} submitted — edit and re-submit below.
        </div>
      )}

      {!loadingEntry && !submitted && existingEntry && (
        <div style={{
          margin: '10px 14px 0', padding: '10px 14px',
          background: '#FEF3C7', border: '1px solid #FCD34D',
          borderRadius: 10, fontSize: 13, color: '#92400E', fontWeight: 600,
        }}>
          ● Day {selectedDay} draft loaded — continue editing below.
        </div>
      )}

      <div style={{ padding: '14px 14px 0' }}>
        <div style={cardStyle}>
          <SectionLabel>Today's Numbers</SectionLabel>
          <FieldRow label="Customers Seen" value={customers} onChange={setCustomers} />
          <FieldRow label="Purchases Made" value={purchases} onChange={setPurchases} required />
          <FieldRow label="$ @ 10% Commission" value={tenPct} onChange={setTenPct} money required />
          <FieldRow label="$ @ 5% Commission" value={fivePct} onChange={setFivePct} money last />
        </div>

        {touched && (
          <div style={{ ...cardStyle, background: '#F0FDF4', borderColor: '#86EFAC' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <Stat label="Total" value={fmtMoney(totalSpend)} />
              <Stat label="Close Rate" value={`${closeRate}%`} />
              <Stat label="Commission" value={fmtMoney(commission)} />
            </div>
          </div>
        )}

        <div style={{
          maxHeight: mode === 'detailed' ? 5000 : 0,
          opacity: mode === 'detailed' ? 1 : 0,
          overflow: 'hidden',
          transition: 'max-height .4s ease, opacity .25s ease',
        }}>
          <div style={cardStyle}>
            <SectionLabel>Lead Sources</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {LEAD_SOURCES.map(s => (
                <MiniField key={s.key} label={s.label}
                  value={sources[s.key]}
                  onChange={v => setSources(p => ({ ...p, [s.key]: v }))} />
              ))}
            </div>
          </div>

          <div style={cardStyle}>
            <SectionLabel>Checks</SectionLabel>
            {checks.map((c, i) => {
              const isAuto = i > 0 && !!c.check_number && !c.amount
              return (
                <div key={c.id || i} style={{
                  background: '#F5F0E8', borderRadius: 12, padding: 12,
                  marginBottom: 10, border: '1px solid #EDE8DF',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <span style={{ fontSize: 11, fontWeight: 800, color: '#737368', letterSpacing: '.1em' }}>#{i + 1}</span>
                    <select value={c.payment_type}
                      onChange={e => setChecks(p => p.map((x, idx) => idx === i ? { ...x, payment_type: e.target.value } : x))}
                      style={{
                        flex: 1, padding: '6px 8px', fontSize: 13, borderRadius: 8,
                        border: '1px solid #D8D3CA', background: '#FFF', fontFamily: 'inherit',
                      }}>
                      <option value="check">Check</option>
                      <option value="cash">Cash</option>
                    </select>
                    {checks.length > 1 && (
                      <button
                        onClick={() => setChecks(p => p.filter((_, idx) => idx !== i))}
                        aria-label={`Remove check ${i + 1}`}
                        style={{
                          width: 36, height: 36, borderRadius: 8,
                          border: '1px solid #EDE8DF', background: '#FFF',
                          color: '#A8A89A', fontSize: 20, cursor: 'pointer',
                          padding: 0, lineHeight: 1, fontFamily: 'inherit',
                        }}>×</button>
                    )}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                    <div>
                      <label style={labelStyle}>
                        Check # {isAuto && <span style={{ color: '#1D6B44', fontStyle: 'italic', textTransform: 'none', letterSpacing: 0 }}>auto</span>}
                      </label>
                      <input type="text" inputMode="numeric" value={c.check_number}
                        onChange={e => setChecks(p => p.map((x, idx) => idx === i ? { ...x, check_number: e.target.value } : x))}
                        placeholder={i === 0 ? '1045' : ''}
                        style={{
                          ...inputStyle,
                          border: `1.5px solid ${isAuto ? '#86EFAC' : '#D8D3CA'}`,
                          background: isAuto ? '#F0FDF4' : '#FFFFFF',
                        }} />
                    </div>
                    <div>
                      <label style={labelStyle}>Buy Form #</label>
                      <input type="text" inputMode="numeric" value={c.buy_form_number}
                        onChange={e => setChecks(p => p.map((x, idx) => idx === i ? { ...x, buy_form_number: e.target.value } : x))}
                        placeholder="—" style={inputStyle} />
                    </div>
                  </div>

                  <div>
                    <label style={labelStyle}>Amount</label>
                    <div style={{ position: 'relative' }}>
                      <span style={{
                        position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
                        color: '#737368', fontWeight: 700, fontSize: 18,
                      }}>$</span>
                      <input type="text" inputMode="decimal"
                        value={formatMoneyInput(c.amount)}
                        onChange={e => {
                          const cleaned = parseMoneyInput(e.target.value)
                          setChecks(p => p.map((x, idx) => idx === i ? { ...x, amount: cleaned } : x))
                        }}
                        placeholder="0.00"
                        style={{ ...inputStyle, padding: '0 12px 0 26px', fontSize: 20, fontWeight: 800 }} />
                    </div>
                  </div>

                  <label style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    marginTop: 10, padding: '8px 10px',
                    background: c.commission_rate === 5 ? 'var(--green-pale)' : 'transparent',
                    border: `1px solid ${c.commission_rate === 5 ? 'var(--green3)' : '#EDE8DF'}`,
                    borderRadius: 8, cursor: 'pointer', position: 'relative',
                  }}>
                    <input type="checkbox"
                      checked={c.commission_rate === 5}
                      onChange={e => setChecks(p => p.map((x, idx) =>
                        idx === i ? { ...x, commission_rate: e.target.checked ? 5 : 10 } : x))}
                      style={{
                        position: 'absolute', opacity: 0,
                        width: 0, height: 0, pointerEvents: 'none',
                      }}
                    />
                    <div aria-hidden="true" style={{
                      width: 22, height: 22, flexShrink: 0,
                      borderRadius: 5,
                      border: `2px solid ${c.commission_rate === 5 ? 'var(--green)' : 'var(--pearl)'}`,
                      background: c.commission_rate === 5 ? 'var(--green)' : '#FFFFFF',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: '#FFFFFF', fontSize: 14, fontWeight: 900, lineHeight: 1,
                      transition: 'all .15s ease',
                    }}>
                      {c.commission_rate === 5 ? '✓' : ''}
                    </div>
                    <span style={{
                      fontSize: 12, fontWeight: 700,
                      color: c.commission_rate === 5 ? 'var(--green-dark)' : '#737368',
                      letterSpacing: '.02em',
                    }}>
                      5% commission rate
                    </span>
                    <span style={{
                      marginLeft: 'auto', fontSize: 10, fontWeight: 700,
                      color: c.commission_rate === 5 ? 'var(--green-dark)' : '#A8A89A',
                      letterSpacing: '.06em',
                    }}>
                      {c.commission_rate === 5 ? '5%' : 'DEFAULT 10%'}
                    </span>
                  </label>
                </div>
              )
            })}

            <button
              onClick={() => setChecks(p => [...p, { ...emptyCheck(), check_number: nextCheckNumber(p) }])}
              style={{
                width: '100%', padding: '12px 0', borderRadius: 10,
                border: '1.5px dashed #D8D3CA', background: 'transparent',
                color: '#1D6B44', fontWeight: 700, fontSize: 14,
                cursor: 'pointer', fontFamily: 'inherit', marginTop: 4,
              }}>
              + Add Check
            </button>

            {validChecks.length > 0 && (
              <div style={{
                fontSize: 12, color: '#14532D', marginTop: 10,
                fontWeight: 700, textAlign: 'right', lineHeight: 1.5,
              }}>
                <div>
                  {validChecks.length} check{validChecks.length === 1 ? '' : 's'} · {fmtMoney(checksTotal)}
                </div>
                {derived5 > 0 && (
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#737368' }}>
                    {fmtMoney(derived10)} @ 10% · {fmtMoney(derived5)} @ 5%
                  </div>
                )}
              </div>
            )}
          </div>

          <div style={{ padding: '0 2px 14px' }}>
            <button disabled style={{
              width: '100%', padding: '14px 16px', borderRadius: 12,
              background: '#F5F0E8', border: '1.5px dashed #D8D3CA',
              color: '#737368', fontWeight: 700, fontSize: 14,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              cursor: 'not-allowed', opacity: .75, fontFamily: 'inherit',
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="6" height="6" rx="1" /><rect x="15" y="3" width="6" height="6" rx="1" />
                <rect x="3" y="15" width="6" height="6" rx="1" /><path d="M13 13h2v2h-2z M17 13h2M13 17h2m2 0h2m-4 2h2" />
            </svg>
              Scan Mode — Coming Soon
              <span style={{
                fontSize: 9, fontWeight: 900, letterSpacing: '.1em',
                padding: '2px 6px', borderRadius: 4,
                background: '#1D6B44', color: '#FFF',
              }}>BETA</span>
            </button>
          </div>
        </div>
      </div>

      <div style={{
        position: 'fixed', left: 0, right: 0,
        bottom: 'calc(72px + env(safe-area-inset-bottom))',
        padding: '20px 14px 10px',
        background: 'linear-gradient(to top, rgba(245,240,232,1) 75%, rgba(245,240,232,0))',
        zIndex: 500,
      }}>
        <div style={{ maxWidth: 540, margin: '0 auto', display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ flexShrink: 0 }}><AutosaveIndicator status={autosaveStatus} /></div>
          <button onClick={handleSubmit} disabled={saving || !selectedEventId} style={{
            flex: 1, minHeight: 52, borderRadius: 14, border: 'none',
            background: saving ? '#737368' : '#1D6B44', color: '#FFF',
            fontWeight: 900, fontSize: 16, cursor: saving ? 'default' : 'pointer',
            fontFamily: 'inherit', letterSpacing: '.02em',
            boxShadow: '0 6px 16px rgba(29,107,68,.25)',
          }}>
            {saving
              ? 'Saving…'
              : submitted
                ? `✓ Re-Submit Day ${selectedDay}`
                : existingEntry
                  ? `✓ Submit Day ${selectedDay}`
                  : `✓ Submit Day ${selectedDay}`}
          </button>
        </div>
      </div>
    </div>
  )
}

const cardStyle: React.CSSProperties = {
  background: '#FFFFFF', borderRadius: 14, padding: 14,
  marginBottom: 12, border: '1px solid #EDE8DF',
}
const labelStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, color: '#737368',
  letterSpacing: '.08em', textTransform: 'uppercase',
  display: 'block', marginBottom: 4,
}
const inputStyle: React.CSSProperties = {
  width: '100%', minHeight: 44, padding: '0 12px',
  fontSize: 16, fontWeight: 700,
  borderRadius: 10, border: '1.5px solid #D8D3CA',
  background: '#FFFFFF', color: '#1A1A16',
  outline: 'none', fontFamily: 'inherit',
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase',
      color: '#737368', marginBottom: 10,
    }}>{children}</div>
  )
}

function FieldRow({ label, value, onChange, money, required, last }: {
  label: string; value: string; onChange: (v: string) => void
  money?: boolean; required?: boolean; last?: boolean
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 0',
      borderBottom: last ? 'none' : `1px solid #F0EDE6`,
    }}>
      <label style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#4A4A42' }}>
        {label}{required && <span style={{ color: '#DC2626' }}> *</span>}
      </label>
      <div style={{ position: 'relative', width: 140 }}>
        {money && (
          <span style={{
            position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
            fontWeight: 700, color: '#737368',
          }}>$</span>
        )}
        <input
          type={money ? 'text' : 'number'}
          inputMode={money ? 'decimal' : 'numeric'}
          value={money ? formatMoneyInput(value) : value}
          onChange={e => onChange(money ? parseMoneyInput(e.target.value) : e.target.value)}
          placeholder="0"
          style={{
            width: '100%', minHeight: 44, textAlign: 'right',
            padding: money ? '0 10px 0 22px' : '0 10px',
            fontSize: 20, fontWeight: 800,
            borderRadius: 10, border: '1.5px solid #D8D3CA',
            background: '#F5F0E8', color: '#1A1A16',
            outline: 'none', fontFamily: 'inherit',
          }} />
      </div>
    </div>
  )
}

function MiniField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase',
        color: '#737368', display: 'block', marginBottom: 4,
      }}>{label}</label>
      <input type="number" inputMode="numeric" value={value} onChange={e => onChange(e.target.value)}
        placeholder="0" style={{
          width: '100%', minHeight: 44, padding: '0 10px',
          fontSize: 18, fontWeight: 700,
          borderRadius: 10, border: '1.5px solid #D8D3CA',
          background: '#FFFFFF', color: '#1A1A16',
          outline: 'none', fontFamily: 'inherit',
        }} />
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{
        fontSize: 10, fontWeight: 800, letterSpacing: '.12em',
        color: '#14532D', textTransform: 'uppercase',
      }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 900, color: '#1D6B44', marginTop: 2 }}>{value}</div>
    </div>
  )
}
