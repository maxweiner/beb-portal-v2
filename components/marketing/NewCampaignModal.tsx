'use client'

// Modal for creating a new marketing campaign — used in two places:
//   1. CampaignsList "+ New Campaign" button (event picker enabled)
//   2. Events page post-create prompt (lockedEvent prop pins the event)
//
// Validates the unique (event_id, flow_type) constraint server-side
// and surfaces a friendly "campaign already exists" message with a
// "Open existing" jump link.

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import type { Event, MarketingFlowType } from '@/types'

const FLOW_OPTIONS: { value: MarketingFlowType; label: string; emoji: string; description: string }[] = [
  { value: 'vdp',       label: 'VDP',       emoji: '📬', description: 'Variable-data print mailers (zip targeted)' },
  { value: 'postcard',  label: 'Postcard',  emoji: '📮', description: 'Address-list postcards (CSV upload)' },
  { value: 'newspaper', label: 'Newspaper', emoji: '📰', description: 'Print ad in a publication' },
]

type TimeFilter = 'all' | '0-60' | '60-90' | '91+'
const TIME_FILTER_OPTIONS: { value: TimeFilter; label: string }[] = [
  { value: 'all',   label: 'All' },
  { value: '0-60',  label: '0-60 days' },
  { value: '60-90', label: '60-90 days' },
  { value: '91+',   label: '91+ days' },
]
// Note: newspaper campaigns reach Proofing / Payment / Done normally,
// but the Planning section currently shows a "Newspaper flow is out of
// scope for v1" placeholder until that flow's planning UI is built.

