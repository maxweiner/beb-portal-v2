'use client'

import { useEffect, useState } from 'react'
import Checkbox from '@/components/ui/Checkbox'

interface Employee { id: string; name: string; email?: string }

interface StatusRow {
  store_employee_id: string | null
  recipient_email: string
  sent_at: string
  opened_at: string | null
}

interface Recipient {
  email: string
  name: string
  employee_id?: string   // null for the store owner
}

export default function WelcomeEmailSender({
  storeId,
  storeName,
  ownerEmail,
  ownerName,
  employees,
}: {
  storeId: string
  storeName: string
  ownerEmail?: string | null
  ownerName?: string | null
  employees: Employee[]
}) {
  const [statusByKey, setStatusByKey] = useState<Map<string, StatusRow>>(new Map())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  // Build the recipient list — owner first (if email), then employees with email
  const recipients: Recipient[] = []
  if (ownerEmail) {
    recipients.push({ email: ownerEmail, name: ownerName || 'there' })
  }
  for (const e of employees) {
    if (e.email) {
      recipients.push({ email: e.email, name: e.name || 'there', employee_id: e.id })
    }
  }
  const keyOf = (r: Recipient) => r.employee_id ?? `owner:${r.email}`

  async function loadStatus() {
    try {
      const res = await fetch(`/api/welcome-email/status/${storeId}`)
      if (!res.ok) return
      const json = await res.json()
      const m = new Map<string, StatusRow>()
      for (const row of json.recipients || []) {
        const key = (row.store_employee_id ?? `owner:${row.recipient_email}`).toString()
        m.set(key, row)
      }
      setStatusByKey(m)
    } catch (e) {
      console.error('welcome status fetch failed', e)
    }
  }
  useEffect(() => { loadStatus() /* eslint-disable-line */ }, [storeId])

  function toggle(key: string) {
    setSelected(prev => {
      const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n
    })
  }
  function selectAll() { setSelected(new Set(recipients.map(keyOf))) }
  function clearAll()  { setSelected(new Set()) }

  async function send() {
    if (selected.size === 0) return
    setSending(true); setError(null); setResult(null)
    try {
      const payload = recipients.filter(r => selected.has(keyOf(r)))
      const res = await fetch('/api/welcome-email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store_id: storeId, recipients: payload }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error || `Send failed (${res.status})`)
      } else {
        setResult(`✓ Sent to ${json.sent ?? payload.length} recipient${(json.sent ?? payload.length) === 1 ? '' : 's'}`)
        setSelected(new Set())
        await loadStatus()
      }
    } catch (e: any) {
      setError(e?.message || 'Network error')
    }
    setSending(false)
  }

  return (
    <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--pearl)' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ash)', marginBottom: 6 }}>
        Welcome / Onboarding Email
      </div>
      <p style={{ fontSize: 12, color: 'var(--mist)', marginBottom: 10 }}>
        Sends the editable welcome template (Notification Templates → Email Welcome) with the store's portal link and "Add to Home Screen" instructions. Pick recipients below.
      </p>

      {recipients.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--mist)' }}>
          No recipients with an email yet — set the store's owner email or add employees with email addresses.
        </p>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--mist)' }}>
              {selected.size} of {recipients.length} selected
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={selectAll} className="btn-outline btn-xs">Select all</button>
              <button onClick={clearAll} className="btn-outline btn-xs">Clear</button>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 0, border: '1px solid var(--pearl)', borderRadius: 'var(--r)', background: 'white' }}>
            {recipients.map(r => {
              const key = keyOf(r)
              const status = statusByKey.get(key)
              return (
                <div key={key} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 12px', borderBottom: '1px solid var(--pearl)',
                }}>
                  <Checkbox checked={selected.has(key)} onChange={() => toggle(key)} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                      {r.name}
                      {!r.employee_id && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 800, color: 'var(--mist)', textTransform: 'uppercase' }}>owner</span>}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--mist)' }}>{r.email}</div>
                  </div>
                  <div style={{ flexShrink: 0, fontSize: 11 }}>
                    {status?.opened_at ? (
                      <span style={{ color: 'var(--green-dark)', fontWeight: 700 }}>
                        ✓ Opened {new Date(status.opened_at).toLocaleDateString()}
                      </span>
                    ) : status?.sent_at ? (
                      <span style={{ color: 'var(--mist)' }}>
                        Sent {new Date(status.sent_at).toLocaleDateString()}
                      </span>
                    ) : (
                      <span style={{ color: '#9CA3AF' }}>Not sent</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {error && (
            <div style={{
              marginTop: 10, padding: 10, borderRadius: 'var(--r)',
              background: '#fee2e2', color: '#991b1b', fontSize: 13,
            }}>
              {error}
            </div>
          )}
          {result && (
            <div style={{
              marginTop: 10, padding: 10, borderRadius: 'var(--r)',
              background: 'var(--green-pale)', color: 'var(--green-dark)', fontSize: 13,
            }}>
              {result}
            </div>
          )}

          <div style={{ marginTop: 10 }}>
            <button onClick={send} disabled={sending || selected.size === 0}
              className="btn-primary btn-sm">
              {sending ? 'Sending…' : `Send welcome email${selected.size > 1 ? `s (${selected.size})` : ''}`}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
