'use client'

import { useState, useEffect, useRef } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'

interface BuyerEntry {
  id: string
  event_id: string
  day_number: number
  buyer_id: string
  buyer_name: string
  customers_seen: number
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
  const { events, users, user, reload } = useApp()
  const isSuperAdmin = user?.role === 'superadmin'
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin'

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

  // Auto-select buyer if not superadmin
  useEffect(() => {
    if (!isSuperAdmin) setSelectedBuyerId(user?.id || '')
  }, [user, isSuperAdmin])

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
      <div className="card mb-5" style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
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

              {/* Individual buyer entry */}
              {selectedBuyerId && eventWorkers.some(w => w.id === selectedBuyerId) && (
                <BuyerEntryForm
                  eventId={selectedEventId}
                  dayNumber={selectedDay}
                  buyerId={selectedBuyerId}
                  buyerName={eventWorkers.find(w => w.id === selectedBuyerId)?.name || ''}
                  existingEntry={myEntry || null}
                  otherBuyers={eventWorkers.filter(w => w.id !== selectedBuyerId)}
                  onSaved={loadBuyerEntries}
                />
              )}

              {selectedBuyerId && !eventWorkers.some(w => w.id === selectedBuyerId) && (
                <div className="card text-center py-8" style={{ color: 'var(--mist)' }}>
                  You are not assigned to this event.
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
  const { user } = useApp()
  const [inputMode, setInputMode] = useState<InputMode>('grid')
  const [customersSeeen, setCustomersSeen] = useState(String(existingEntry?.customers_seen || ''))
  const [sources, setSources] = useState<Record<string, string>>(
    Object.fromEntries(LEAD_SOURCES.map(s => [s.key, String((existingEntry as any)?.[s.key] || '')]))
  )
  const [checks, setChecks] = useState<Omit<BuyerCheck, 'id' | 'entry_id'>[]>([])
  const [loadingChecks, setLoadingChecks] = useState(false)
  const [saving, setSaving] = useState(false)
  const [submitted, setSubmitted] = useState(!!existingEntry?.submitted_at)
  const isSubmitted = submitted

  useEffect(() => {
    setCustomersSeen(String(existingEntry?.customers_seen || ''))
    setSources(Object.fromEntries(LEAD_SOURCES.map(s => [s.key, String((existingEntry as any)?.[s.key] || '')])))
    setSubmitted(!!existingEntry?.submitted_at)
    if (existingEntry?.id) loadChecks(existingEntry.id)
    else setChecks([{ check_number: '', buy_form_number: '', amount: 0, payment_type: 'check', event_id: eventId, created_at: '' } as any])
  }, [existingEntry?.id])

  const loadChecks = async (entryId: string) => {
    setLoadingChecks(true)
    const { data } = await supabase.from('buyer_checks').select('*').eq('entry_id', entryId).order('created_at')
    setChecks(data && data.length > 0 ? data : [emptyCheck()])
    setLoadingChecks(false)
  }

  const emptyCheck = () => ({ check_number: '', buy_form_number: '', amount: '' as any, payment_type: 'check', event_id: eventId })

  const addRows = () => setChecks(p => [...p, emptyCheck(), emptyCheck(), emptyCheck(), emptyCheck(), emptyCheck()])

  const updateCheck = (i: number, field: string, value: string) => {
    setChecks(p => p.map((c, idx) => idx === i ? { ...c, [field]: value } : c))
  }

  const removeCheck = (i: number) => setChecks(p => p.filter((_, idx) => idx !== i))

  const validChecks = checks.filter(c => c.amount && parseFloat(String(c.amount)) > 0)
  const totalAmount = validChecks.reduce((s, c) => s + parseFloat(String(c.amount) || '0'), 0)
  const totalPurchases = validChecks.length

  const save = async (submit: boolean) => {
    setSaving(true)
    try {
      // Refresh session first to prevent auth timeout failures
      await supabase.auth.refreshSession()

      const entryPayload = {
        event_id: eventId, day_number: dayNumber, day: dayNumber,
        buyer_id: buyerId, buyer_name: buyerName,
        customers_seen: parseInt(customersSeeen) || 0,
        ...Object.fromEntries(LEAD_SOURCES.map(s => [s.key, parseInt(sources[s.key]) || 0])),
        submitted_at: submit ? new Date().toISOString() : existingEntry?.submitted_at || null,
      }

      let entryId = existingEntry?.id
      if (entryId) {
        await supabase.from('buyer_entries').update(entryPayload).eq('id', entryId)
      } else {
        const { data } = await supabase.from('buyer_entries').insert(entryPayload).select().single()
        entryId = data?.id
      }

      if (!entryId) { alert('Failed to save entry'); setSaving(false); return }

      // Save checks — delete all and re-insert
      await supabase.from('buyer_checks').delete().eq('entry_id', entryId)
      if (validChecks.length > 0) {
        await supabase.from('buyer_checks').insert(
          validChecks.map(c => ({
            entry_id: entryId,
            event_id: eventId,
            check_number: c.check_number,
            buy_form_number: c.buy_form_number,
            amount: parseFloat(String(c.amount)) || 0,
            payment_type: c.payment_type,
          }))
        )
      }

      // Notify other buyers if submitting
      if (submit && otherBuyers.length > 0) {
        try {
          await fetch('/api/day-entry', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event_id: eventId, day_number: dayNumber, entered_by_name: buyerName, notify_buyers: otherBuyers.map(b => b.id) }),
          })
        } catch (e) { /* non-critical */ }
      }

      setSubmitted(submit)
      onSaved()
      if (submit) alert(`✅ Day ${dayNumber} submitted! ${otherBuyers.length > 0 ? 'Other buyers have been notified.' : ''}`)
    } catch (err: any) {
      alert('Error: ' + err.message)
    }
    setSaving(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
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

      {/* Customers seen + lead sources */}
      <div className="card card-accent" style={{ margin: 0 }}>
        <div className="card-title">Customers & Lead Sources</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div style={{ gridColumn: '1 / -1' }}>
            <label className="fl">Customers Seen Today</label>
            <input type="number" min="0" value={customersSeeen}
              onChange={e => setCustomersSeen(e.target.value)}
              placeholder="0" style={{ maxWidth: 160 }} />
          </div>
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
                  {['#', 'Type', 'Check #', 'Buy Form #', 'Amount', ''].map(h => (
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
            </div>
          )}
        </div>
      </div>

      {/* Save / Submit */}
      <div style={{ display: 'flex', gap: 10 }}>
        <button className="btn-outline" onClick={() => save(false)} disabled={saving} style={{ flex: 1 }}>
          {saving ? 'Saving…' : 'Save Draft'}
        </button>
        <button className="btn-primary" onClick={() => save(true)} disabled={saving} style={{ flex: 2 }}>
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
  const existing = event.days?.find((d: any) => d.day_number === dayNumber)
  const n = (v: string) => parseInt(v) || 0

  const [form, setForm] = useState({
    customers: String(existing?.customers || ''),
    purchases: String(existing?.purchases || ''),
    dollars10: String(existing?.dollars10 || ''),
    dollars5: String(existing?.dollars5 || ''),
    ...Object.fromEntries(LEAD_SOURCES.map(s => [s.key, String((existing as any)?.[s.key] || '')])),
  })
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    await supabase.auth.refreshSession()
    const payload = {
      event_id: event.id, day_number: dayNumber, day: dayNumber,
      customers: n(form.customers), purchases: n(form.purchases),
      dollars10: n(form.dollars10), dollars5: n(form.dollars5),
      ...Object.fromEntries(LEAD_SOURCES.map(s => [s.key, n((form as any)[s.key])])),
      entered_by: user?.id, entered_by_name: user?.name,
      entered_at: new Date().toISOString(),
    }
    if (existing) {
      const { error } = await supabase.from('event_days').update(payload).eq('id', existing.id)
      if (error) { alert('Error: ' + error.message); setSaving(false); return }
    } else {
      const { error } = await supabase.from('event_days').insert(payload)
      if (error) { alert('Error: ' + error.message); setSaving(false); return }
    }
    setSaving(false)
    onSaved()
    alert('✅ Combined day data saved!')
  }

  const field = (label: string, key: string) => (
    <div key={key}>
      <label className="fl">{label}</label>
      <input type="number" min="0" value={(form as any)[key]}
        onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))} placeholder="0" />
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card card-accent" style={{ margin: 0, border: '2px solid var(--green3)' }}>
        <div className="card-title">Combined Day {dayNumber} Data</div>
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
      <button className="btn-primary" onClick={save} disabled={saving}>
        {saving ? 'Saving…' : `Save Combined Day ${dayNumber} Data`}
      </button>
    </div>
  )
}
