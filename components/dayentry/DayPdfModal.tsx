'use client'

// Preview + email-send modal for a buying day. Loads the PDF in an
// iframe (uses the GET /api/events/.../day-pdf/[day] endpoint), shows
// a recipient picker assembled from store contacts + event workers
// + free-form addresses, and posts to /api/events/.../day-email/[day]
// to send. Built as a single modal so the user can preview, tweak
// the recipient list, and send without page-hopping.
//
// Auth: the API routes require a Bearer token. Iframes can't inject
// custom headers, so we fetch the PDF as a Blob and feed an
// object-URL into the iframe.

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import Checkbox from '@/components/ui/Checkbox'

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
  eventId: string
  dayNumber: number | null    // null = full event recap
  storeName: string
  senderName?: string
  onClose: () => void
}

export default function DayPdfModal({ eventId, dayNumber, storeName, senderName, onClose }: Props) {
  const dayParam = dayNumber === null ? 'recap' : String(dayNumber)
  const apiUrl = `/api/events/${eventId}/day-pdf/${dayParam}`

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
        const res = await fetch(`/api/events/${eventId}/day-recipients`, { headers: await authHeaders() })
        const j = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok || j.error) { setLoadErr(j.error || `Recipients load failed (${res.status})`); return }
        setStoreContacts(j.storeContacts || [])
        setWorkers(j.workers || [])
        // Pre-pick all store contacts (the common send-to-store case).
        const initial = new Set<string>()
        for (const c of j.storeContacts || []) initial.add(c.id)
        setPicked(initial)
      } catch (e: any) {
        if (!cancelled) setLoadErr(String(e?.message || e))
      }
    })()
    return () => { cancelled = true }
  }, [eventId])

  const downloadFromBlob = () => {
    if (!pdfBlob) return
    const a = document.createElement('a')
    const url = URL.createObjectURL(pdfBlob)
    a.href = url
    a.download = `${storeName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${dayNumber === null ? 'recap' : `day-${dayNumber}`}.pdf`
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

  const updateExtra = (i: number, v: string) => {
    setExtraEmails(prev => prev.map((e, idx) => idx === i ? v : e))
  }
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
      const r = await fetch(`/api/events/${eventId}/day-email/${dayParam}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(await authHeaders()),
        },
        body: JSON.stringify({
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

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={onClose}
    >
      <div
        style={{ background: '#fff', borderRadius: 12, width: 'min(1100px, 100%)', maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--cream2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 900 }}>📄 Preview &amp; Send PDF</div>
            <div style={{ fontSize: 12, color: 'var(--mist)' }}>
              {storeName} · {dayNumber === null ? 'Full event recap' : `Through Day ${dayNumber}`}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-outline" onClick={downloadFromBlob} disabled={!pdfBlob}>⬇ Download</button>
            <button className="btn-outline" onClick={onClose}>✕ Close</button>
          </div>
        </div>

        {/* Body — split: PDF iframe left, recipients right */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(420px, 1.6fr) minmax(320px, 1fr)', gap: 0, flex: 1, minHeight: 0 }}>
          <div style={{ borderRight: '1px solid var(--cream2)', background: 'var(--cream)', overflow: 'hidden', position: 'relative' }}>
            {pdfErr && (
              <div style={{ padding: 16, color: '#B22234', fontSize: 13 }}>{pdfErr}</div>
            )}
            {!pdfErr && !pdfObjectUrl && (
              <div style={{ padding: 24, color: 'var(--mist)', fontSize: 13 }}>Rendering preview…</div>
            )}
            {pdfObjectUrl && (
              <iframe
                src={pdfObjectUrl}
                title="Day PDF preview"
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
                  <div key={o.id} style={{ padding: '4px 0' }}>
                    <Checkbox
                      checked={picked.has(o.id)}
                      onChange={() => togglePick(o.id)}
                      label={
                        <span style={{ fontSize: 13 }}>
                          {o.label || o.email} <span style={{ color: 'var(--mist)' }}>· {o.email}</span>
                        </span>
                      }
                    />
                  </div>
                ))}
              </div>
            )}

            {workers.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--mist)', textTransform: 'uppercase', marginBottom: 6 }}>Buyers on this event</div>
                {workers.map(o => (
                  <div key={o.id} style={{ padding: '4px 0' }}>
                    <Checkbox
                      checked={picked.has(o.id)}
                      onChange={() => togglePick(o.id)}
                      label={
                        <span style={{ fontSize: 13 }}>
                          {o.label} <span style={{ color: 'var(--mist)' }}>· {o.email}</span>
                        </span>
                      }
                    />
                  </div>
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
              <input value={subject} onChange={e => setSubject(e.target.value)} placeholder={`${storeName} — ${dayNumber === null ? 'Event recap' : `Day ${dayNumber} numbers`}`} />
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
