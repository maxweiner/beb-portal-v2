'use client'

// Superadmin-only Settings panel for ad-hoc Google Calendar events.
// Lets the operator drop a one-off entry into either a brand
// buying-events calendar (BEB or Liberty) or any trunk-rep's
// personal calendar without going through the regular events /
// trunk_shows tables.
//
// CRUD flows mirror how regular events sync: create / edit / delete
// in the portal → Google reflects the change. We do this
// synchronously via /api/gcal-adhoc/events* routes (not via the
// gcal_sync_queue) since these are one-off entries with no business
// semantics — no point spending the queue infrastructure.

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useApp } from '@/lib/context'
import CollapsibleCard from '@/components/ui/CollapsibleCard'
import DatePicker from '@/components/ui/DatePicker'

interface AdHocEvent {
  id: string
  title: string
  start_date: string
  end_date: string | null
  description: string | null
  location: string | null
  target_calendar_id: string
  target_label: string
  google_calendar_event_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

interface CalendarOption {
  calendar_id: string
  label: string
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso.length <= 10 ? iso + 'T12:00:00' : iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

async function authedFetch(input: RequestInfo, init: RequestInit = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  return fetch(input, {
    ...init,
    headers: {
      ...(init.headers || {}),
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
}

export default function AdHocGCalEvents() {
  const { user } = useApp()
  const [events, setEvents] = useState<AdHocEvent[]>([])
  const [calendars, setCalendars] = useState<CalendarOption[]>([])
  const [loaded, setLoaded] = useState(false)
  const [editing, setEditing] = useState<AdHocEvent | 'new' | null>(null)
  const [busy, setBusy] = useState(false)

  // Gate to superadmin client-side — matches the API + RLS.
  const isSuper = user?.role === 'superadmin'

  async function loadEvents() {
    const res = await authedFetch('/api/gcal-adhoc/events')
    const json = await res.json().catch(() => ({}))
    if (res.ok) setEvents((json.events || []) as AdHocEvent[])
    setLoaded(true)
  }

  async function loadCalendars() {
    // Brand calendars come from gcal_integration_settings; rep
    // calendars come from users with a trunk_show_calendar_id set.
    // Both are admin-readable via RLS.
    const [brandRes, repsRes] = await Promise.all([
      supabase.from('gcal_integration_settings')
        .select('brand, calendar_id, enabled')
        .not('calendar_id', 'is', null),
      supabase.from('users')
        .select('id, name, trunk_show_calendar_id, is_trunk_rep, active')
        .eq('is_trunk_rep', true).eq('active', true)
        .not('trunk_show_calendar_id', 'is', null)
        .order('name'),
    ])
    const opts: CalendarOption[] = []
    for (const row of (brandRes.data || []) as Array<{ brand: string; calendar_id: string; enabled: boolean }>) {
      if (!row.calendar_id) continue
      const brandLabel = row.brand === 'liberty' ? 'Liberty' : 'Beneficial'
      opts.push({
        calendar_id: row.calendar_id,
        label: `${brandLabel} buying events${row.enabled ? '' : ' (disabled)'}`,
      })
    }
    for (const row of (repsRes.data || []) as Array<{ name: string; trunk_show_calendar_id: string | null }>) {
      if (!row.trunk_show_calendar_id) continue
      opts.push({
        calendar_id: row.trunk_show_calendar_id,
        label: `${row.name || 'Rep'} — trunk shows`,
      })
    }
    setCalendars(opts)
  }

  useEffect(() => {
    if (!isSuper) return
    void loadEvents()
    void loadCalendars()
  }, [isSuper])

  if (!isSuper) return null

  async function deleteEvent(id: string) {
    if (!confirm('Delete this ad-hoc event? It will be removed from Google Calendar too.')) return
    setBusy(true)
    const res = await authedFetch(`/api/gcal-adhoc/events/${id}`, { method: 'DELETE' })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { alert('Delete failed: ' + (json.error || res.status)); return }
    setEvents(p => p.filter(e => e.id !== id))
  }

  return (
    <CollapsibleCard
      storageKey="settings-adhoc-gcal"
      title="📅 Ad-hoc Google Calendar events"
      subtitle="Drop one-off entries into a buying-events or trunk-rep calendar. Edits and deletes mirror to Google."
      topAccent="#1D6B44"
    >
      <div style={{ marginTop: 12 }}>
        <button onClick={() => setEditing('new')} className="btn-primary btn-sm" disabled={calendars.length === 0}>
          + New ad-hoc event
        </button>
        {calendars.length === 0 && (
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--mist)' }}>
            No target calendars configured yet. Set a brand calendar at the top of this page, or a trunk-rep calendar in Admin Panel.
          </div>
        )}
      </div>

      {loaded && events.length > 0 && (
        <div style={{ marginTop: 14, border: '1px solid var(--pearl)', borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--cream2)' }}>
                {['Title', 'When', 'Calendar', 'Where', ''].map(h => (
                  <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontSize: 10, fontWeight: 800, color: 'var(--mist)', textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {events.map(e => (
                <tr key={e.id} style={{ borderTop: '1px solid var(--pearl)' }}>
                  <td style={{ padding: '8px 10px', fontWeight: 700 }}>{e.title}</td>
                  <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', color: 'var(--mist)' }}>
                    {fmtDate(e.start_date)}
                    {e.end_date && e.end_date !== e.start_date && <> – {fmtDate(e.end_date)}</>}
                  </td>
                  <td style={{ padding: '8px 10px' }}>{e.target_label}</td>
                  <td style={{ padding: '8px 10px', color: 'var(--mist)' }}>{e.location || '—'}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button onClick={() => setEditing(e)} className="btn-outline btn-xs" disabled={busy}>Edit</button>
                    <button onClick={() => void deleteEvent(e.id)} className="btn-outline btn-xs" disabled={busy}
                      style={{ marginLeft: 6, color: '#991B1B', borderColor: '#fecaca' }}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <EditModal
          initial={editing === 'new' ? null : editing}
          calendars={calendars}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setEditing(null)
            setEvents(p => {
              const idx = p.findIndex(x => x.id === saved.id)
              if (idx === -1) return [saved, ...p]
              const next = p.slice()
              next[idx] = saved
              return next
            })
          }}
        />
      )}
    </CollapsibleCard>
  )
}

function EditModal({ initial, calendars, onClose, onSaved }: {
  initial: AdHocEvent | null
  calendars: CalendarOption[]
  onClose: () => void
  onSaved: (saved: AdHocEvent) => void
}) {
  const isNew = !initial
  const [title, setTitle] = useState(initial?.title || '')
  const [startDate, setStartDate] = useState(initial?.start_date || new Date().toISOString().slice(0, 10))
  const [endDate, setEndDate] = useState(initial?.end_date || '')
  const [description, setDescription] = useState(initial?.description || '')
  const [location, setLocation] = useState(initial?.location || '')
  const [targetCalendarId, setTargetCalendarId] = useState(initial?.target_calendar_id || calendars[0]?.calendar_id || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const targetLabel = calendars.find(c => c.calendar_id === targetCalendarId)?.label || ''

  const save = async () => {
    if (!title.trim()) { setErr('Title is required'); return }
    if (!targetCalendarId) { setErr('Pick a target calendar'); return }
    setBusy(true); setErr(null)
    try {
      const body = {
        title: title.trim(),
        start_date: startDate,
        end_date: endDate || null,
        description: description.trim() || null,
        location: location.trim() || null,
        target_calendar_id: targetCalendarId,
        target_label: targetLabel,
      }
      const url = isNew ? '/api/gcal-adhoc/events' : `/api/gcal-adhoc/events/${initial!.id}`
      const method = isNew ? 'POST' : 'PATCH'
      const res = await authedFetch(url, { method, body: JSON.stringify(body) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setErr(json.error || `Save failed (${res.status})`); return }
      onSaved(json.event as AdHocEvent)
    } catch (e: any) {
      setErr(e?.message || 'Network error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 12, maxWidth: 600, width: '100%',
        maxHeight: '92vh', overflow: 'auto', padding: 20,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h2 style={{ fontSize: 18, fontWeight: 900 }}>
            {isNew ? '+ New ad-hoc event' : 'Edit ad-hoc event'}
          </h2>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--mist)' }}>×</button>
        </div>

        {err && (
          <div style={{ padding: 10, background: '#FEE2E2', color: '#991B1B', borderRadius: 6, fontSize: 12, marginBottom: 12 }}>
            {err}
          </div>
        )}

        <div className="field">
          <label className="fl">Title *</label>
          <input type="text" value={title} onChange={e => setTitle(e.target.value)} autoFocus placeholder="e.g. Trade show booth setup" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div className="field">
            <label className="fl">Start date *</label>
            <DatePicker value={startDate} onChange={setStartDate} />
          </div>
          <div className="field">
            <label className="fl">End date <span style={{ fontWeight: 400, color: 'var(--mist)' }}>(optional, defaults to single day)</span></label>
            <DatePicker value={endDate} onChange={setEndDate} />
          </div>
        </div>

        <div className="field">
          <label className="fl">Target calendar *</label>
          <select value={targetCalendarId} onChange={e => setTargetCalendarId(e.target.value)}>
            <option value="">— pick a calendar —</option>
            {calendars.map(c => (
              <option key={c.calendar_id} value={c.calendar_id}>{c.label}</option>
            ))}
          </select>
          {!isNew && initial && initial.target_calendar_id !== targetCalendarId && (
            <div style={{ fontSize: 11, color: '#92400E', marginTop: 4 }}>
              Note: changing the target calendar isn't supported in v1 — only the original target will be patched. Delete + re-create to move calendars.
            </div>
          )}
        </div>

        <div className="field">
          <label className="fl">Location</label>
          <input type="text" value={location} onChange={e => setLocation(e.target.value)} placeholder="Optional" />
        </div>

        <div className="field">
          <label className="fl">Description</label>
          <textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional" />
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button onClick={save} disabled={busy} className="btn-primary btn-sm">
            {busy ? 'Saving…' : (isNew ? 'Create + push to Google' : 'Save + update Google')}
          </button>
          <button onClick={onClose} disabled={busy} className="btn-outline btn-sm">Cancel</button>
        </div>
      </div>
    </div>
  )
}
