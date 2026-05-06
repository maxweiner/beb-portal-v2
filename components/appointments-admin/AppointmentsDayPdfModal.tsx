'use client'

// Preview + email-send modal for a store's daily appointment schedule.
// Mirrors the day-numbers modal: split layout — PDF iframe on the left,
// recipient picker on the right (store contacts pre-checked + buyers
// from any event at this store on this date + free-form emails).
//
// Auth: all three endpoints (day-pdf, day-recipients, day-email) require
// `Authorization: Bearer <session jwt>`. Iframes can't inject custom
// headers, so the PDF is fetched here as a Blob with the auth header
// and rendered via URL.createObjectURL into the iframe.

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}
}

interface PickerOption {
  kind: 'store_contact' | 'buyer'
  id: string
  label: string
  email: string
}

interface Props {
  storeId: string
  storeName: string
  date: string             // YYYY-MM-DD
  apptCount: number
  senderName?: string
  onClose: () => void
}

export default function AppointmentsDayPdfModal({ storeId, storeName, date, apptCount, senderName, onClose }: Props) {
  const apiUrl = `/api/appointments/day-pdf?store_id=${encodeURIComponent(storeId)}&date=${encodeURIComponent(date)}`

  const [pdfObjectUrl, setPdfObjectUrl] = useState<string | null>(null)
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null)
  const [pdfErr, setPdfErr] = useState<string | null>(null)

  const [storeContacts, setStoreContacts] = useState<PickerOption[]>([])
  const [workers, setWorkers] = useState<PickerOption[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [extraEmails, setExtraEmails] = useState<string[]>([''])
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ sent: number; failed: number; errors: { email: string; error: string }[] } | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)

  // Fetch PDF as a Blob with the auth header, then mint an object-URL for
  // the <iframe>. Fixes the {"error":"Unauthorized"} the iframe used to
  // get from the day-pdf endpoint (iframes don't send Bearer tokens).
  useEffect(() => {
    let cancelled = false
    let createdUrl: string | null = null
    ;(async () => {
      try {
        const res = await fetch(apiUrl, { headers: await authHeaders() })
        if (!res.ok) {
          const t = await res.text().catch(() => '')
          if (!cancelled) setPdfErr(`PDF load failed (${res.status}): ${t || res.statusText}`)
          return
        }
        const blob = await res.blob()
        if (cancelled) return
        const url = URL.createObjectURL(blob)
        createdUrl = url
        setPdfBlob(blob)
        setPdfObjectUrl(url)
      } catch (e: any) {
        if (!cancelled) setPdfErr(e?.message || 'PDF load failed')
      }
    })()
    return () => {
      cancelled = true
      if (createdUrl) URL.revokeObjectURL(createdUrl)
    }
  }, [apiUrl])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/appointments/day-recipients?store_id=${encodeURIComponent(storeId)}&date=${encodeURIComponent(date)}`, {
          headers: await authHeaders(),
        })
        const j = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok || j.error) { setLoadErr(j.error || `Recipients load failed (${res.status})`); return }
        setStoreContacts(j.storeContacts || [])
        setWorkers(j.workers || [])
        const initial = new Set<string>()
        for (const c of j.storeContacts || []) initial.add(c.id)
        setPicked(initial)
      } catch (e: any) {
        if (!cancelled) setLoadErr(String(e?.message || e))
      }
    })()
    return () => { cancelled = true }
  }, [storeId, date])

  const downloadFromBlob = () => {
    if (!pdfBlob) return
    const a = document.createElement('a')
    const url = URL.createObjectURL(pdfBlob)
    a.href = url
    a.download = `${storeName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-appointments-${date}.pdf`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

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

  const send = async () => {
    if (allRecipients.length === 0) {
      alert('Pick at least one recipient or enter an email.')
      return
    }
    setSending(true)
    setResult(null)
    try {
      const r = await fetch('/api/appointments/day-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(await authHeaders()),
        },
        body: JSON.stringify({
          store_id: storeId,
          date,
          recipients: allRecipients,
          subject: subject.trim() || undefined,
          message: message.trim() || undefined,
          sender_name: senderName,
        }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error || r.statusText)
      setResult({
        sent: j.sent_count || 0,
        failed: j.failed_count || 0,
        errors: j.failed || [],
      })
    } catch (e: any) {
      alert('Send failed: ' + (e?.message || e))
    } finally {
      setSending(false)
    }
  }

  const longDate = new Date(date + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  })

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={onClose}
    >
      <div
        style={{ background: '#fff', borderRadius: 12, width: 'min(1180px, 100%)', maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--cream2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 900 }}>📄 Daily Appointments — Preview &amp; Send</div>
            <div style={{ fontSize: 12, color: 'var(--mist)' }}>
              {storeName} · {longDate} · {apptCount} {apptCount === 1 ? 'appointment' : 'appointments'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-outline" onClick={downloadFromBlob} disabled={!pdfBlob}>⬇ Download</button>
            <button className="btn-outline" onClick={onClose}>✕ Close</button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(460px, 1.7fr) minmax(320px, 1fr)', gap: 0, flex: 1, minHeight: 0 }}>
          <div style={{ borderRight: '1px solid var(--cream2)', background: 'var(--cream)', overflow: 'hidden', position: 'relative' }}>
            {pdfErr && (
              <div style={{ padding: 16, color: '#B22234', fontSize: 13 }}>
                {pdfErr}
              </div>
            )}
            {!pdfErr && !pdfObjectUrl && (
              <div style={{ padding: 24, color: 'var(--mist)', fontSize: 13 }}>
                Rendering preview…
              </div>
            )}
            {pdfObjectUrl && (
              <iframe
                src={pdfObjectUrl}
                title="Daily appointments preview"
                style={{ width: '100%', height: '100%', minHeight: 480, border: 'none', display: 'block' }}
              />
            )}
          </div>

          <div style={{ padding: 18, overflowY: 'auto' }}>
            <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 10, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
              Recipients
            </div>

            {loadErr && <div style={{ color: '#B22234', fontSize: 12, marginBottom: 10 }}>Error: {loadErr}</div>}

            {storeContacts.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--mist)', textTransform: 'uppercase', marginBottom: 6 }}>Store contacts</div>
                {storeContacts.map(o => (
                  <label key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', cursor: 'pointer' }}>
                    <input type="checkbox" checked={picked.has(o.id)} onChange={() => togglePick(o.id)} />
                    <span style={{ fontSize: 13 }}>
                      {o.label || o.email} <span style={{ color: 'var(--mist)' }}>· {o.email}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}

            {workers.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--mist)', textTransform: 'uppercase', marginBottom: 6 }}>Buyers on this trip</div>
                {workers.map(o => (
                  <label key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', cursor: 'pointer' }}>
                    <input type="checkbox" checked={picked.has(o.id)} onChange={() => togglePick(o.id)} />
                    <span style={{ fontSize: 13 }}>
                      {o.label} <span style={{ color: 'var(--mist)' }}>· {o.email}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--mist)', textTransform: 'uppercase', marginBottom: 6 }}>Other emails</div>
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

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--mist)', textTransform: 'uppercase' }}>Subject (optional)</label>
              <input value={subject} onChange={e => setSubject(e.target.value)} placeholder={`${storeName} — ${longDate} appointments`} />
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--mist)', textTransform: 'uppercase' }}>Message (optional)</label>
              <textarea
                value={message}
                onChange={e => setMessage(e.target.value)}
                rows={3}
                placeholder="Quick note for the recipient…"
                style={{ width: '100%', padding: 8, fontFamily: 'inherit', fontSize: 13, border: '1px solid var(--pearl)', borderRadius: 6 }}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
              <div style={{ fontSize: 12, color: 'var(--ash)' }}>
                {allRecipients.length === 0
                  ? 'No recipients selected'
                  : `${allRecipients.length} recipient${allRecipients.length === 1 ? '' : 's'}`}
              </div>
              <button className="btn-primary" disabled={sending || allRecipients.length === 0} onClick={send}>
                {sending ? 'Sending…' : '📨 Send PDF'}
              </button>
            </div>

            {result && (
              <div style={{ marginTop: 8, padding: 10, borderRadius: 8, background: result.failed === 0 ? '#E6F4EC' : '#FFF7E6', fontSize: 12 }}>
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