export default function NewCampaignModal({
  open, onClose, onCreated,
  lockedEvent, lockedFlow,
}: {
  open: boolean
  onClose: () => void
  onCreated: (campaignId: string) => void
  /** When set, the event picker is hidden + this event is used. */
  lockedEvent?: Event | null
  /** When set, the flow picker is hidden + this flow is used. */
  lockedFlow?: MarketingFlowType
}) {
  const { events, stores } = useApp()
  const [eventId, setEventId] = useState<string>(lockedEvent?.id || '')
  const [flow, setFlow] = useState<MarketingFlowType>(lockedFlow || 'vdp')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [existingId, setExistingId] = useState<string | null>(null)
  const [eventSearch, setEventSearch] = useState('')
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all')
  // Lookup of campaigns that already exist, keyed by `${event_id}::${flow_type}`.
  // Lets us flag duplicate-target rows with a ✓ badge and swap the submit
  // button to "Open existing →" so the user goes straight to the campaign
  // instead of the create → server-bounce → "open existing" round-trip.
  const [existingByKey, setExistingByKey] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    if (open) {
      setEventId(lockedEvent?.id || '')
      setFlow(lockedFlow || 'vdp')
      setEventSearch('')
      setTimeFilter('all')
      setError(null); setExistingId(null); setBusy(false)
    }
  }, [open, lockedEvent?.id, lockedFlow])

  // Fetch all existing campaigns whenever the modal opens. The set is
  // small (hundreds at most), so one shot beats per-row lookups.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    ;(async () => {
      const { data } = await supabase.from('marketing_campaigns')
        .select('id, event_id, flow_type')
      if (cancelled) return
      const map = new Map<string, string>()
      for (const c of (data || []) as Array<{ id: string; event_id: string; flow_type: MarketingFlowType }>) {
        map.set(`${c.event_id}::${c.flow_type}`, c.id)
      }
      setExistingByKey(map)
    })()
    return () => { cancelled = true }
  }, [open])

  const selectedExistingId = eventId ? existingByKey.get(`${eventId}::${flow}`) : undefined

  const eventLabel = (ev: Event) => {
    const store = stores.find(s => s.id === ev.store_id)
    const name = store?.name || ev.store_name || '(unknown)'
    return `${name} · ${ev.start_date}`
  }

  // Sort: upcoming events first (soonest first), then past events
  // (most recent past first). Biases the dropdown toward what the
  // user is most likely planning a fresh campaign for. Search box
  // narrows the dropdown by store name; when empty, cap to 50 so
  // the dropdown stays usable. Optional time-bucket filter (0-60 /
  // 60-90 / 91+ days out) trims to the relevant planning window
  // before sort + search. Filter excludes past events (only 'all'
  // shows them).
  const eventOptions = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    const todayMs = new Date(today + 'T00:00:00Z').getTime()
    const daysOut = (d: string) =>
      Math.round((new Date(d + 'T00:00:00Z').getTime() - todayMs) / 86400000)
    const inTimeRange = (d: string): boolean => {
      if (timeFilter === 'all') return true
      const days = daysOut(d)
      if (timeFilter === '0-60')  return days >= 0  && days <= 60
      if (timeFilter === '60-90') return days >= 61 && days <= 90
      if (timeFilter === '91+')   return days >= 91
      return true
    }
    const sorted = events
      .filter(e => !!e.start_date && inTimeRange(e.start_date))
      .sort((a, b) => {
        const aFuture = a.start_date >= today
        const bFuture = b.start_date >= today
        if (aFuture !== bFuture) return aFuture ? -1 : 1
        // Both future → soonest first. Both past → most recent first.
        return aFuture
          ? (a.start_date < b.start_date ? -1 : 1)
          : (a.start_date > b.start_date ? -1 : 1)
      })
    const q = eventSearch.trim().toLowerCase()
    if (!q) return sorted.slice(0, 50)
    return sorted.filter(ev => {
      const store = stores.find(s => s.id === ev.store_id)
      const name = (store?.name || ev.store_name || '').toLowerCase()
      return name.includes(q)
    }).slice(0, 100)
  }, [events, stores, eventSearch, timeFilter])

  if (!open) return null

  async function create() {
    setBusy(true); setError(null); setExistingId(null)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess.session?.access_token
      const res = await fetch('/api/marketing/campaigns/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ event_id: eventId, flow_type: flow }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error || `Failed (${res.status})`)
        if (json.existing_campaign_id) setExistingId(json.existing_campaign_id)
      } else {
        onCreated(json.campaign?.id)
      }
    } catch (e: any) { setError(e?.message || 'Network error') }
    setBusy(false)
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 12, maxWidth: 480, width: '100%',
        padding: 20, boxShadow: '0 16px 48px rgba(0,0,0,.25)',
      }}>
        <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--ink)', marginBottom: 4 }}>
          New Marketing Campaign
        </div>
        <div style={{ fontSize: 12, color: 'var(--mist)', marginBottom: 16 }}>
          Pick an event and a flow type. One campaign per (event, flow).
        </div>

        {/* Event picker — hidden when locked */}
        {!lockedEvent && (
          <div className="field" style={{ marginBottom: 14 }}>
            <label className="fl">Event</label>
            {/* Time-bucket filter — narrows the list to a planning window before search */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
              {TIME_FILTER_OPTIONS.map(opt => {
                const sel = timeFilter === opt.value
                return (
                  <button key={opt.value} type="button" onClick={() => setTimeFilter(opt.value)} style={{
                    fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 14,
                    border: `1px solid ${sel ? 'var(--green)' : 'var(--pearl)'}`,
                    background: sel ? 'var(--green-pale)' : '#fff',
                    color: sel ? 'var(--green-dark)' : 'var(--ash)',
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                    {opt.label}
                  </button>
                )
              })}
            </div>
            <input type="text" value={eventSearch} onChange={e => setEventSearch(e.target.value)}
              placeholder="Search store name… (or scroll the list below)"
              style={{ width: '100%', fontSize: 13 }} />
            <div style={{
              marginTop: 6, maxHeight: 220, overflowY: 'auto',
              border: '1px solid var(--pearl)', borderRadius: 8,
              background: '#fff',
            }}>
              {eventOptions.length === 0 ? (
                <div style={{ padding: 12, fontSize: 12, color: 'var(--mist)', textAlign: 'center', fontStyle: 'italic' }}>
                  {eventSearch.trim()
                    ? `No events match "${eventSearch.trim()}".`
                    : timeFilter !== 'all'
                      ? 'No events in this range.'
                      : 'No events found.'}
                </div>
              ) : eventOptions.map((ev, i) => {
                const sel = eventId === ev.id
                const hasExisting = existingByKey.has(`${ev.id}::${flow}`)
                return (
                  <button key={ev.id} type="button" onClick={() => setEventId(ev.id)} style={{
                    display: 'flex', width: '100%', textAlign: 'left',
                    alignItems: 'center', justifyContent: 'space-between', gap: 8,
                    whiteSpace: 'normal',
                    padding: '8px 12px',
                    border: 'none',
                    borderBottom: i < eventOptions.length - 1 ? '1px solid var(--cream2)' : 'none',
                    borderRadius: 0,
                    background: sel ? 'var(--green-pale)' : '#fff',
                    color: sel ? 'var(--green-dark)' : (hasExisting ? 'var(--mist)' : 'var(--ink)'),
                    fontWeight: sel ? 800 : 500,
                    cursor: 'pointer', fontFamily: 'inherit', fontSize: 13,
                  }}>
                    <span>
                      {sel && <span style={{ marginRight: 6 }}>✓</span>}
                      {eventLabel(ev)}
                    </span>
                    {hasExisting && (
                      <span title={`A ${flow} campaign already exists for this event`} style={{
                        flexShrink: 0, fontSize: 10, fontWeight: 700,
                        padding: '2px 8px', borderRadius: 10,
                        background: 'var(--cream2)', color: 'var(--ash)',
                        letterSpacing: '.03em',
                      }}>
                        ✓ already exists
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
            {!eventSearch.trim() && eventOptions.length === 50 && (
              <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 4, fontStyle: 'italic' }}>
                Showing 50 — upcoming first, then most-recent past. Type to search older events.
              </div>
            )}
          </div>
        )}
        {lockedEvent && (
          <div style={{
            marginBottom: 14, padding: '8px 12px',
            background: 'var(--cream)', border: '1px solid var(--pearl)', borderRadius: 8,
            fontSize: 13, color: 'var(--ink)',
          }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 2 }}>
              Event
            </div>
            <div style={{ fontWeight: 700 }}>{eventLabel(lockedEvent)}</div>
          </div>
        )}

        {/* Flow picker — hidden when locked */}
        {!lockedFlow && (
          <div style={{ marginBottom: 16 }}>
            <div className="fl" style={{ marginBottom: 6 }}>Flow type</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {FLOW_OPTIONS.map(opt => {
                const sel = flow === opt.value
                return (
                  <button key={opt.value} onClick={() => setFlow(opt.value)} style={{
                    // Override globals.css button defaults (inline-flex + nowrap)
                    // so the description wraps below the label instead of
                    // pushing the button width off the modal edge.
                    display: 'block', width: '100%', whiteSpace: 'normal',
                    textAlign: 'left', padding: '10px 12px', borderRadius: 8,
                    border: `2px solid ${sel ? 'var(--green)' : 'var(--pearl)'}`,
                    background: sel ? 'var(--green-pale)' : '#fff',
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                    <div style={{ fontWeight: 800, fontSize: 14, color: sel ? 'var(--green-dark)' : 'var(--ink)' }}>
                      {opt.emoji} {opt.label}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 2, lineHeight: 1.3 }}>
                      {opt.description}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {error && (
          <div style={{
            background: 'var(--red-pale)', color: '#7f1d1d',
            border: '1px solid #fecaca', borderRadius: 8,
            padding: '8px 12px', fontSize: 13, marginBottom: 12,
            display: 'flex', flexDirection: 'column', gap: 6,
          }}>
            <div>{error}</div>
            {existingId && (
              <button onClick={() => onCreated(existingId)} style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: 'var(--green-dark)', fontSize: 12, fontWeight: 700,
                textDecoration: 'underline', padding: 0, alignSelf: 'flex-start',
                fontFamily: 'inherit',
              }}>
                Open the existing campaign →
              </button>
            )}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn-outline btn-sm" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn-primary btn-sm"
            onClick={() => selectedExistingId ? onCreated(selectedExistingId) : create()}
            disabled={busy || !eventId || !flow}>
            {busy
              ? 'Creating…'
              : selectedExistingId
                ? 'Open existing →'
                : '+ Create Campaign'}
          </button>
        </div>
      </div>
    </div>
  )
}
