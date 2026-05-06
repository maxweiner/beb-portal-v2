'use client'

// Daily-Appointments PDF preview + email modal.
//
// Flow:
//   1. Force pick a store (dropdown of stores with portal appointments
//      OR a calendar_feed_url; pre-selected from the click context).
//   2. Pick day mode:
//        ( ) Single day  → date dropdown (limited to dates with portal
//                           appointments for the chosen store)
//        ( ) All event days → uses the most recent event window for
//                              the store (start_date + event_days)
//   3. Recipients (store contacts pre-checked + event buyers + free-form).
//   4. Optional subject/message.
//   5. 📨 Send PDF.
//
// PDF preview re-renders whenever store or day-selection changes.

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import Checkbox from '@/components/ui/Checkbox'

interface PickerOption {
  kind: 'store_contact' | 'buyer'
  id: string
  label: string
  email: string
}

interface StoreOption {
  id: string
  name: string
  city: string | null
  state: string | null
  portal_dates: string[]
  event_window: { start_date: string; days: string[] } | null
  /** Server-computed: today falls within an event window for this store. */
  is_event_in_progress?: boolean
  /** Server-computed: the requesting user is in the in-progress event's workers. */
  user_is_assigned?: boolean
}

interface Props {
  /** Optional pre-selection from the click context (date row in
   *  AppointmentsAdmin). User can change both. */
  initialStoreId?: string
  initialDate?: string
  senderName?: string
  onClose: () => void
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}
}

