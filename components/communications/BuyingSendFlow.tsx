'use client'

// Buying Communications — send flow. Single-page (not stepped):
//
//   • Event picker — active buying events for the caller's brand,
//     with a search box (store / city / state).
//   • Template picker — active buying_communication_templates.
//   • Editable subject + body. Merge fields render LIVE against
//     real DB context for the selected event + store.
//   • Editable single recipient — pre-filled from stores.owner_email,
//     user can override.
//   • CC user picker — checkbox list of other users in the system.
//     Server resolves user_ids → emails at send time and writes the
//     resolved cc_emails into the log row.
//   • Send button — POST /api/buying-communications/send. The route
//     itself enforces the kill-switch (Settings → Buying Comms →
//     Sending enabled) before anything goes out.
//
// Schedule-send is deferred to phase 3 (matches trunk-side
// roadmap). Email-only; PDF rendering also deferred.

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useApp } from '@/lib/context'
import { applyBuyingMergeFields } from '@/lib/communications/buyingMergeFields'
import type { MergeContext } from '@/lib/communications/mergeFields'
import type { CommunicationTemplate, Event, Store, User } from '@/types'
import Checkbox from '@/components/ui/Checkbox'

interface Props {
  initialEventId?: string | null
  initialTemplateId?: string | null
  onClose: () => void
  onSent: (sendId: string) => void
}

