'use client'

// Per-store summary of public event share URLs. Lives in the store
// detail modal right under "Store Portal Access" so the partner can
// mint / send / rotate / revoke URLs for each of a store's upcoming
// events without leaving the store editor.
//
// Mirrors the same control surface as <EventShareUrlPanel /> on the
// per-event staff page (app/event/[id]) — both hit the shared
// /api/event/[id]/share-token endpoint, so behavior stays consistent.

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import type { Event } from '@/types'

interface TokenRow {
  id: string
  event_id: string
  token: string
  last_sent_at: string | null
  last_sent_to: string | null
  view_count: number
  first_viewed_at: string | null
}

interface Props {
  storeId: string
  /** Store's owner_email — used as the default Send recipient. */
  ownerEmail?: string | null
}

async function authHeader(): Promise<string> {
  const s = await supabase.auth.getSession()
  return s.data.session?.access_token || ''
}

// ─── helpers ─────────────────────────────────────────────────
function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function daysBetween(a: string, b: string): number {
  const aMs = new Date(a + 'T12:00:00').getTime()
  const bMs = new Date(b + 'T12:00:00').getTime()
  return Math.floor((bMs - aMs) / 86_400_000)
}
function fmtRange(start: string): string {
  try {
    const s = new Date(start + 'T12:00:00')
    const e = new Date(addDays(start, 2) + 'T12:00:00')
    const sameMonth = s.getMonth() === e.getMonth()
    const startStr = s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    const endStr = sameMonth ? String(e.getDate()) : e.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    return `${startStr}–${endStr}, ${e.getFullYear()}`
  } catch { return start }
}
function phasePill(ev: Event, today: string): { label: string; bg: string; fg: string } {
  if (ev.status === 'cancelled') return { label: 'CANCELLED', bg: '#FEE2E2', fg: '#991B1B' }
  if ((ev as any).status === 'reserved') return { label: 'SAVE THE DATE', bg: '#E5E7EB', fg: '#374151' }
  if (!ev.start_date) return { label: 'TBD', bg: '#F3F4F6', fg: '#6B7280' }
  const start = ev.start_date as string
  const end = addDays(start, 2)
  if (start <= today && today <= end) {
    const day = Math.max(0, Math.min(2, daysBetween(start, today))) + 1
    return { label: `LIVE · DAY ${day}`, bg: '#D1FAE5', fg: '#065F46' }
  }
  if (end < today) {
    const d = daysBetween(end, today)
    return { label: d === 0 ? 'JUST ENDED' : `WRAPPED ${d}d AGO`, bg: '#F3F4F6', fg: '#6B7280' }
  }
  const d = daysBetween(today, start)
  return { label: d === 0 ? 'STARTING SOON' : `IN ${d} DAY${d === 1 ? '' : 'S'}`, bg: '#FEF3C7', fg: '#92400E' }
}

// ─── card ────────────────────────────────────────────────────
export default function StoreEventShareUrlsCard({ storeId, ownerEmail }: Props) {
  const { allEvents } = useApp()
  const today = todayIso()

  // Slice to this store's events, sorted by start_date ASC. Hide
  // events that ended >60 days ago to keep the list tight; nothing
  // useful happens to a share URL that's been past for that long.
  const storeEvents = useMemo(() => {
    return allEvents
      .filter(e => e.store_id === storeId)
      .filter(e => {
        if (!e.start_date) return true
        const end = addDays(e.start_date, 2)
        return daysBetween(end, today) <= 60
      })
      .sort((a, b) => (a.start_date || '').localeCompare(b.start_date || ''))
  }, [allEvents, storeId, today])

  const [tokens, setTokens] = useState<Record<string, TokenRow>>({})
  const [loading, setLoading] = useState(true)

  async function reload() {
    if (storeEvents.length === 0) { setLoading(false); return }
    setLoading(true)
    const eventIds = storeEvents.map(e => e.id)
    const { data } = await supabase
      .from('event_share_tokens')
      .select('id, event_id, token, last_sent_at, last_sent_to, view_count, first_viewed_at')
      .in('event_id', eventIds)
      .is('revoked_at', null)
    const map: Record<string, TokenRow> = {}
    for (const r of (data || []) as any[]) map[r.event_id] = r
    setTokens(map)
    setLoading(false)
  }
  useEffect(() => { reload() }, [storeId, storeEvents.length])

  if (storeEvents.length === 0) {
    return (
      <div className="card card-accent" style={{ margin: 0 }}>
        <div className="card-title">📤 Event Share URLs</div>
        <p style={{ color: 'var(--mist)', fontSize: 13, marginBottom: 0 }}>
          No upcoming or recent events for this store. Schedule an event to mint a URL.
        </p>
      </div>
    )
  }

  return (
    <div className="card card-accent" style={{ margin: 0 }}>
      <div className="card-title">📤 Event Share URLs</div>
      <p style={{ color: 'var(--mist)', fontSize: 13, marginTop: -4, marginBottom: 12 }}>
        Public read-only dashboard URLs you can send to the store owner during each event.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {storeEvents.map(ev => (
          <EventRow
            key={ev.id}
            ev={ev}
            token={tokens[ev.id] || null}
            ownerEmail={ownerEmail || null}
            onChange={reload}
            today={today}
            loading={loading}
          />
        ))}
      </div>
    </div>
  )
}

