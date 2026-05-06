'use client'

import { useEffect, useState } from 'react'

interface Props {
  eventId: string
  storeName: string
  cityState: string
  heardOptions: string[]
  storeImageUrl: string | null
}

export default function WaitlistJoinClient({ eventId, storeName, cityState, heardOptions, storeImageUrl }: Props) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [itemCount, setItemCount] = useState('')
  const [howHeard, setHowHeard] = useState('')
  const [notifyPref, setNotifyPref] = useState<'sms' | 'wait'>('wait')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [entryId, setEntryId] = useState<string | null>(null)
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
      setEntryId(json.id || null)
      setDone(true)
    } finally {
      setSubmitting(false)
    }
  }

  if (done && entryId) {
    return (
      <Wrapper>
        <StoreLogo url={storeImageUrl} alt={storeName} />
        <WaitlistStatusView entryId={entryId} storeName={storeName} />
      </Wrapper>
    )
  }

  return (
    <Wrapper>
      <StoreLogo url={storeImageUrl} alt={storeName} />
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 22, fontWeight: 900, marginBottom: 4 }}>Join the waitlist</h1>
        <div style={{ fontSize: 14, color: '#555' }}>
          <strong>{storeName}</strong>
          {cityState && <> · {cityState}</>}
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
              onChange={() => setNotifyPref('wait')} style={radio} />
            <span><strong>I'll wait here.</strong> Call my name.</span>
          </label>
          <label style={{ ...lbl, opacity: 0.5, cursor: 'not-allowed' }}>
            <input type="radio" name="notify" value="sms" disabled style={radio} />
            <span><strong>Text me.</strong> <em style={{ color: '#888' }}>(Coming Soon!)</em></span>
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

// Polled status view shown after a successful signup. Hits
// /api/waitlist/entry/[id]/status every 10s while the page is
// open so the customer sees their position drop in real time.
function WaitlistStatusView({ entryId, storeName }: { entryId: string; storeName: string }) {
  const [data, setData] = useState<{
    status: string
    position: number | null
    total: number
    queue: { id: string; displayName: string; isYou: boolean; status: 'waiting' | 'called' }[]
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    async function poll() {
      try {
        const res = await fetch(`/api/waitlist/entry/${entryId}/status`)
        const json = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) { setError(json.error || `Failed (${res.status})`); return }
        setError(null)
        setData(json)
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Network error')
      } finally {
        if (!cancelled) timer = setTimeout(poll, 10_000)
      }
    }
    poll()
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
  }, [entryId])

  if (!data) {
    return <div style={{ textAlign: 'center', padding: 20, color: '#666' }}>Loading…</div>
  }

  if (data.status === 'called') {
    return (
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🎉</div>
        <h1 style={{ fontSize: 22, fontWeight: 900, marginBottom: 8, color: '#1D6B44' }}>You're up!</h1>
        <p style={{ fontSize: 15, color: '#333', lineHeight: 1.5 }}>
          Please head over to the buyer table at <strong>{storeName}</strong> now.
        </p>
      </div>
    )
  }

  if (data.status === 'served') {
    return (
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>✓</div>
        <h1 style={{ fontSize: 20, fontWeight: 900, marginBottom: 6 }}>Thanks for visiting!</h1>
        <p style={{ fontSize: 14, color: '#555' }}>You've been served.</p>
      </div>
    )
  }

  if (data.status === 'no_show') {
    return (
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: 20, fontWeight: 900, marginBottom: 6 }}>Marked no-show</h1>
        <p style={{ fontSize: 14, color: '#555' }}>If this is a mistake, please ask staff to put you back on the list.</p>
      </div>
    )
  }

  if (data.status === 'expired') {
    return (
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>🌙</div>
        <h1 style={{ fontSize: 20, fontWeight: 900, marginBottom: 6 }}>Today's waitlist is closed</h1>
        <p style={{ fontSize: 14, color: '#555' }}>The list resets each day at 7pm. Please come back tomorrow.</p>
      </div>
    )
  }

  // status === 'waiting'
  return (
    <div>
      <div style={{ textAlign: 'center', marginBottom: 18 }}>
        <div style={{ fontSize: 12, color: '#666', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '.05em' }}>
          You're number
        </div>
        <div style={{ fontSize: 64, fontWeight: 900, color: '#1D6B44', lineHeight: 1, margin: '4px 0' }}>
          {data.position ?? '—'}
        </div>
        <div style={{ fontSize: 13, color: '#666' }}>
          of {data.total} on the list
        </div>
      </div>

      {error && (
        <div style={{ background: '#fff3e0', color: '#7a4400', padding: 8, borderRadius: 6, fontSize: 12, marginBottom: 12, textAlign: 'center' }}>
          Connection blip — retrying…
        </div>
      )}

      <div style={{ background: '#f7f7f7', borderRadius: 8, padding: 12 }}>
        <div style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '.05em', marginBottom: 6 }}>
          The line
        </div>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {data.queue.map((q, i) => (
            <li key={q.id} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 8px', borderRadius: 6,
              background: q.isYou ? '#e8f5e9' : 'transparent',
              fontWeight: q.isYou ? 800 : 500,
              fontSize: 13,
              color: q.status === 'called' ? '#7a5b00' : '#333',
            }}>
              <span style={{
                minWidth: 20, height: 20, borderRadius: '50%',
                background: q.status === 'called' ? '#d4a017' : (q.isYou ? '#1D6B44' : '#bbb'),
                color: '#fff', fontSize: 10, fontWeight: 800,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}>{q.status === 'called' ? '!' : i + 1}</span>
              <span>{q.displayName}{q.status === 'called' ? ' · being called' : ''}</span>
            </li>
          ))}
        </ul>
      </div>

      <p style={{ fontSize: 11, color: '#888', textAlign: 'center', marginTop: 14 }}>
        This page refreshes automatically. Stay nearby — staff will call your name.
      </p>
    </div>
  )
}

function StoreLogo({ url, alt }: { url: string | null; alt: string }) {
  if (!url) return null
  return (
    <div style={{ textAlign: 'center', marginBottom: 18 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={alt}
        style={{
          maxWidth: 160, maxHeight: 90, height: 'auto', width: 'auto',
          objectFit: 'contain',
        }}
      />
    </div>
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

// globals.css applies width:100%, padding:9px 13px, and
// -webkit-appearance:none to ALL input elements, which destroys
// radios. Restore native radio rendering with explicit overrides.
const radio: React.CSSProperties = {
  width: 20, height: 20, padding: 0, margin: 0, flexShrink: 0,
  border: 'none', background: 'transparent', borderRadius: 0,
  appearance: 'auto', WebkitAppearance: 'radio', MozAppearance: 'radio',
  cursor: 'pointer',
} as React.CSSProperties