const fmtLong = (ds: string) =>
  new Date(ds + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
const fmtShort = (ds: string) =>
  new Date(ds + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

export default function AppointmentsDayPdfModal({ initialStoreId, initialDate, senderName, onClose }: Props) {
  // Step 1 — store picker (combo box: search input + filtered dropdown)
  const [stores, setStores] = useState<StoreOption[]>([])
  const [storesLoaded, setStoresLoaded] = useState(false)
  const [storeId, setStoreId] = useState<string>(initialStoreId || '')
  const [storeSearch, setStoreSearch] = useState('')
  const [storeOpen, setStoreOpen] = useState(false)
  const storeBoxRef = useRef<HTMLDivElement | null>(null)

  // Close the dropdown when the user clicks outside the picker.
  useEffect(() => {
    if (!storeOpen) return
    const onDocClick = (e: MouseEvent) => {
      if (storeBoxRef.current && !storeBoxRef.current.contains(e.target as Node)) {
        setStoreOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [storeOpen])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch('/api/appointments/store-options', { headers: await authHeaders() })
        const j = await r.json().catch(() => ({}))
        if (cancelled) return
        if (!r.ok) {
          setStoresLoaded(true)
          return
        }
        const list: StoreOption[] = j.stores || []
        setStores(list)
        setStoresLoaded(true)

        // Smart default: if the click context didn't pre-select a store,
        // prefer (in order):
        //   1. Store with a current event where the user is assigned
        //   2. Any store with a current event in progress
        //   3. Leave blank — the empty-state message in the preview
        //      pane prompts the user to pick.
        if (!storeId) {
          const myActive = list.find(s => s.user_is_assigned && s.is_event_in_progress)
          const anyActive = list.find(s => s.is_event_in_progress)
          const next = myActive || anyActive
          if (next) setStoreId(next.id)
        }
      } catch {
        if (!cancelled) setStoresLoaded(true)
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selectedStore = useMemo(
    () => stores.find(s => s.id === storeId) || null,
    [stores, storeId],
  )

  const filteredStores = useMemo(() => {
    const q = storeSearch.trim().toLowerCase()
    if (!q) return stores
    return stores.filter(s => {
      const hay = `${s.name} ${s.city || ''} ${s.state || ''}`.toLowerCase()
      return hay.includes(q)
    })
  }, [stores, storeSearch])

  const storeDisplayLabel = (s: StoreOption | null): string =>
    s ? `${s.name}${s.city ? ` — ${s.city}${s.state ? ', ' + s.state : ''}` : ''}` : ''

  // Step 2 — day mode
  const [dayMode, setDayMode] = useState<'single' | 'all'>('single')
  const [singleDate, setSingleDate] = useState<string>(initialDate || '')

  // Once stores load, default the date dropdown to either the click
  // context date (if it exists in the store's list) or the first
  // available date.
  useEffect(() => {
    if (!selectedStore) return
    if (singleDate && selectedStore.portal_dates.includes(singleDate)) return
    if (selectedStore.portal_dates.length > 0) {
      setSingleDate(selectedStore.portal_dates[0])
      return
    }
    // Falls back to today if no portal dates (e.g., gcal-only store).
    if (!singleDate) {
      setSingleDate(new Date().toISOString().slice(0, 10))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStore?.id])

  // "All event days" means: every date this store has an appointment on
  // (portal + gcal, already merged server-side into portal_dates). If a
  // formal buying event is registered with event_days, prefer those —
  // otherwise fall back to the union list so stores like Kay Cameron
  // (which book entirely via Google Calendar with no buying-event row)
  // still get a working "All event days" option.
  const allDaysSource: string[] = useMemo(() => {
    if (!selectedStore) return []
    const eventDays = selectedStore.event_window?.days || []
    if (eventDays.length > 0) return eventDays
    return selectedStore.portal_dates || []
  }, [selectedStore])

  const effectiveDates: string[] = useMemo(() => {
    if (!selectedStore) return []
    if (dayMode === 'all') return [...allDaysSource]
    return singleDate ? [singleDate] : []
  }, [dayMode, selectedStore, singleDate, allDaysSource])

  // PDF preview blob
  const [pdfObjectUrl, setPdfObjectUrl] = useState<string | null>(null)
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null)
  const [pdfErr, setPdfErr] = useState<string | null>(null)

  useEffect(() => {
    if (!storeId || effectiveDates.length === 0) {
      setPdfObjectUrl(null); setPdfBlob(null); setPdfErr(null)
      return
    }
    let cancelled = false
    let createdUrl: string | null = null
    setPdfObjectUrl(null); setPdfBlob(null); setPdfErr(null)
    ;(async () => {
      try {
        const url = `/api/appointments/day-pdf?store_id=${encodeURIComponent(storeId)}&dates=${encodeURIComponent(effectiveDates.join(','))}`
        const res = await fetch(url, { headers: await authHeaders() })
        if (!res.ok) {
          const t = await res.text().catch(() => '')
          if (!cancelled) setPdfErr(`PDF load failed (${res.status}): ${t || res.statusText}`)
          return
        }
        const blob = await res.blob()
        if (cancelled) return
        const obj = URL.createObjectURL(blob)
        createdUrl = obj
        setPdfBlob(blob)
        setPdfObjectUrl(obj)
      } catch (e: any) {
        if (!cancelled) setPdfErr(e?.message || 'PDF load failed')
      }
    })()
    return () => {
      cancelled = true
      if (createdUrl) URL.revokeObjectURL(createdUrl)
    }
  }, [storeId, effectiveDates.join(',')])

  // Step 3 — recipients
  const [storeContacts, setStoreContacts] = useState<PickerOption[]>([])
  const [workers, setWorkers] = useState<PickerOption[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [extraEmails, setExtraEmails] = useState<string[]>([''])
  const [recipientsErr, setRecipientsErr] = useState<string | null>(null)

  useEffect(() => {
    if (!storeId || effectiveDates.length === 0) {
      setStoreContacts([]); setWorkers([]); setPicked(new Set())
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const url = `/api/appointments/day-recipients?store_id=${encodeURIComponent(storeId)}&dates=${encodeURIComponent(effectiveDates.join(','))}`
        const res = await fetch(url, { headers: await authHeaders() })
        const j = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok || j.error) { setRecipientsErr(j.error || `Recipients load failed (${res.status})`); return }
        setRecipientsErr(null)
        setStoreContacts(j.storeContacts || [])
        setWorkers(j.workers || [])
        const initial = new Set<string>()
        for (const c of j.storeContacts || []) initial.add(c.id)
        setPicked(initial)
      } catch (e: any) {
        if (!cancelled) setRecipientsErr(String(e?.message || e))
      }
    })()
    return () => { cancelled = true }
  }, [storeId, effectiveDates.join(',')])

  const togglePick = (id: string) => {
    setPicked(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  const updateExtra = (i: number, v: string) => setExtraEmails(prev => prev.map((e, idx) => idx === i ? v : e))
  const addExtraSlot = () => setExtraEmails(prev => [...prev, ''])
  const removeExtra = (i: number) => setExtraEmails(prev => prev.filter((_, idx) => idx !== i))

  const allOptions: PickerOption[] = [...storeContacts, ...workers]
  const pickedEmails = allOptions.filter(o => picked.has(o.id)).map(o => o.email)
  const extraClean = extraEmails.map(e => e.trim()).filter(Boolean)
  const allRecipients = Array.from(new Set([...pickedEmails, ...extraClean].map(e => e.toLowerCase())))

  // Step 4 — subject + message
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ sent: number; failed: number; errors: { email: string; error: string }[] } | null>(null)

  const send = async () => {
    if (!storeId)               { alert('Pick a store first.'); return }
    if (effectiveDates.length === 0) { alert('Pick a date or "All event days".'); return }
    if (allRecipients.length === 0) { alert('Pick at least one recipient or enter an email.'); return }
    setSending(true); setResult(null)
    try {
      const r = await fetch('/api/appointments/day-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({
          store_id: storeId,
          dates: effectiveDates,
          recipients: allRecipients,
          subject: subject.trim() || undefined,
          message: message.trim() || undefined,
          sender_name: senderName,
        }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error || r.statusText)
      setResult({ sent: j.sent_count || 0, failed: j.failed_count || 0, errors: j.failed || [] })
    } catch (e: any) {
      alert('Send failed: ' + (e?.message || e))
    } finally {
      setSending(false)
    }
  }

  const downloadFromBlob = () => {
    if (!pdfBlob || !selectedStore) return
    const a = document.createElement('a')
    const url = URL.createObjectURL(pdfBlob)
    a.href = url
    const slug = selectedStore.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const tag = effectiveDates.length === 1 ? effectiveDates[0] : `${effectiveDates[0]}_to_${effectiveDates[effectiveDates.length - 1]}`
    a.download = `${slug}-appointments-${tag}.pdf`
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const headerSummary = useMemo(() => {
    if (!selectedStore) return 'Pick a store to begin'
    if (effectiveDates.length === 0) return selectedStore.name
    const range = effectiveDates.length === 1
      ? fmtLong(effectiveDates[0])
      : `${fmtShort(effectiveDates[0])} – ${fmtShort(effectiveDates[effectiveDates.length - 1])}`
    return `${selectedStore.name} · ${range}`
  }, [selectedStore, effectiveDates])

  const allEventDaysLabel = (() => {
    const days = selectedStore?.event_window?.days
    if (!days || days.length === 0) return null
    if (days.length === 1) return fmtShort(days[0])
    return `${fmtShort(days[0])} – ${fmtShort(days[days.length - 1])} (${days.length} days)`
  })()

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={onClose}
    >
      <div
        style={{ background: '#fff', borderRadius: 12, width: 'min(1180px, 100%)', height: '92vh', maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--cream2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 900 }}>📄 Daily Appointments — Preview &amp; Send</div>
            <div style={{ fontSize: 12, color: 'var(--mist)' }}>{headerSummary}</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-outline" onClick={downloadFromBlob} disabled={!pdfBlob}>⬇ Download</button>
            <button className="btn-outline" onClick={onClose}>✕ Close</button>
          </div>
        </div>

        {/* Body */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(440px, 1.55fr) minmax(340px, 1fr)', gap: 0, flex: 1, minHeight: 0 }}>
          {/* PDF preview */}
          <div style={{ borderRight: '1px solid var(--cream2)', background: 'var(--cream)', overflow: 'hidden', position: 'relative' }}>
            {pdfErr && <div style={{ padding: 16, color: '#B22234', fontSize: 13 }}>{pdfErr}</div>}
            {!pdfErr && !pdfObjectUrl && (
              storeId && effectiveDates.length > 0 ? (
                <div style={{ padding: 24, color: 'var(--mist)', fontSize: 13 }}>Rendering preview…</div>
              ) : (
                <div style={{
                  height: '100%', minHeight: 480,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  padding: 24, gap: 10, textAlign: 'center',
                }}>
                  <div style={{ fontSize: 36 }}>📅</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink)' }}>
                    Please choose an event to the right →
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--mist)', maxWidth: 320 }}>
                    Pick a store and a day in the panel on the right to preview the appointment list.
                  </div>
                </div>
              )
            )}
            {pdfObjectUrl && (
              <iframe
                src={pdfObjectUrl}
                title="Daily appointments preview"
                style={{ width: '100%', height: '100%', minHeight: 520, border: 'none', display: 'block' }}
              />
            )}
          </div>

          {/* Sidebar — pickers + recipients */}
          <div style={{ padding: 16, overflowY: 'auto', minHeight: 0 }}>
            {/* Store — search-and-pick combo */}
            <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>
              Store *
            </div>
            <div ref={storeBoxRef} style={{ position: 'relative', marginBottom: 14 }}>
              <input
                type="text"
                value={storeOpen ? storeSearch : (selectedStore ? storeDisplayLabel(selectedStore) : '')}
                onFocus={() => {
                  // Open the dropdown and start with an empty filter so the
                  // user can scan the full list without clearing their pick.
                  setStoreOpen(true)
                  setStoreSearch('')
                }}
                onChange={e => {
                  setStoreOpen(true)
                  setStoreSearch(e.target.value)
                }}
                placeholder={storesLoaded ? 'Search stores…' : 'Loading stores…'}
                style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}
              />
              {storeOpen && storesLoaded && (
                <div
                  style={{
                    position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
                    background: '#fff', border: '1px solid var(--pearl)', borderRadius: 6,
                    boxShadow: '0 6px 20px rgba(0,0,0,0.12)', zIndex: 10,
                    maxHeight: 240, overflowY: 'auto',
                  }}
                >
                  {filteredStores.length === 0 && (
                    <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--mist)', fontStyle: 'italic' }}>
                      No stores match.
                    </div>
                  )}
                  {filteredStores.map(s => {
                    const isSelected = s.id === storeId
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => {
                          setStoreId(s.id)
                          setStoreOpen(false)
                          setStoreSearch('')
                        }}
                        style={{
                          display: 'block', width: '100%', textAlign: 'left',
                          padding: '8px 12px', background: isSelected ? 'var(--green-pale)' : 'transparent',
                          border: 'none', cursor: 'pointer', fontSize: 13,
                          color: 'var(--ink)', borderBottom: '1px solid var(--cream2)',
                        }}
                        onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLButtonElement).style.background = 'var(--cream)' }}
                        onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
                      >
                        <div style={{ fontWeight: 700 }}>{s.name}</div>
                        {(s.city || s.state) && (
                          <div style={{ fontSize: 11, color: 'var(--mist)' }}>
                            {[s.city, s.state].filter(Boolean).join(', ')}
                          </div>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Day mode */}
            <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>
              Day(s) *
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14, padding: 10, background: 'var(--cream2)', borderRadius: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="day-mode"
                  checked={dayMode === 'single'}
                  onChange={() => setDayMode('single')}
                  style={{ width: 16, height: 16, padding: 0, margin: 0 }}
                />
                <span style={{ fontSize: 13, fontWeight: 600 }}>Single day</span>
              </label>
              {dayMode === 'single' && (
                <select
                  value={singleDate}
                  onChange={e => setSingleDate(e.target.value)}
                  style={{ width: 'calc(100% - 24px)', marginLeft: 24, maxWidth: '100%', boxSizing: 'border-box' }}
                  disabled={!selectedStore}
                >
                  {selectedStore?.portal_dates.length === 0 && (
                    <option value={singleDate}>{singleDate ? fmtLong(singleDate) : '—'}</option>
                  )}
                  {(selectedStore?.portal_dates || []).map(d => (
                    <option key={d} value={d}>{fmtLong(d)}</option>
                  ))}
                </select>
              )}
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: allDaysSource.length > 0 ? 'pointer' : 'not-allowed' }}>
                <input
                  type="radio"
                  name="day-mode"
                  checked={dayMode === 'all'}
                  onChange={() => setDayMode('all')}
                  disabled={allDaysSource.length === 0}
                  style={{ width: 16, height: 16, padding: 0, margin: 0 }}
                />
                <span style={{ fontSize: 13, fontWeight: 600, color: allDaysSource.length > 0 ? 'var(--ink)' : 'var(--mist)' }}>
                  All event days
                  {allDaysSource.length > 0 && (
                    <span style={{ fontWeight: 400, color: 'var(--mist)' }}>
                      {' '}· {allDaysSource.length === 1
                        ? fmtShort(allDaysSource[0])
                        : `${fmtShort(allDaysSource[0])} – ${fmtShort(allDaysSource[allDaysSource.length - 1])} (${allDaysSource.length} days)`}
                    </span>
                  )}
                </span>
              </label>
              {selectedStore && allDaysSource.length === 0 && (
                <div style={{ fontSize: 11, color: 'var(--mist)', marginLeft: 24 }}>
                  No appointments yet for this store in the recent window.
                </div>
              )}
              {selectedStore && !selectedStore.event_window && allDaysSource.length > 0 && (
                <div style={{ fontSize: 11, color: 'var(--mist)', marginLeft: 24 }}>
                  No buying event registered — using all upcoming dates with appointments.
                </div>
              )}
            </div>

            {/* Recipients */}
            <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>
              Recipients
            </div>
            {recipientsErr && (
              <div style={{ color: '#B22234', fontSize: 12, marginBottom: 8 }}>Error: {recipientsErr}</div>
            )}

            {storeContacts.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--mist)', textTransform: 'uppercase', marginBottom: 4 }}>Store contacts</div>
                {storeContacts.map(o => (
                  <div key={o.id} style={{ padding: '3px 0' }}>
                    <Checkbox
                      checked={picked.has(o.id)}
                      onChange={() => togglePick(o.id)}
                      label={
                        <span style={{ fontSize: 13 }}>
                          {o.label || o.email}{' '}
                          <span style={{ color: 'var(--mist)' }}>· {o.email}</span>
                        </span>
                      }
                    />
                  </div>
                ))}
              </div>
            )}

            {workers.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--mist)', textTransform: 'uppercase', marginBottom: 4 }}>Buyers on this trip</div>
                {workers.map(o => (
                  <div key={o.id} style={{ padding: '3px 0' }}>
                    <Checkbox
                      checked={picked.has(o.id)}
                      onChange={() => togglePick(o.id)}
                      label={
                        <span style={{ fontSize: 13 }}>
                          {o.label}{' '}
                          <span style={{ color: 'var(--mist)' }}>· {o.email}</span>
                        </span>
                      }
                    />
                  </div>
                ))}
              </div>
            )}

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--mist)', textTransform: 'uppercase', marginBottom: 4 }}>Other emails</div>
              {extraEmails.map((e, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                  <input
                    type="email"
                    placeholder="someone@example.com"
                    value={e}
                    onChange={ev => updateExtra(i, ev.target.value)}
                    style={{ flex: 1 }}
                  />
                  {extraEmails.length > 1 && (
                    <button onClick={() => removeExtra(i)} className="btn-outline btn-xs">✕</button>
                  )}
                </div>
              ))}
              <button onClick={addExtraSlot} className="btn-outline btn-xs">+ Add another</button>
            </div>

            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--mist)', textTransform: 'uppercase' }}>Subject (optional)</label>
              <input
                value={subject}
                onChange={e => setSubject(e.target.value)}
                placeholder={selectedStore && effectiveDates.length > 0
                  ? `${selectedStore.name} — ${effectiveDates.length === 1 ? fmtLong(effectiveDates[0]) : 'event appointments'}`
                  : 'Subject'}
              />
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--mist)', textTransform: 'uppercase' }}>Message (optional)</label>
              <textarea
                value={message}
                onChange={e => setMessage(e.target.value)}
                rows={3}
                placeholder="Quick note for the recipient…"
                style={{ width: '100%', padding: 8, fontFamily: 'inherit', fontSize: 13, border: '1px solid var(--pearl)', borderRadius: 6 }}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
              <div style={{ fontSize: 12, color: 'var(--ash)' }}>
                {allRecipients.length === 0
                  ? 'No recipients selected'
                  : `${allRecipients.length} recipient${allRecipients.length === 1 ? '' : 's'}`}
              </div>
              <button
                className="btn-primary"
                disabled={sending || !storeId || effectiveDates.length === 0 || allRecipients.length === 0}
                onClick={send}
              >
                {sending ? 'Sending…' : '📨 Send PDF'}
              </button>
            </div>

            {result && (
              <div style={{ marginTop: 6, padding: 10, borderRadius: 8, background: result.failed === 0 ? '#E6F4EC' : '#FFF7E6', fontSize: 12 }}>
                <div style={{ fontWeight: 700 }}>
                  {result.sent} sent{result.failed > 0 ? `, ${result.failed} failed` : ''}
                </div>
                {result.errors.length > 0 && (
                  <ul style={{ margin: '6px 0 0', paddingLeft: 16, color: '#B45309' }}>
                    {result.errors.map((er, i) => (
                      <li key={i}>{er.email} — {er.error}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
