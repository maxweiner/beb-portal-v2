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

  useEffect(() => {
    if (open) {
      setEventId(lockedEvent?.id || '')
      setFlow(lockedFlow || 'vdp')
      setEventSearch('')
      setError(null); setExistingId(null); setBusy(false)
    }
  }, [open, lockedEvent?.id, lockedFlow])

  const eventLabel = (ev: Event) => {
    const store = stores.find(s => s.id === ev.store_id)
    const name = store?.name || ev.store_name || '(unknown)'
    return `${name} · ${ev.start_date}`
  }

  // All events sorted newest first. Search box narrows the dropdown
  // by store name; when empty, cap to 50 so the dropdown stays usable.
  const eventOptions = useMemo(() => {
    const sorted = [...events]
      .filter(e => !!e.start_date)
      .sort((a, b) => (a.start_date < b.start_date ? 1 : -1))
    const q = eventSearch.trim().toLowerCase()
    if (!q) return sorted.slice(0, 50)
    return sorted.filter(ev => {
      const store = stores.find(s => s.id === ev.store_id)
      const name = (store?.name || ev.store_name || '').toLowerCase()
      return name.includes(q)
    }).slice(0, 100)
  }, [events, stores, eventSearch])

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
                  {eventSearch.trim() ? `No events match "${eventSearch.trim()}".` : 'No events found.'}
                </div>
              ) : eventOptions.map((ev, i) => {
                const sel = eventId === ev.id
                return (
                  <button key={ev.id} type="button" onClick={() => setEventId(ev.id)} style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    whiteSpace: 'normal',
                    padding: '8px 12px',
                    border: 'none',
                    borderBottom: i < eventOptions.length - 1 ? '1px solid var(--cream2)' : 'none',
                    borderRadius: 0,
                    background: sel ? 'var(--green-pale)' : '#fff',
                    color: sel ? 'var(--green-dark)' : 'var(--ink)',
                    fontWeight: sel ? 800 : 500,
                    cursor: 'pointer', fontFamily: 'inherit', fontSize: 13,
                  }}>
                    {sel && <span style={{ marginRight: 6 }}>✓</span>}
                    {eventLabel(ev)}
                  </button>
                )
              })}
            </div>
            {!eventSearch.trim() && eventOptions.length === 50 && (
              <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 4, fontStyle: 'italic' }}>
                Showing 50 most recent. Type to search older events.
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
          <button className="btn-primary btn-sm" onClick={create}
            disabled={busy || !eventId || !flow}>
            {busy ? 'Creating…' : '+ Create Campaign'}
          </button>
        </div>
      </div>
    </div>
  )
}
