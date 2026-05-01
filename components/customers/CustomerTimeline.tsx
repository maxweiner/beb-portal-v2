'use client'

// Per-customer activity timeline. Merges three sources at read time:
//   1. customer_events (notes, edits, tags, tier changes, created)
//   2. customer_mailings (every postcard / VDP sent)
//   3. appointments — joined by email or normalized phone match at
//      the same store (the appointments table doesn't have a
//      customer FK yet; Phase 12 backfills it)
//
// All entries normalized into the same row shape, sorted desc, then
// rendered as a stacked vertical timeline with icon + date + actor.

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/lib/context'
import { supabase } from '@/lib/supabase'
import type { Customer } from '@/lib/customers/types'
import { fmtDateLong } from '@/lib/customers/format'

interface TimelineEntry {
  date: string  // ISO timestamp for sort
  icon: string
  title: string
  detail?: string
  actor?: string
  source: 'event' | 'mailing' | 'appointment'
}

interface RawEvent {
  id: string
  event_type: string
  actor_id: string | null
  description: string | null
  meta: Record<string, any> | null
  created_at: string
}

interface RawMailing {
  id: string
  mailed_at: string
  mailing_type: string
  notes: string | null
  marketing_campaign_id: string | null
}

interface RawAppointment {
  id: string
  appointment_date: string
  appointment_time: string | null
  status: string | null
  customer_email: string | null
  customer_phone: string | null
}

const EVENT_ICONS: Record<string, string> = {
  created:      '✨',
  imported:     '📥',
  edited:       '✎',
  note_added:   '📝',
  tag_added:    '🏷️',
  tag_removed:  '🧹',
  merged:       '⤺',
  tier_changed: '↕️',
}

export default function CustomerTimeline({ customer }: { customer: Customer }) {
  const { users } = useApp()
  const [events, setEvents] = useState<RawEvent[]>([])
  const [mailings, setMailings] = useState<RawMailing[]>([])
  const [appointments, setAppointments] = useState<RawAppointment[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const [eRes, mRes] = await Promise.all([
        supabase.from('customer_events').select('id, event_type, actor_id, description, meta, created_at')
          .eq('customer_id', customer.id).order('created_at', { ascending: false }).limit(200),
        supabase.from('customer_mailings').select('id, mailed_at, mailing_type, notes, marketing_campaign_id')
          .eq('customer_id', customer.id).order('mailed_at', { ascending: false }).limit(200),
      ])
      // Appointments via Phase-12 customer_id FK (every appointment
      // gets linked or auto-creates the customer via the SQL trigger).
      const { data: aData } = await supabase.from('appointments')
        .select('id, appointment_date, appointment_time, status, customer_email, customer_phone')
        .eq('customer_id', customer.id)
        .order('appointment_date', { ascending: false }).limit(200)
      const aRows = (aData ?? []) as RawAppointment[]
      if (cancelled) return
      setEvents((eRes.data ?? []) as RawEvent[])
      setMailings((mRes.data ?? []) as RawMailing[])
      setAppointments(aRows)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [customer.id, customer.store_id, customer.email_normalized, customer.phone_normalized])

  const userNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const u of users) m.set(u.id, u.name || u.email || '(unknown)')
    return m
  }, [users])

  const merged = useMemo<TimelineEntry[]>(() => {
    const out: TimelineEntry[] = []
    for (const e of events) {
      out.push({
        date: e.created_at,
        icon: EVENT_ICONS[e.event_type] || '•',
        title: humanizeEventTitle(e),
        detail: e.description ?? undefined,
        actor: e.actor_id ? userNameById.get(e.actor_id) : undefined,
        source: 'event',
      })
    }
    for (const m of mailings) {
      out.push({
        date: m.mailed_at,
        icon: m.mailing_type === 'postcard' ? '📮' : m.mailing_type === 'vdp' ? '📬' : '✉️',
        title: `Mailing sent — ${m.mailing_type.toUpperCase()}`,
        detail: m.notes ?? undefined,
        source: 'mailing',
      })
    }
    for (const a of appointments) {
      const dateOnly = a.appointment_date
      const isoDate = `${dateOnly}T${a.appointment_time || '12:00:00'}`
      out.push({
        date: isoDate,
        icon: '📅',
        title: `Appointment · ${a.status || 'scheduled'}`,
        detail: a.appointment_time ? `${a.appointment_time}` : undefined,
        source: 'appointment',
      })
    }
    out.sort((a, b) => b.date.localeCompare(a.date))
    return out
  }, [events, mailings, appointments, userNameById])

  if (loading) {
    return (
      <div className="card" style={{ padding: 14, color: 'var(--mist)', fontSize: 13 }}>
        Loading timeline…
      </div>
    )
  }
  if (merged.length === 0) {
    return (
      <div className="card" style={{ padding: 14, color: 'var(--mist)', fontSize: 13, textAlign: 'center' }}>
        No timeline events yet. Edits, tags, mailings, and appointments will appear here as they happen.
      </div>
    )
  }

  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="card-title">Timeline</div>
      <div style={{ position: 'relative', paddingLeft: 22 }}>
        {/* Vertical track */}
        <div style={{
          position: 'absolute', left: 9, top: 4, bottom: 4,
          width: 2, background: 'var(--cream2)',
        }} />
        {merged.map((e, i) => (
          <div key={i} style={{ position: 'relative', paddingBottom: 12 }}>
            <div style={{
              position: 'absolute', left: -22, top: 0,
              width: 20, height: 20, borderRadius: '50%',
              background: '#fff', border: '2px solid var(--pearl)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11,
            }}>{e.icon}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{e.title}</div>
                {e.detail && (
                  <div style={{ fontSize: 12, color: 'var(--ash)', marginTop: 2, whiteSpace: 'pre-wrap' }}>
                    {e.detail}
                  </div>
                )}
                {e.actor && (
                  <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 2 }}>
                    by {e.actor}
                  </div>
                )}
              </div>
              <div style={{ fontSize: 11, color: 'var(--mist)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                {fmtDateLong(e.date.slice(0, 10))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function humanizeEventTitle(e: RawEvent): string {
  switch (e.event_type) {
    case 'created':      return 'Customer created'
    case 'imported':     return 'Imported from CSV'
    case 'edited':       return 'Profile edited'
    case 'note_added':   return 'Note added'
    case 'tag_added':    return `Tag added: ${e.meta?.tag || ''}`.trim()
    case 'tag_removed':  return `Tag removed: ${e.meta?.tag || ''}`.trim()
    case 'merged':       return 'Merged with another record'
    case 'tier_changed': return e.description || 'Engagement tier changed'
    default:             return e.event_type
  }
}
