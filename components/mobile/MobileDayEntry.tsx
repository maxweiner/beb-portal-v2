'use client'

import { useState, useEffect, useRef } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import { useAutosave, AutosaveIndicator } from '@/lib/useAutosave'
import { canEditEvent } from '@/lib/permissions'
import Checkbox from '@/components/ui/Checkbox'

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
  const { events, stores, user, dayEntryIntent, setDayEntryIntent } = useApp()
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
  // Per-buyer purchase counts. Missing key = blank input (≠ 0). Persisted
  // to event_days.purchases_by_buyer (JSONB).
  const [purchasesByBuyer, setPurchasesByBuyer] = useState<Record<string, string>>({})
  // 5% commission is rare — collapsed behind a + link unless the row
  // already has a non-zero value saved.
  const [show5pct, setShow5pct] = useState(false)
  const [checks, setChecks] = useState<CheckRow[]>([emptyCheck()])
  // Form # column visibility — per-store default (stores.default_form_number_visible)
  // with a per-user override persisted in localStorage at
  // beb-form-no-{user_id}-{store_id}.
  const [formColVisible, setFormColVisible] = useState(true)
  // Which check row's overflow ⋯ menu is open (null = none).
  const [overflowOpenIdx, setOverflowOpenIdx] = useState<number | null>(null)
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

  // Load Form # column preference: localStorage override > stores.default_form_number_visible > true.
  useEffect(() => {
    if (!user || !selectedEvent) return
    const storeId = selectedEvent.store_id
    if (!storeId) return
    const lsKey = `beb-form-no-${user.id}-${storeId}`
    let next: boolean
    try {
      const saved = localStorage.getItem(lsKey)
      if (saved === '1') next = true
      else if (saved === '0') next = false
      else {
        const store = stores.find(s => s.id === storeId)
        next = store?.default_form_number_visible !== false
      }
    } catch { next = true }
    setFormColVisible(next)
  }, [user?.id, selectedEvent?.store_id, stores])

  function toggleFormCol() {
    if (!user || !selectedEvent?.store_id) return
    const next = !formColVisible
    setFormColVisible(next)
    try {
      localStorage.setItem(`beb-form-no-${user.id}-${selectedEvent.store_id}`, next ? '1' : '0')
    } catch { /* ignore */ }
  }

  useEffect(() => {
    if (selectedEventId) loadEntries()
  }, [selectedEventId, selectedDay])

  const loadEntries = async () => {
    hydratedRef.current = false
    setLoadingEntry(true)
    // Shared per-event-day row on event_days (no buyer filter — anyone on
    // the event edits the same record).
    const { data: rows } = await supabase.from('event_days')
      .select('*')
      .eq('event_id', selectedEventId)
      .in('day_number', [1, 2, 3])
    const byDay: Record<number, any> = {}
    ;(rows || []).forEach((r: any) => { byDay[r.day_number] = r })
    // event_days has no submitted_at — treat "row has data" as submitted.
    const hasData = (r: any) => !!r && ((r.customers || 0) + (r.purchases || 0) + (r.dollars10 || 0) + (r.dollars5 || 0) > 0)
    setDaysStatus({
      1: hasData(byDay[1]) ? 'submitted' : (byDay[1] ? 'draft' : null),
      2: hasData(byDay[2]) ? 'submitted' : (byDay[2] ? 'draft' : null),
      3: hasData(byDay[3]) ? 'submitted' : (byDay[3] ? 'draft' : null),
    })
    const current = byDay[selectedDay]
    if (current) {
      setExistingEntry(current)
      entryIdRef.current = current.id
      setCustomers(String(current.customers ?? ''))
      setPurchases(current.purchases != null ? String(current.purchases) : '')
      setTenPct(current.dollars10 != null ? String(current.dollars10) : '')
      setFivePct(current.dollars5  != null ? String(current.dollars5)  : '')
      setShow5pct((current.dollars5 || 0) > 0)
      setSources(Object.fromEntries(LEAD_SOURCES.map(s => [s.key, String((current as any)[s.key] || '')])))
      const pbb = (current as any).purchases_by_buyer || {}
      setPurchasesByBuyer(
        Object.fromEntries(Object.entries(pbb).map(([k, v]) => [k, String(v ?? '')]))
      )
      setSubmitted(hasData(current))
    } else {
      setExistingEntry(null)
      entryIdRef.current = null
      setCustomers(''); setPurchases(''); setTenPct(''); setFivePct('')
      setShow5pct(false)
      setSources(Object.fromEntries(LEAD_SOURCES.map(s => [s.key, ''])))
      setPurchasesByBuyer({})
      setSubmitted(false)
    }
    // Day-level checks — matched by (event_id, day_number), no entry_id.
    const { data: chks } = await supabase.from('buyer_checks')
      .select('*')
      .eq('event_id', selectedEventId)
      .eq('day_number', selectedDay)
      .is('entry_id', null)
      .order('created_at')
    setChecks(chks && chks.length > 0 ? chks.map((c: any) => ({
      id: c.id,
      check_number: c.check_number || '',
      buy_form_number: c.buy_form_number || '',
      amount: c.amount != null ? String(c.amount) : '',
      payment_type: c.payment_type || 'check',
      commission_rate: c.commission_rate === 5 ? 5 : c.commission_rate === 0 ? 0 : 10,
    })) : [emptyCheck()])
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
  const derived0  = validChecks.filter(c => c.commission_rate === 0 ).reduce((s, c) => s + parseFloat(c.amount), 0)
  const hasValidChecks = validChecks.length > 0

  // Top aggregate fields (purchases / $ @ 10% / $ @ 5%) stay raw-editable.
  // On Submit, check totals OVERWRITE these fields (Q7). To avoid stale
  // state on the same tick, persist() takes an `overrides` arg.
  // Writes directly to event_days (day-level shared record) — buyers
  // assigned to the event + admins all edit the same row.
  type Overrides = Partial<{ purchases: string; tenPct: string; fivePct: string }>
  const persist = async (_submit: boolean, overrides: Overrides = {}) => {
    if (persistInFlightRef.current) return
    if (!selectedEventId || !user?.id) return
    const ev = events.find(e => e.id === selectedEventId)
    if (!canEditEvent(user, ev as any)) {
      alert("You're not assigned to this event — save blocked.")
      return
    }
    persistInFlightRef.current = true
    try {
      const effPurchases = overrides.purchases ?? purchases
      const effTenPct    = overrides.tenPct    ?? tenPct
      const effFivePct   = overrides.fivePct   ?? fivePct
      // Per-buyer purchases — empty input becomes a missing key so that
      // "blank = not entered yet" stays distinct from "0 entered".
      const purchasesByBuyerPayload: Record<string, number> = {}
      for (const [uid, raw] of Object.entries(purchasesByBuyer)) {
        const trimmed = (raw ?? '').toString().trim()
        if (trimmed === '') continue
        const n = parseInt(trimmed, 10)
        if (Number.isFinite(n) && n >= 0) purchasesByBuyerPayload[uid] = n
      }
      const payload: any = {
        event_id: selectedEventId,
        day_number: selectedDay,
        day: selectedDay,
        customers: parseInt(customers) || 0,
        purchases: effPurchases !== '' ? parseInt(effPurchases) || 0 : 0,
        dollars10: effTenPct !== '' ? parseFloat(effTenPct) || 0 : 0,
        dollars5:  effFivePct !== '' ? parseFloat(effFivePct) || 0 : 0,
        ...Object.fromEntries(LEAD_SOURCES.map(s => [s.key, parseInt(sources[s.key]) || 0])),
        purchases_by_buyer: purchasesByBuyerPayload,
        entered_by: user.id,
        entered_by_name: user.name,
        entered_at: new Date().toISOString(),
      }

      // Fresh-existing lookup guards stale-null races (two tabs, etc.).
      let rowId = entryIdRef.current
      if (!rowId) {
        const { data: existingRows } = await supabase.from('event_days')
          .select('id')
          .eq('event_id', selectedEventId)
          .eq('day_number', selectedDay)
          .limit(1)
        if (existingRows && existingRows.length > 0) {
          rowId = existingRows[0].id
          entryIdRef.current = rowId
        }
      }

      if (rowId) {
        const { error } = await supabase.from('event_days').update(payload).eq('id', rowId)
        if (error) throw error
      } else {
        const { data, error } = await supabase.from('event_days').insert(payload).select().single()
        if (error) throw error
        rowId = data?.id || null
        entryIdRef.current = rowId
      }
      if (!rowId) throw new Error('Failed to save day')

      // Day-level checks — entry_id is null; keyed by event_id + day_number.
      const { error: delErr } = await supabase.from('buyer_checks').delete()
        .eq('event_id', selectedEventId)
        .eq('day_number', selectedDay)
        .is('entry_id', null)
      if (delErr) throw delErr
      if (validChecks.length > 0) {
        const { error } = await supabase.from('buyer_checks').insert(validChecks.map(c => ({
          entry_id: null,
          event_id: selectedEventId,
          day_number: selectedDay,
          check_number: c.check_number, buy_form_number: c.buy_form_number,
          amount: parseFloat(c.amount) || 0, payment_type: c.payment_type,
          commission_rate: c.commission_rate === 5 ? 5 : c.commission_rate === 0 ? 0 : 10,
        })))
        if (error) throw error
      }
    } finally {
      persistInFlightRef.current = false
    }
  }

  const autosaveStatus = useAutosave(
    { customers, purchases, tenPct, fivePct, sources, checks, purchasesByBuyer },
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
      <div style={{ padding: '40px 20px', textAlign: 'center', background: 'var(--cream)', minHeight: '100%' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>📅</div>
        <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--ink)' }}>No active or upcoming events</div>
        <div style={{ fontSize: 13, color: 'var(--mist)', marginTop: 6, marginBottom: 18 }}>
          Check back when your next buy is scheduled.
        </div>
        <button onClick={() => setShowPastEvents(v => !v)} style={{
          padding: '10px 18px', borderRadius: 10, border: '1.5px solid var(--green)',
          background: 'transparent', color: 'var(--green)', fontSize: 13, fontWeight: 700,
          cursor: 'pointer', fontFamily: 'inherit',
        }}>
          {showPastEvents ? 'Hide past events' : 'View past events'}
        </button>
        {showPastEvents && (
          <div style={{
            marginTop: 16, textAlign: 'left',
            background: '#FFFFFF', borderRadius: 12,
            border: '1px solid var(--cream2)', overflow: 'hidden',
          }}>
            {availableEvents.map(ev => (
              <button key={ev.id} onClick={() => setSelectedEventId(ev.id)} style={{
                width: '100%', padding: '12px 14px', background: 'transparent',
                border: 'none', borderBottom: '1px solid var(--cream2)',
                textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
              }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{ev.store_name}</div>
                <div style={{ fontSize: 11, color: 'var(--mist)' }}>
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
      background: 'var(--cream)', minHeight: '100%',
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
              background: 'var(--green)', margin: '0 auto 16px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 38, color: '#FFF', fontWeight: 900,
            }}>✓</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink)', marginBottom: 6 }}>Day {selectedDay} Submitted!</div>
            <div style={{ fontSize: 13, color: 'var(--mist)' }}>Admins have been notified</div>
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

      <div style={{ background: '#FFFFFF', padding: '16px 18px 14px', borderBottom: '1px solid var(--cream2)' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--mist)', letterSpacing: '.1em', textTransform: 'uppercase' }}>Entering Data For</div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
          <div style={{
            fontSize: 20, fontWeight: 800, color: 'var(--ink)', marginTop: 2,
            lineHeight: 1.15, flex: 1, minWidth: 0,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {selectedEvent.store_name}
          </div>
          {availableEvents.length > 1 && (
            <button onClick={() => setEventSwitcherOpen(v => !v)} style={{
              background: 'none', border: 'none', color: 'var(--green)',
              fontSize: 12, fontWeight: 700, cursor: 'pointer',
              padding: '4px 6px', fontFamily: 'inherit',
            }}>
              {eventSwitcherOpen ? 'Cancel' : 'Change'}
            </button>
          )}
        </div>
        <div style={{ fontSize: 13, color: 'var(--mist)', marginTop: 2 }}>
          {new Date(selectedEvent.start_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </div>
        {eventSwitcherOpen && (
          <div style={{
            marginTop: 10, background: 'var(--cream)', borderRadius: 10,
            border: '1px solid var(--cream2)', overflow: 'hidden',
          }}>
            {availableEvents.map(ev => (
              <button key={ev.id} onClick={() => { setSelectedEventId(ev.id); setEventSwitcherOpen(false) }} style={{
                width: '100%', padding: '10px 14px',
                background: ev.id === selectedEventId ? 'var(--green-pale)' : 'transparent',
                border: 'none', borderBottom: '1px solid var(--cream2)',
                textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
              }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{ev.store_name}</div>
                <div style={{ fontSize: 11, color: 'var(--mist)' }}>
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
            const bg = cur ? 'var(--gradient-primary)'
              : status === 'submitted' ? 'var(--green3)'
              : status === 'draft' ? 'var(--amber-pale)'
              : 'var(--cream2)'
            const color = cur ? '#FFF'
              : status === 'submitted' ? 'var(--green-dark)'
              : status === 'draft' ? 'var(--amber)'
              : 'var(--mist)'
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
        background: '#FFFFFF', display: 'flex', border: '1px solid var(--cream2)',
      }}>
        {(['quick', 'detailed'] as const).map(m => {
          const active = mode === m
          return (
            <button key={m} onClick={() => setMode(m)} style={{
              flex: 1, padding: '10px 0', borderRadius: 8, border: 'none',
              background: active ? 'var(--gradient-primary)' : 'transparent',
              color: active ? '#FFFFFF' : 'var(--mist)',
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
          background: 'var(--cream2)', border: '1px solid var(--pearl)',
          borderRadius: 10, fontSize: 13, color: 'var(--mist)', fontWeight: 600,
          textAlign: 'center',
        }}>
          Loading Day {selectedDay} data…
        </div>
      )}

      {!loadingEntry && submitted && !showOverlay && (
        <div style={{
          margin: '10px 14px 0', padding: '10px 14px',
          background: 'var(--green-pale)', border: '1px solid var(--green3)',
          borderRadius: 10, fontSize: 13, color: 'var(--green-dark)', fontWeight: 600,
        }}>
          ✓ Day {selectedDay} submitted — edit and re-submit below.
        </div>
      )}

      {!loadingEntry && !submitted && existingEntry && (
        <div style={{
          margin: '10px 14px 0', padding: '10px 14px',
          background: 'var(--amber-pale)', border: '1px solid var(--amber)',
          borderRadius: 10, fontSize: 13, color: 'var(--amber)', fontWeight: 600,
        }}>
          ● Day {selectedDay} draft loaded — continue editing below.
        </div>
      )}

      <div style={{ padding: '14px 14px 0' }}>
        <div style={cardStyle}>
          <SectionLabel>Today's Numbers</SectionLabel>
          <FieldRow label="Purchases Made" value={purchases} onChange={setPurchases} required />
          <FieldRow label="Customers Seen" value={customers} onChange={setCustomers} />
          <FieldRow label="$ @ 10% Commission" value={tenPct} onChange={setTenPct} money required last={!show5pct} />
          {show5pct ? (
            <FieldRow label="$ @ 5% Commission" value={fivePct} onChange={setFivePct} money last />
          ) : (
            <button onClick={() => setShow5pct(true)} style={{
              marginTop: 10, padding: 0, background: 'none', border: 'none',
              color: 'var(--green-dark)', fontWeight: 700, fontSize: 12,
              cursor: 'pointer', fontFamily: 'inherit',
              textDecoration: 'underline', textAlign: 'left',
            }}>Show 5% commission field</button>
          )}
        </div>

        {(selectedEvent?.workers || []).length > 0 && (
          <div style={cardStyle}>
            <SectionLabel>Purchases by Buyer</SectionLabel>
            {(selectedEvent?.workers || []).map((w: any, i: number, arr: any[]) => {
              const isLead = i === 0
              return (
                <FieldRow
                  key={w.id}
                  label={
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      {w.name}
                      {isLead && (
                        <span style={{ fontSize: 9, fontWeight: 800, color: '#fff', background: 'var(--green)', padding: '2px 6px', borderRadius: 8, letterSpacing: '.04em' }}>⭐ LEAD</span>
                      )}
                    </span>
                  }
                  value={purchasesByBuyer[w.id] ?? ''}
                  onChange={v => setPurchasesByBuyer(p => ({ ...p, [w.id]: v }))}
                  last={i === arr.length - 1}
                />
              )
            })}
          </div>
        )}

        {touched && (
          <div style={{ ...cardStyle, background: 'var(--green-pale)', borderColor: 'var(--green3)' }}>
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
            {/* Section header — title left, Form # toggle right */}
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
              <SectionLabel>Checks</SectionLabel>
              <button onClick={toggleFormCol}
                aria-label={formColVisible ? 'Hide Form # column' : 'Show Form # column'}
                style={{
                  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontSize: 11, fontWeight: 700, color: 'var(--green-dark)',
                  textDecoration: 'underline',
                }}>
                {formColVisible ? '− Hide form #' : '+ Show form #'}
              </button>
            </div>

            {checks.map((c, i) => {
              const isAuto = i > 0 && !!c.check_number && !c.amount
              const setRate = (next: 0 | 5 | 10) =>
                setChecks(p => p.map((x, idx) => idx === i ? { ...x, commission_rate: next } : x))
              const setField = <K extends keyof CheckRow>(key: K, val: CheckRow[K]) =>
                setChecks(p => p.map((x, idx) => idx === i ? { ...x, [key]: val } : x))

              return (
                <div key={c.id || i} style={{
                  position: 'relative',
                  background: 'var(--cream)', borderRadius: 10, padding: '8px 10px',
                  marginBottom: 6, border: '1px solid var(--cream2)',
                  display: 'grid',
                  gridTemplateColumns: formColVisible
                    ? '22px minmax(56px, 1fr) minmax(56px, 1fr) minmax(56px, 1fr) auto auto'
                    : '22px minmax(56px, 1fr) minmax(56px, 1fr) auto auto',
                  gap: 4, alignItems: 'end',
                }}>
                  <span style={{
                    fontSize: 11, fontWeight: 900, color: 'var(--mist)',
                    paddingBottom: 8, textAlign: 'center',
                  }}>#{i + 1}</span>

                  <div>
                    <label style={miniLabelStyle}>
                      Check # {isAuto && <span style={{ color: 'var(--green)', fontStyle: 'italic', textTransform: 'none', letterSpacing: 0 }}>auto</span>}
                    </label>
                    <input type="text" inputMode="numeric" value={c.check_number}
                      onChange={e => setField('check_number', e.target.value)}
                      placeholder={i === 0 ? '1045' : ''}
                      style={{
                        ...compactInputStyle,
                        border: `1.5px solid ${isAuto ? 'var(--green3)' : 'var(--pearl)'}`,
                        background: isAuto ? 'var(--green-pale)' : '#FFFFFF',
                      }} />
                  </div>

                  {formColVisible && (
                    <div>
                      <label style={miniLabelStyle}>Form #</label>
                      <input type="text" inputMode="numeric" value={c.buy_form_number}
                        onChange={e => setField('buy_form_number', e.target.value)}
                        placeholder="—" style={compactInputStyle} />
                    </div>
                  )}

                  <div>
                    <label style={miniLabelStyle}>Amount</label>
                    <input type="text" inputMode="decimal"
                      value={formatMoneyInput(c.amount)}
                      onChange={e => setField('amount', parseMoneyInput(e.target.value))}
                      placeholder="0.00"
                      style={compactInputStyle} />
                  </div>

                  {/* Rate pills: 5% / 0%, stacked vertically to save horizontal
                      space. 10% is implicit when neither is on. */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <button onClick={() => setRate(c.commission_rate === 5 ? 10 : 5)}
                      title="5% commission rate"
                      style={{
                        ...ratePillBase,
                        background: c.commission_rate === 5 ? 'var(--green-pale)' : '#fff',
                        borderColor: c.commission_rate === 5 ? 'var(--green3)' : 'var(--pearl)',
                        color: c.commission_rate === 5 ? 'var(--green-dark)' : 'var(--mist)',
                      }}>5%</button>
                    <button onClick={() => setRate(c.commission_rate === 0 ? 10 : 0)}
                      title="Store purchase — no commission, excluded from event totals"
                      style={{
                        ...ratePillBase,
                        background: c.commission_rate === 0 ? '#F3F4F6' : '#fff',
                        borderColor: c.commission_rate === 0 ? 'var(--mist)' : 'var(--pearl)',
                        color: c.commission_rate === 0 ? '#1F2937' : 'var(--mist)',
                      }}>0%</button>
                  </div>

                  <button onClick={() => setOverflowOpenIdx(overflowOpenIdx === i ? null : i)}
                    aria-label={`Row ${i + 1} actions`}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--mist)', fontSize: 18, padding: '0 2px',
                      lineHeight: 1, minWidth: 22, fontFamily: 'inherit',
                    }}>⋯</button>

                  {overflowOpenIdx === i && (
                    <div onClick={e => e.stopPropagation()}
                      style={{
                        position: 'absolute', top: '100%', right: 4, zIndex: 10,
                        marginTop: 4, background: '#fff',
                        border: '1px solid var(--pearl)', borderRadius: 8,
                        boxShadow: '0 6px 16px rgba(0,0,0,.12)',
                        padding: 4, minWidth: 160,
                      }}>
                      <button onClick={() => {
                        setField('payment_type', c.payment_type === 'check' ? 'cash' : 'check')
                        setOverflowOpenIdx(null)
                      }}
                        style={overflowItemStyle}>
                        {c.payment_type === 'check' ? '💵 Mark as cash' : '🧾 Mark as check'}
                      </button>
                      {checks.length > 1 && (
                        <button onClick={() => {
                          setChecks(p => p.filter((_, idx) => idx !== i))
                          setOverflowOpenIdx(null)
                        }}
                          style={{ ...overflowItemStyle, color: '#B91C1C' }}>
                          🗑 Delete row
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}

            <button
              onClick={() => setChecks(p => [...p, { ...emptyCheck(), check_number: nextCheckNumber(p) }])}
              style={{
                width: '100%', padding: '12px 0', borderRadius: 10,
                border: '1.5px dashed var(--pearl)', background: 'transparent',
                color: 'var(--green)', fontWeight: 700, fontSize: 14,
                cursor: 'pointer', fontFamily: 'inherit', marginTop: 4,
              }}>
              + Add row
            </button>

            {validChecks.length > 0 && (
              <div style={{
                fontSize: 12, color: 'var(--green-dark)', marginTop: 10,
                fontWeight: 700, textAlign: 'right', lineHeight: 1.5,
              }}>
                <div>
                  {validChecks.length} check{validChecks.length === 1 ? '' : 's'} · {fmtMoney(checksTotal)}
                </div>
                {(derived5 > 0 || derived0 > 0) && (
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--mist)' }}>
                    {fmtMoney(derived10)} @ 10% · {fmtMoney(derived5)} @ 5%
                    {derived0 > 0 && ` · ${fmtMoney(derived0)} @ 0% (store)`}
                  </div>
                )}
              </div>
            )}
          </div>

          <div style={{ padding: '0 2px 14px' }}>
            <button disabled style={{
              width: '100%', padding: '14px 16px', borderRadius: 12,
              background: 'var(--cream)', border: '1.5px dashed var(--pearl)',
              color: 'var(--mist)', fontWeight: 700, fontSize: 14,
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
                background: 'var(--green)', color: '#FFF',
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
            background: saving ? 'var(--mist)' : 'var(--gradient-primary)', color: '#FFF',
            fontWeight: 900, fontSize: 16, cursor: saving ? 'default' : 'pointer',
            fontFamily: 'inherit', letterSpacing: '.02em',
            boxShadow: '0 6px 16px rgba(0,0,0,.22)',
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
  marginBottom: 12, border: '1px solid var(--cream2)',
}
const labelStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, color: 'var(--mist)',
  letterSpacing: '.08em', textTransform: 'uppercase',
  display: 'block', marginBottom: 4,
}
const inputStyle: React.CSSProperties = {
  width: '100%', minHeight: 44, padding: '0 12px',
  fontSize: 16, fontWeight: 700,
  borderRadius: 10, border: '1.5px solid var(--pearl)',
  background: '#FFFFFF', color: 'var(--ink)',
  outline: 'none', fontFamily: 'inherit',
}
// Compact-row atoms used by the V6 Detailed Checks layout.
const miniLabelStyle: React.CSSProperties = {
  fontSize: 9, fontWeight: 800, color: 'var(--mist)',
  letterSpacing: '.05em', textTransform: 'uppercase',
  display: 'block', marginBottom: 2, textAlign: 'center',
}
const compactInputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box',
  padding: '6px 8px', fontSize: 14,
  borderRadius: 6, border: '1px solid var(--pearl)',
  background: '#FFFFFF', color: 'var(--ink)',
  outline: 'none', fontFamily: 'inherit',
  fontVariantNumeric: 'tabular-nums',
}
const ratePillBase: React.CSSProperties = {
  border: '1px solid var(--pearl)',
  fontSize: 11, fontWeight: 800,
  padding: '5px 8px', borderRadius: 3,
  cursor: 'pointer', minWidth: 38, lineHeight: 1,
  fontFamily: 'inherit',
}
const overflowItemStyle: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left',
  background: 'transparent', border: 'none',
  padding: '8px 10px', borderRadius: 6,
  fontSize: 13, fontWeight: 700, color: 'var(--ink)',
  cursor: 'pointer', fontFamily: 'inherit',
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase',
      color: 'var(--mist)', marginBottom: 10,
    }}>{children}</div>
  )
}

function FieldRow({ label, value, onChange, money, required, last }: {
  label: React.ReactNode; value: string; onChange: (v: string) => void
  money?: boolean; required?: boolean; last?: boolean
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 0',
      borderBottom: last ? 'none' : `1px solid var(--cream2)`,
    }}>
      <label style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--ash)' }}>
        {label}{required && <span style={{ color: 'var(--red)' }}> *</span>}
      </label>
      <div style={{ position: 'relative', width: 140 }}>
        {money && (
          <span style={{
            position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
            fontWeight: 700, color: 'var(--mist)',
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
            borderRadius: 10, border: '1.5px solid var(--pearl)',
            background: 'var(--cream)', color: 'var(--ink)',
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
        color: 'var(--mist)', display: 'block', marginBottom: 4,
      }}>{label}</label>
      <input type="number" inputMode="numeric" value={value} onChange={e => onChange(e.target.value)}
        placeholder="0" style={{
          width: '100%', minHeight: 44, padding: '0 10px',
          fontSize: 18, fontWeight: 700,
          borderRadius: 10, border: '1.5px solid var(--pearl)',
          background: 'var(--cream)', color: 'var(--ink)',
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
        color: 'var(--green-dark)', textTransform: 'uppercase',
      }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--green)', marginTop: 2 }}>{value}</div>
    </div>
  )
}