export default function BuyingSendFlow({
  initialEventId, initialTemplateId, onClose, onSent,
}: Props) {
  const { user, users, stores, brand } = useApp()
  const [events, setEvents] = useState<Event[]>([])
  const [templates, setTemplates] = useState<CommunicationTemplate[]>([])
  const [eventId, setEventId] = useState<string>(initialEventId || '')
  const [templateId, setTemplateId] = useState<string>(initialTemplateId || '')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [toEmail, setToEmail] = useState('')
  const [toName, setToName] = useState('')
  const [ccUserIds, setCcUserIds] = useState<string[]>([])
  const [loadingCtx, setLoadingCtx] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [autoFilled, setAutoFilled] = useState(false)
  const [eventSearch, setEventSearch] = useState('')
  const [showCcPicker, setShowCcPicker] = useState(false)

  // Active buying events for the current brand. Past events are
  // hidden — buying-comms is forward-looking. Cancelled excluded.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const todayIso = new Date().toISOString().slice(0, 10)
      // Include events whose 3-day window hasn't ended yet — same
      // logic as the booking payload's earliestStart.
      const cutoff = (() => {
        const d = new Date(todayIso + 'T12:00:00')
        d.setDate(d.getDate() - 3)
        return d.toISOString().slice(0, 10)
      })()
      const [evRes, tplRes] = await Promise.all([
        supabase.from('events')
          .select('id, store_id, start_date, status, brand, workers, store_name')
          .eq('brand', brand)
          .gte('start_date', cutoff)
          .neq('status', 'cancelled')
          .order('start_date', { ascending: true }),
        supabase.from('buying_communication_templates')
          .select('*').eq('is_active', true).order('name'),
      ])
      if (cancelled) return
      setEvents(((evRes.data || []) as unknown) as Event[])
      setTemplates((tplRes.data || []) as CommunicationTemplate[])
    })()
    return () => { cancelled = true }
  }, [brand])

  // Build the buying merge context every time event changes. Pulls
  // store row + assigned buyers (event.workers) + today's date.
  const ctx: MergeContext | null = useMemo(() => {
    if (!eventId) return null
    const ev = events.find(e => e.id === eventId)
    if (!ev) return null
    const store = stores.find(s => s.id === ev.store_id)
    if (!store) return null
    const start = ev.start_date
    const end = start ? addDays(start, 2) : ''
    const startLabel = start ? fmtDateLong(start) : ''
    const endLabel = end ? fmtDateLong(end) : ''
    const rangeLabel = start && end ? fmtDateRange(start, end) : (startLabel || '')
    const workers = (ev.workers as any[] | undefined) || []
    const buyerNames = workers
      .filter(w => !w.deleted)
      .map(w => firstName(w.name))
      .filter(Boolean)
      .join(', ')

    const fullAddress = [
      (store as any).address_1,
      [(store as any).city, (store as any).state, (store as any).zip].filter(Boolean).join(', '),
    ].filter(Boolean).join('\n')

    return {
      store_name:           (store as any).name || '',
      store_address_line_1: (store as any).address_1 || '',
      store_city:           (store as any).city || '',
      store_state:          (store as any).state || '',
      store_zip:            (store as any).zip || '',
      store_full_address:   fullAddress,
      store_contact_name:   (store as any).owner_name || '',
      store_contact_title:  (store as any).owner_title || '',
      event_start_date:     startLabel,
      event_end_date:       endLabel,
      event_dates_range:    rangeLabel,
      buyer_names:          buyerNames,
      today_date:           fmtDateLong(new Date().toISOString().slice(0, 10)),
    }
  }, [eventId, events, stores])

  // When event + template both selected, populate subject/body
  // with merge-applied content and pre-fill recipient from store.
  useEffect(() => {
    if (!eventId || !templateId) return
    const tpl = templates.find(t => t.id === templateId)
    if (!tpl) return
    setLoadingCtx(true)
    try {
      setError(null)
      if (ctx) {
        setSubject(applyBuyingMergeFields(tpl.subject_line, ctx))
        setBody(applyBuyingMergeFields(tpl.body, ctx))
      }
      const ev = events.find(e => e.id === eventId)
      const store = stores.find(s => s.id === ev?.store_id)
      if (store && !autoFilled) {
        setToEmail((store as any).owner_email || '')
        setToName((store as any).owner_name || '')
        setAutoFilled(true)
      }
    } finally {
      setLoadingCtx(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, templateId, templates, ctx])

  // Reset autofill flag when the event changes so the next
  // (event, template) selection refills.
  useEffect(() => { setAutoFilled(false) }, [eventId])

  const filteredEvents = useMemo(() => {
    const q = eventSearch.trim().toLowerCase()
    if (!q) return events
    return events.filter(ev => {
      const store = stores.find(s => s.id === ev.store_id)
      const hay = [
        ev.store_name || (store as any)?.name,
        (store as any)?.city,
        (store as any)?.state,
      ].filter(Boolean).join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [events, eventSearch, stores])

  const ccUsers = useMemo(() => {
    return users
      .filter(u => u.id !== user?.id && !!u.email)
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  }, [users, user?.id])

  const canSend = !!eventId && !!templateId && !!subject.trim() && !!body.trim() && !!toEmail.trim()

  async function send() {
    if (!canSend) return
    setSending(true); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      const res = await fetch('/api/buying-communications/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          event_id: eventId,
          template_id: templateId,
          subject, body,
          to_email: toEmail,
          to_name: toName || null,
          cc_user_ids: ccUserIds,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (json?.sending_disabled) {
          setError('Sends are paused. An admin must enable Buying Comms sending in Settings before letters can go out.')
        } else {
          setError(json?.error || `Send failed (${res.status})`)
        }
        return
      }
      onSent(json.send_id)
    } catch (e: any) {
      setError(e?.message || 'Network error')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="p-6" style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <button onClick={onClose} className="btn-outline btn-xs">← Back</button>
        <h1 style={{ fontSize: 20, fontWeight: 900, color: 'var(--ink)', margin: 0 }}>📤 Send a buying-comm letter</h1>
      </div>

      {error && (
        <div style={{ background: '#fdecea', color: '#7a1f0f', padding: 10, borderRadius: 8, fontSize: 13, marginBottom: 12 }}>{error}</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        {/* Event picker */}
        <div className="card" style={{ padding: 14 }}>
          <div className="field" style={{ marginBottom: 10 }}>
            <label className="fl">Search</label>
            <input
              type="text"
              value={eventSearch}
              onChange={e => setEventSearch(e.target.value)}
              placeholder="Store name, city, state…"
              style={{ width: '100%' }}
            />
          </div>
          <div className="field">
            <label className="fl">Event ({filteredEvents.length} of {events.length})</label>
            <select value={eventId} onChange={e => setEventId(e.target.value)} style={{ width: '100%' }}>
              <option value="">— pick an event —</option>
              {filteredEvents.slice(0, 100).map(ev => {
                const store = stores.find(s => s.id === ev.store_id)
                const label = `${ev.store_name || (store as any)?.name || 'Event'} — ${ev.start_date ? fmtDateShort(ev.start_date) : '?'}`
                return <option key={ev.id} value={ev.id}>{label}</option>
              })}
            </select>
            {filteredEvents.length > 100 && (
              <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 4 }}>
                Showing first 100 — refine your search to see more.
              </div>
            )}
          </div>
        </div>

        {/* Template picker */}
        <div className="card" style={{ padding: 14 }}>
          <div className="field">
            <label className="fl">Template</label>
            <select value={templateId} onChange={e => setTemplateId(e.target.value)} style={{ width: '100%' }}>
              <option value="">— pick a template —</option>
              {templates.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            {templates.length === 0 && (
              <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 6 }}>
                No active templates yet. Go to the list and create one.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Subject + body */}
      <div className="card" style={{ padding: 14, marginTop: 12 }}>
        <div className="field" style={{ marginBottom: 10 }}>
          <label className="fl">Subject</label>
          <input
            value={subject}
            onChange={e => setSubject(e.target.value)}
            disabled={!templateId}
            placeholder={templateId ? '' : '(pick a template first)'}
          />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label className="fl">Body</label>
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            disabled={!templateId}
            rows={14}
            placeholder={templateId ? '' : '(pick a template first)'}
            style={{ width: '100%', fontFamily: 'inherit', fontSize: 14, lineHeight: 1.55, resize: 'vertical' }}
          />
        </div>
        {loadingCtx && (
          <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 6 }}>Loading event context…</div>
        )}
      </div>

      {/* Recipient + CC */}
      <div className="card" style={{ padding: 14, marginTop: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label className="fl">To (email)</label>
            <input
              value={toEmail}
              onChange={e => setToEmail(e.target.value)}
              placeholder="owner@samifinejewelry.com"
            />
            <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 4 }}>
              Pre-filled from store owner email. Edit to override. Comma-separate multiple recipients.
            </div>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label className="fl">To (name)</label>
            <input value={toName} onChange={e => setToName(e.target.value)} placeholder="(optional)" />
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <button
            type="button"
            onClick={() => setShowCcPicker(v => !v)}
            className="btn-outline btn-sm"
          >
            👥 CC other users {ccUserIds.length > 0 ? `(${ccUserIds.length})` : ''}
          </button>
          {showCcPicker && (
            <div style={{
              marginTop: 10, padding: 12,
              background: 'var(--cream)', border: '1px solid var(--pearl)', borderRadius: 8,
              maxHeight: 280, overflowY: 'auto',
            }}>
              <div style={{ fontSize: 11, color: 'var(--mist)', marginBottom: 8 }}>
                Tick to CC. Each CC'd user receives the email separately (clearly marked [cc] in their subject).
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 6 }}>
                {ccUsers.map(u => (
                  <Checkbox
                    key={u.id}
                    checked={ccUserIds.includes(u.id)}
                    onChange={(next) => setCcUserIds(prev =>
                      next ? [...prev, u.id] : prev.filter(x => x !== u.id))}
                    size={16}
                    label={
                      <span style={{ fontSize: 12 }}>
                        <span style={{ fontWeight: 700, color: 'var(--ink)' }}>{u.name || '(no name)'}</span>
                        <span style={{ color: 'var(--mist)', marginLeft: 4 }}>&lt;{u.email}&gt;</span>
                      </span>
                    }
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* From + Send */}
      <div className="card" style={{ padding: 14, marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, color: 'var(--mist)' }}>
          From: <strong style={{ color: 'var(--ink)' }}>{user?.name || user?.email}</strong>{' '}
          <span style={{ color: 'var(--mist)' }}>&lt;{user?.email}&gt;</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} className="btn-outline btn-sm" disabled={sending}>Cancel</button>
          <button onClick={send} disabled={!canSend || sending} className="btn-primary btn-sm">
            {sending ? 'Sending…' : '📤 Send letter'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Helpers ───
function fmtDateLong(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}
function fmtDateShort(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function fmtDateRange(startIso: string, endIso: string): string {
  if (!startIso || !endIso) return ''
  const s = new Date(startIso + 'T12:00:00')
  const e = new Date(endIso + 'T12:00:00')
  const sameMonth = s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()
  const month = s.toLocaleDateString('en-US', { month: 'long' })
  const year = e.getFullYear()
  if (sameMonth) return `${month} ${s.getDate()}–${e.getDate()}, ${year}`
  return `${fmtDateLong(startIso)} – ${fmtDateLong(endIso)}`
}
function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}
function firstName(full: string | null | undefined): string {
  if (!full) return ''
  return full.trim().split(/\s+/)[0]
}
