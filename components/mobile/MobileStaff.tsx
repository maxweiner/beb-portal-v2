'use client'

import { useState } from 'react'
import { useApp } from '@/lib/context'
import type { User } from '@/types'

const countDays = (ev: any) => {
  const end = new Date(ev.start_date + 'T12:00:00')
  end.setDate(end.getDate() + 2)
  end.setHours(23, 59, 59)
  return end < new Date() ? 3 : (ev.days || []).length
}

const ROLE_BADGE: Record<string, { label: string; cls: string }> = {
  superadmin: { label: 'Superadmin', cls: 'badge-ruby' },
  admin:      { label: 'Admin',      cls: 'badge-gold' },
  buyer:      { label: 'Buyer',      cls: 'badge-sapph' },
}

function Avatar({ u, size = 32 }: { u: User; size?: number }) {
  if (u.photo_url) {
    return <img src={u.photo_url} alt={u.name} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', background: 'var(--green-pale)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: Math.round(size * 0.4), fontWeight: 700, color: 'var(--green-dark)', flexShrink: 0,
    }}>{u.name?.charAt(0).toUpperCase() || '?'}</div>
  )
}

function ActiveDot({ active }: { active: boolean }) {
  return (
    <span title={active ? 'Active' : 'Inactive'} style={{
      width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
      background: active ? 'var(--green)' : 'var(--fog)',
    }} />
  )
}

export default function MobileStaff() {
  const { users, events } = useApp()
  const [expanded, setExpanded] = useState<string | null>(null)

  const today = new Date(); today.setHours(0, 0, 0, 0)

  const staff = users.map(u => {
    let daysWorked = 0, upcomingDays = 0, eventsWorked = 0
    for (const ev of events) {
      const worked = (ev.workers || []).some((w: any) => w.id === u.id)
      if (!worked) continue
      eventsWorked++
      daysWorked += countDays(ev)
      if (new Date(ev.start_date + 'T12:00:00') >= today) upcomingDays += 3
    }
    return { ...u, daysWorked, eventsWorked, upcomingDays }
  }).sort((a, b) => b.daysWorked - a.daysWorked)

  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ fontSize: 20, fontWeight: 900, color: 'var(--ink)', marginBottom: 4 }}>Staff</h2>
      <p style={{ fontSize: 12, color: 'var(--mist)', marginBottom: 14 }}>Tap a row to see contact info and stats.</p>

      <div style={{ background: 'var(--cream)', borderRadius: 12, border: '1px solid var(--pearl)', overflow: 'hidden' }}>
        {staff.map(s => {
          const isOpen = expanded === s.id
          const badge = ROLE_BADGE[s.role as string] || ROLE_BADGE.buyer
          return (
            <div key={s.id} style={{ borderBottom: '1px solid var(--cream2)' }}>
              <button
                onClick={() => setExpanded(isOpen ? null : s.id)}
                aria-expanded={isOpen}
                style={{
                  width: '100%', background: 'transparent', border: 'none', cursor: 'pointer',
                  padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10,
                  justifyContent: 'flex-start', minHeight: 52, textAlign: 'left',
                  opacity: s.active ? 1 : 0.55,
                }}>
                <Avatar u={s} size={32} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.name || '—'}
                  </div>
                </div>
                <span className={`badge ${badge.cls}`} style={{ fontSize: 10, padding: '2px 8px' }}>{badge.label}</span>
                <ActiveDot active={!!s.active} />
                <span style={{ color: 'var(--fog)', fontSize: 14, width: 14, textAlign: 'center' }}>{isOpen ? '▾' : '▸'}</span>
              </button>

              {isOpen && (
                <div style={{ padding: '4px 14px 14px 56px', background: 'var(--cream2)' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
                    {s.phone && (
                      <a href={`tel:${s.phone}`} style={{ color: 'var(--ash)', textDecoration: 'none' }}>
                        📞 {s.phone}
                      </a>
                    )}
                    {s.email && (
                      <a href={`mailto:${s.email}`} style={{ color: 'var(--green)', textDecoration: 'none', wordBreak: 'break-all' }}>
                        ✉ {s.email}
                      </a>
                    )}
                    <div style={{ display: 'flex', gap: 14, marginTop: 4, color: 'var(--mist)', fontSize: 12 }}>
                      <span><strong style={{ color: 'var(--ink)' }}>{s.eventsWorked}</strong> events</span>
                      <span><strong style={{ color: 'var(--green)' }}>{s.daysWorked}</strong> days</span>
                      {s.upcomingDays > 0 && <span><strong style={{ color: 'var(--ink)' }}>{s.upcomingDays}</strong> upcoming</span>}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
