'use client'

// "View As" history. Renders Max's impersonation_log entries —
// who he viewed as, when, for how long, and the originating IP.
// Visible only to max@bebllp.com via the Settings page; the
// /api/impersonation/log route also hard-rejects anyone else.

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface LogEntry {
  id: string
  target: { id: string; name: string; email: string; role: string }
  startedAt: string
  endedAt: string | null
  ipAddress: string | null
}

function formatDuration(start: string, end: string | null): string {
  const startMs = new Date(start).getTime()
  const endMs = end ? new Date(end).getTime() : Date.now()
  const mins = Math.max(0, Math.floor((endMs - startMs) / 60000))
  if (mins < 1) return '<1 min'
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

export default function ImpersonationLogPanel() {
  const [entries, setEntries] = useState<LogEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await supabase.auth.getSession()
        const token = data.session?.access_token
        const res = await fetch('/api/impersonation/log?limit=100', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
        const json = await res.json()
        if (cancelled) return
        if (!res.ok) { setError(json?.error || `Failed to load (${res.status})`); return }
        setEntries(json.entries || [])
      } catch (err: any) {
        if (cancelled) return
        setError(err?.message || 'Failed to load')
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (error) {
    return <div style={{ padding: 12, color: 'var(--err)', fontSize: 13 }}>{error}</div>
  }
  if (!entries) {
    return <div style={{ padding: 12, color: 'var(--mist)', fontSize: 13 }}>Loading…</div>
  }
  if (entries.length === 0) {
    return <div style={{ padding: 12, color: 'var(--mist)', fontSize: 13 }}>No impersonation history yet.</div>
  }

  return (
    <div style={{ overflow: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ textAlign: 'left', color: 'var(--mist)', borderBottom: '1px solid var(--cream2)' }}>
            <th style={{ padding: '8px 10px', fontWeight: 700 }}>Target</th>
            <th style={{ padding: '8px 10px', fontWeight: 700 }}>Started</th>
            <th style={{ padding: '8px 10px', fontWeight: 700 }}>Duration</th>
            <th style={{ padding: '8px 10px', fontWeight: 700 }}>IP</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(e => (
            <tr key={e.id} style={{ borderBottom: '1px solid var(--cream2)' }}>
              <td style={{ padding: '8px 10px' }}>
                <div style={{ fontWeight: 700 }}>{e.target.name || '(no name)'}</div>
                <div style={{ color: 'var(--mist)', fontSize: 11 }}>{e.target.email} · {e.target.role}</div>
              </td>
              <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                {new Date(e.startedAt).toLocaleString('en-US', {
                  year: 'numeric', month: 'short', day: 'numeric',
                  hour: 'numeric', minute: '2-digit',
                })}
              </td>
              <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                {formatDuration(e.startedAt, e.endedAt)}
                {!e.endedAt && <span style={{ color: 'var(--mist)', marginLeft: 6 }}>· active</span>}
              </td>
              <td style={{ padding: '8px 10px', color: 'var(--mist)', fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}>
                {e.ipAddress || '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
