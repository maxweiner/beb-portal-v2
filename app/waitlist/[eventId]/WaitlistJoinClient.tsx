'use client'

import { useState } from 'react'

interface Props {
  eventId: string
  storeName: string
  cityState: string
  heardOptions: string[]
}

export default function WaitlistJoinClient({ eventId, storeName, cityState, heardOptions }: Props) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [itemCount, setItemCount] = useState('')
  const [howHeard, setHowHeard] = useState('')
  const [notifyPref, setNotifyPref] = useState<'sms' | 'wait'>('wait')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!name.trim() || !phone.trim() || !itemCount.trim()) {
      setError('Name, phone, and number of items are required.')
      return
    }
    const items = Number(itemCount)
    if (!Number.isFinite(items) || items < 0) {
      setError('Number of items must be a non-negative number.')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch(`/api/waitlist/${eventId}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim(),
          item_count: items,
          how_heard: howHeard || null,
          notify_pref: notifyPref,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error || `Failed (${res.status})`)
        return
      }
      setDone(true)
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <Wrapper>
        <div style={{ fontSize: 36, marginBottom: 12 }}>✓</div>
        <h1 style={{ fontSize: 22, fontWeight: 900, marginBottom: 8 }}>You're on the list!</h1>
        <p style={{ fontSize: 14, color: '#555', lineHeight: 1.5 }}>
          {notifyPref === 'sms'
            ? `We'll text you at ${phone} when it's your turn.`
            : "Please stay nearby — we'll call your name when it's your turn."}
        </p>
      </Wrapper>
    )
  }

  return (
    <Wrapper>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 22, fontWeight: 900, marginBottom: 4 }}>Join the waitlist</h1>
        <div style={{ fontSize: 14, color: '#555' }}>
          <strong>{storeName}</strong>
          {cityState && <> · {cityState}</>}
        </div>
        <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
          Today only — list resets at 7pm.
        </div>
      </div>

      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="Your name">
          <input value={name} onChange={e => setName(e.target.value)} required
            autoComplete="name"
            style={inp} />
        </Field>
        <Field label="Phone">
          <input value={phone} onChange={e => setPhone(e.target.value)} required
            type="tel" autoComplete="tel" inputMode="tel"
            placeholder="(555) 123-4567"
            style={inp} />
        </Field>
        <Field label="How many items are you bringing?">
          <input value={itemCount} onChange={e => setItemCount(e.target.value)} required
            type="number" min="0" inputMode="numeric"
            style={inp} />
        </Field>
        <Field label="How did you hear about us?">
          <select value={howHeard} onChange={e => setHowHeard(e.target.value)} style={inp as any}>
            <option value="">— Select —</option>
            {heardOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        </Field>

        <fieldset style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12, margin: 0 }}>
          <legend style={{ fontSize: 13, fontWeight: 700, padding: '0 6px' }}>When you're up next…</legend>
          <label style={lbl}>
            <input type="radio" name="notify" value="wait" checked={notifyPref === 'wait'}
              onChange={() => setNotifyPref('wait')} />
            <span><strong>I'll wait here.</strong> Call my name.</span>
          </label>
          <label style={lbl}>
            <input type="radio" name="notify" value="sms" checked={notifyPref === 'sms'}
              onChange={() => setNotifyPref('sms')} />
            <span><strong>Text me.</strong> I might step out for a bit.</span>
          </label>
        </fieldset>

        {error && (
          <div style={{ background: '#fee', color: '#a00', padding: 10, borderRadius: 8, fontSize: 13 }}>{error}</div>
        )}

        <button type="submit" disabled={submitting}
          style={{
            background: '#1D6B44', color: '#fff', border: 'none',
            padding: '14px 18px', borderRadius: 8,
            fontSize: 16, fontWeight: 700, cursor: 'pointer',
            opacity: submitting ? 0.6 : 1, minHeight: 50,
          }}>
          {submitting ? 'Joining…' : 'Join the waitlist'}
        </button>
      </form>
    </Wrapper>
  )
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      maxWidth: 480, margin: '0 auto', padding: '24px 16px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <div style={{
        background: '#fff', borderRadius: 14, padding: 24,
        boxShadow: '0 4px 20px rgba(0,0,0,.06)',
      }}>
        {children}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: '#333' }}>{label}</span>
      {children}
    </label>
  )
}

const inp: React.CSSProperties = {
  fontFamily: 'inherit', fontSize: 16,
  padding: '12px 12px', borderRadius: 8,
  border: '1px solid #ccc', background: '#fff',
  minHeight: 48,
}

const lbl: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10,
  padding: '8px 0', fontSize: 14, cursor: 'pointer',
}
