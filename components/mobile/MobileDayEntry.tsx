'use client'

import { useState, useEffect, useRef } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import { useAutosave, AutosaveIndicator } from '@/lib/useAutosave'

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

export default function MobileDayEntry() {
  const { events, user } = useApp()
  const [selectedEventId, setSelectedEventId] = useState('')
  const [selectedDay, setSelectedDay] = useState(1)
  const [existingEntry, setExistingEntry] = useState<any>(null)
  const [checks, setChecks] = useState<any[]>([emptyCheck()])
  const [customers, setCustomers] = useState('')
  const [sources, setSources] = useState<Record<string, string>>(
    Object.fromEntries(LEAD_SOURCES.map(s => [s.key, '']))
  )
  const [saving, setSaving] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [step, setStep] = useState<'event' | 'data' | 'success'>('event')
  const entryIdRef = useRef<string | null>(null)
  const hydratedRef = useRef(false)

  // Only show events this buyer is assigned to
  const myEvents = events.filter(ev =>
    (ev.workers || []).some((w: any) => w.id === user?.id)
  ).sort((a, b) => b.start_date.localeCompare(a.start_date))

  // Auto-select most recent event
  useEffect(() => {
    if (myEvents.length === 1) setSelectedEventId(myEvents[0].id)
  }, [myEvents.length])

  useEffect(() => {
    if (selectedEventId) loadEntry()
  }, [selectedEventId, selectedDay])

  const loadEntry = async () => {
    hydratedRef.current = false
    const { data } = await supabase.from('buyer_entries')
      .select('*').eq('event_id', selectedEventId)
      .eq('day_number', selectedDay).eq('buyer_id', user?.id).maybeSingle()
    if (data) {
      setExistingEntry(data)
      entryIdRef.current = data.id
      setCustomers(String(data.customers_seen || ''))
      setSources(Object.fromEntries(LEAD_SOURCES.map(s => [s.key, String((data as any)[s.key] || '')])))
      setSubmitted(!!data.submitted_at)
      const { data: chks } = await supabase.from('buyer_checks')
        .select('*').eq('entry_id', data.id).order('created_at')
      setChecks(chks && chks.length > 0 ? chks : [emptyCheck()])
    } else {
      setExistingEntry(null)
      entryIdRef.current = null
      setCustomers('')
      setSources(Object.fromEntries(LEAD_SOURCES.map(s => [s.key, ''])))
      setChecks([emptyCheck()])
      setSubmitted(false)
    }
    setTimeout(() => { hydratedRef.current = true }, 0)
  }

  function emptyCheck() { return { check_number: '', buy_form_number: '', amount: '', payment_type: 'check' } }

  const validChecks = checks.filter(c => c.amount && parseFloat(c.amount) > 0)
  const totalAmount = validChecks.reduce((s, c) => s + parseFloat(c.amount || 0), 0)

  const persist = async (submit: boolean) => {
    const payload = {
      event_id: selectedEventId, day_number: selectedDay, day: selectedDay,
      buyer_id: user?.id, buyer_name: user?.name,
      customers_seen: parseInt(customers) || 0,
      ...Object.fromEntries(LEAD_SOURCES.map(s => [s.key, parseInt(sources[s.key]) || 0])),
      submitted_at: submit ? new Date().toISOString() : existingEntry?.submitted_at || null,
    }
    let entryId = entryIdRef.current
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

    await supabase.from('buyer_checks').delete().eq('entry_id', entryId)
    if (validChecks.length > 0) {
      const { error } = await supabase.from('buyer_checks').insert(validChecks.map(c => ({
        entry_id: entryId!, event_id: selectedEventId,
        check_number: c.check_number, buy_form_number: c.buy_form_number,
        amount: parseFloat(c.amount) || 0, payment_type: c.payment_type,
      })))
      if (error) throw error
    }
  }

  const autosaveStatus = useAutosave(
    { customers, sources, checks },
    async () => { await persist(false) },
    { enabled: !!selectedEventId && hydratedRef.current && !saving, delay: 1000 }
  )

  const submit = async () => {
    setSaving(true)
    try {
      await persist(true)
      setSubmitted(true)
      setStep('success')
    } catch (err: any) {
      alert('Error: ' + (err?.message || 'unknown'))
    }
    setSaving(false)
  }

  const fmt = (ds: string) => new Date(ds + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const selectedEvent = myEvents.find(e => e.id === selectedEventId)

  if (step === 'success') return (
    <div style={{ padding: 24, textAlign: 'center' }}>
      <div style={{ fontSize: 64, marginBottom: 16 }}>✅</div>
      <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink)', marginBottom: 8 }}>Day {selectedDay} Submitted!</div>
      <div style={{ fontSize: 14, color: 'var(--mist)', marginBottom: 8 }}>{selectedEvent?.store_name}</div>
      <div style={{ background: 'var(--green-pale)', borderRadius: 12, padding: 16, marginBottom: 24, border: '1px solid var(--green3)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {[['Customers', customers || '0'], ['Purchases', String(validChecks.length)], ['Amount', `$${totalAmount.toLocaleString()}`], ['Sources', String(Object.values(sources).reduce((s, v) => s + (parseInt(v) || 0), 0))]].map(([l, v]) => (
            <div key={l}>
              <div style={{ fontSize: 10, color: 'var(--green-dark)', fontWeight: 700, textTransform: 'uppercase' }}>{l}</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--green)' }}>{v}</div>
            </div>
          ))}
        </div>
      </div>
      <button onClick={() => { setStep('event'); setSelectedEventId(''); setSelectedDay(1) }}
        style={{ width: '100%', padding: 14, borderRadius: 12, border: 'none', background: 'var(--sidebar-bg)', color: '#fff', fontWeight: 900, fontSize: 16, cursor: 'pointer' }}>
        Enter Another Day
      </button>
    </div>
  )

  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ fontSize: 20, fontWeight: 900, color: 'var(--ink)', marginBottom: 16 }}>📝 Enter Day Data</h2>

      {/* Event + Day selector */}
      <div style={{ background: 'var(--cream)', borderRadius: 12, padding: 16, marginBottom: 16, border: '1px solid var(--pearl)' }}>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--mist)', display: 'block', marginBottom: 6 }}>Event</label>
          <select value={selectedEventId} onChange={e => setSelectedEventId(e.target.value)} style={{ width: '100%', padding: '10px 12px', fontSize: 15 }}>
            <option value="">Select event…</option>
            {myEvents.map(ev => <option key={ev.id} value={ev.id}>{ev.store_name} — {fmt(ev.start_date)}</option>)}
          </select>
        </div>
        {selectedEventId && (
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--mist)', display: 'block', marginBottom: 6 }}>Day</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {[1, 2, 3].map(d => (
                <button key={d} onClick={() => setSelectedDay(d)} style={{
                  flex: 1, padding: '10px 0', borderRadius: 8, border: `2px solid ${selectedDay === d ? 'var(--green)' : 'var(--pearl)'}`,
                  background: selectedDay === d ? 'var(--green-pale)' : 'var(--cream2)',
                  color: selectedDay === d ? 'var(--green-dark)' : 'var(--ash)',
                  fontWeight: 700, fontSize: 15, cursor: 'pointer',
                }}>Day {d}</button>
              ))}
            </div>
          </div>
        )}
      </div>

      {selectedEventId && (
        <>
          {submitted && (
            <div style={{ background: 'var(--green-pale)', border: '1px solid var(--green3)', borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: 'var(--green-dark)', fontWeight: 600 }}>
              ✓ Day {selectedDay} already submitted. You can edit and re-submit.
            </div>
          )}

          {/* Customers */}
          <div style={{ background: 'var(--cream)', borderRadius: 12, padding: 16, marginBottom: 12, border: '1px solid var(--pearl)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--mist)', margin: 0 }}>Customers Seen</label>
              <AutosaveIndicator status={autosaveStatus} />
            </div>
            <input type="number" inputMode="numeric" value={customers} onChange={e => setCustomers(e.target.value)}
              placeholder="0" style={{ width: '100%', fontSize: 28, fontWeight: 900, padding: '8px 0', border: 'none', background: 'transparent', color: 'var(--ink)', outline: 'none' }} />
          </div>

          {/* Checks */}
          <div style={{ background: 'var(--cream)', borderRadius: 12, padding: 16, marginBottom: 12, border: '1px solid var(--pearl)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <div style={{ fontWeight: 900, fontSize: 15, color: 'var(--ink)' }}>Checks & Payments</div>
                {validChecks.length > 0 && <div style={{ fontSize: 12, color: 'var(--green)', marginTop: 2 }}>{validChecks.length} purchases · ${totalAmount.toLocaleString()}</div>}
              </div>
            </div>
            {checks.map((c, i) => (
              <div key={i} style={{ background: 'var(--cream2)', borderRadius: 10, padding: 12, marginBottom: 10, border: '1px solid var(--pearl)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--mist)' }}>#{i + 1}</span>
                  <select value={c.payment_type} onChange={e => setChecks(p => p.map((x, idx) => idx === i ? { ...x, payment_type: e.target.value } : x))}
                    style={{ flex: 1, fontSize: 14, padding: '6px 8px' }}>
                    <option value="check">Check</option>
                    <option value="cash">Cash</option>
                  </select>
                  <button onClick={() => setChecks(p => p.filter((_, idx) => idx !== i))}
                    aria-label={`Remove check ${i + 1}`}
                    style={{ background: 'none', border: 'none', color: 'var(--mist)', fontSize: 22, cursor: 'pointer', padding: 0, width: 44, height: 44, flexShrink: 0 }}>×</button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                  <div>
                    <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--mist)', display: 'block', marginBottom: 4 }}>CHECK #</label>
                    <input type="text" inputMode="numeric" value={c.check_number}
                      onChange={e => setChecks(p => p.map((x, idx) => idx === i ? { ...x, check_number: e.target.value } : x))}
                      placeholder="—" style={{ width: '100%', fontSize: 16, padding: '8px 10px' }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--mist)', display: 'block', marginBottom: 4 }}>BUY FORM #</label>
                    <input type="text" inputMode="numeric" value={c.buy_form_number}
                      onChange={e => setChecks(p => p.map((x, idx) => idx === i ? { ...x, buy_form_number: e.target.value } : x))}
                      placeholder="—" style={{ width: '100%', fontSize: 16, padding: '8px 10px' }} />
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--mist)', display: 'block', marginBottom: 4 }}>AMOUNT</label>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--mist)', fontSize: 18, fontWeight: 700 }}>$</span>
                    <input type="number" inputMode="decimal" value={c.amount}
                      onChange={e => setChecks(p => p.map((x, idx) => idx === i ? { ...x, amount: e.target.value } : x))}
                      placeholder="0.00" style={{ width: '100%', fontSize: 22, fontWeight: 900, padding: '8px 10px 8px 28px' }} />
                  </div>
                </div>
              </div>
            ))}
            <button onClick={() => setChecks(p => [...p, emptyCheck()])}
              style={{ width: '100%', padding: '10px 0', borderRadius: 8, border: '2px dashed var(--pearl)', background: 'transparent', color: 'var(--mist)', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
              + Add Check
            </button>
          </div>

          {/* Lead sources */}
          <div style={{ background: 'var(--cream)', borderRadius: 12, padding: 16, marginBottom: 20, border: '1px solid var(--pearl)' }}>
            <div style={{ fontWeight: 900, fontSize: 15, color: 'var(--ink)', marginBottom: 12 }}>Lead Sources</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {LEAD_SOURCES.map(s => (
                <div key={s.key}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--mist)', display: 'block', marginBottom: 4, textTransform: 'uppercase' }}>{s.label}</label>
                  <input type="number" inputMode="numeric" value={sources[s.key]}
                    onChange={e => setSources(p => ({ ...p, [s.key]: e.target.value }))}
                    placeholder="0" style={{ width: '100%', fontSize: 18, fontWeight: 700, padding: '8px 10px' }} />
                </div>
              ))}
            </div>
          </div>

              {/* Actions */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <AutosaveIndicator status={autosaveStatus} />
            <button onClick={submit} disabled={saving}
              style={{ flex: 1, padding: 14, borderRadius: 12, border: 'none', background: 'var(--sidebar-bg)', color: '#fff', fontWeight: 900, fontSize: 15, cursor: 'pointer' }}>
              {saving ? 'Saving…' : `✓ Submit Day ${selectedDay}`}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