function EventRow({
  ev, token, ownerEmail, onChange, today, loading,
}: {
  ev: Event
  token: TokenRow | null
  ownerEmail: string | null
  onChange: () => Promise<void>
  today: string
  loading: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [recipientOverride, setRecipientOverride] = useState('')

  const pill = phasePill(ev, today)
  const publicUrl = token
    ? (typeof window !== 'undefined' ? `${window.location.origin}/e/${token.token}` : `/e/${token.token}`)
    : ''

  async function call(action: 'mint' | 'rotate' | 'revoke' | 'send', to?: string) {
    setBusy(true); setError(null); setFlash(null)
    try {
      const r = await fetch(`/api/event/${ev.id}/share-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await authHeader()}` },
        body: JSON.stringify({ action, ...(to ? { to } : {}) }),
      })
      const json = await r.json()
      if (!r.ok) {
        setError(json.error || `Failed (${r.status})`)
      } else {
        if (action === 'send' && json.sentTo) {
          setFlash(`✓ Sent to ${json.sentTo}`)
          setRecipientOverride('')
        } else if (action === 'rotate') {
          setFlash('✓ Rotated — old URL no longer works')
        } else if (action === 'revoke') {
          setFlash('✓ Revoked')
        } else if (action === 'mint') {
          setFlash('✓ URL minted')
        }
        await onChange()
      }
    } catch (e: any) {
      setError(e?.message || 'Network error')
    }
    setBusy(false)
  }

  async function copyUrl() {
    if (!publicUrl) return
    try {
      await navigator.clipboard.writeText(publicUrl)
      setFlash('Copied URL to clipboard'); setError(null)
    } catch {
      setError('Could not copy — select manually')
    }
  }

  return (
    <div style={{
      background: '#fff', borderRadius: 8, padding: 12,
      border: '1px solid var(--pearl)',
    }}>
      {/* Row 1: event date + phase pill */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--ink)' }}>
          📅 {ev.start_date ? fmtRange(ev.start_date) : 'TBD'}
        </div>
        <span style={{ padding: '2px 8px', borderRadius: 4, background: pill.bg, color: pill.fg, fontWeight: 700, fontSize: 11 }}>
          {pill.label}
        </span>
        <div style={{ flex: 1 }} />
        {token && (
          <div style={{ fontSize: 11, color: 'var(--mist)' }}>
            {token.view_count > 0 ? `viewed ${token.view_count}×` : 'not opened yet'}
            {token.last_sent_at && ` · sent ${fmtRel(token.last_sent_at)}`}
          </div>
        )}
      </div>

      {/* Row 2: URL or "no URL" */}
      {token ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: 8, background: '#F9FAFB', borderRadius: 6, marginBottom: 8 }}>
          <code style={{
            flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            fontSize: 12, color: 'var(--ink)',
          }}>{publicUrl}</code>
          <button onClick={copyUrl} className="btn-outline btn-xs">Copy</button>
          <a href={publicUrl} target="_blank" rel="noopener noreferrer" className="btn-outline btn-xs">Open ↗</a>
        </div>
      ) : (
        <div style={{ padding: 8, background: '#F9FAFB', borderRadius: 6, marginBottom: 8, fontSize: 13, color: 'var(--mist)' }}>
          {loading ? 'Loading…' : 'No URL minted for this event yet.'}
        </div>
      )}

      {/* Row 3: actions */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {!token && (
          <button onClick={() => call('mint')} disabled={busy} className="btn-primary btn-sm">
            {busy ? '…' : 'Mint URL'}
          </button>
        )}
        {token && (
          <>
            <input
              type="email"
              value={recipientOverride}
              onChange={e => setRecipientOverride(e.target.value)}
              placeholder={ownerEmail || 'owner email (optional)'}
              style={{ flex: 1, minWidth: 160, fontSize: 12, padding: '5px 8px', border: '1px solid var(--pearl)', borderRadius: 6 }}
            />
            <button
              onClick={() => call('send', recipientOverride.trim() || undefined)}
              disabled={busy || (!recipientOverride.trim() && !ownerEmail)}
              className="btn-primary btn-sm"
              title={!ownerEmail && !recipientOverride.trim() ? 'Set the store\'s owner_email or type one above' : 'Email this URL to the store'}>
              {busy ? '…' : '📤 Send'}
            </button>
            <button onClick={() => {
              if (!confirm('Mint a new URL and invalidate the current one? Whoever has the old link will lose access.')) return
              call('rotate')
            }} disabled={busy} className="btn-outline btn-sm">🔄 Rotate</button>
            <button onClick={() => {
              if (!confirm('Revoke this URL? Whoever has it will see a "revoked" page.')) return
              call('revoke')
            }} disabled={busy} className="btn-outline btn-sm" style={{ color: '#991B1B' }}>Revoke</button>
          </>
        )}
      </div>

      {flash && <div style={{ marginTop: 6, fontSize: 11, color: '#065F46' }}>{flash}</div>}
      {error && <div style={{ marginTop: 6, fontSize: 11, color: '#991B1B' }}>⚠ {error}</div>}
    </div>
  )
}

function fmtRel(iso: string): string {
  try {
    const diffMs = Date.now() - new Date(iso).getTime()
    const mins = Math.round(diffMs / 60_000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.round(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    const days = Math.round(hrs / 24)
    return `${days}d ago`
  } catch { return '' }
}
