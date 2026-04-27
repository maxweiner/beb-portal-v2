'use client'

import { useState } from 'react'
import { useApp } from '@/lib/context'
import { Phone } from 'lucide-react'
import type { User } from '@/types'

function telHref(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = raw.replace(/\D+/g, '')
  if (digits.length < 7) return null
  // E.164-ish: assume US if 10 digits and no country code.
  if (digits.length === 10) return `tel:+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `tel:+${digits}`
  return `tel:+${digits}`
}

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
              <div
                onClick={() => setExpanded(isOpen ? null : s.id)}
                role="button" tabIndex={0}
                aria-expanded={isOpen}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(isOpen ? null : s.id) } }}
                style={{
                  width: '100%', cursor: 'pointer',
                  padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10,
                  minHeight: 52, opacity: s.active ? 1 : 0.55,
                }}>
                <Avatar u={s} size={32} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.name || '—'}
                  </div>
                </div>
                <span className={`badge ${badge.cls}`} style={{ fontSize: 10, padding: '2px 8px' }}>{badge.label}</span>
                {(() => {
                  const href = telHref(s.phone)
                  if (!href) return null
                  return (
                    <a
                      href={href}
                      onClick={e => e.stopPropagation()}
                      aria-label={`Call ${s.name}`}
                      title={`Call ${s.phone}`}
                      style={{
                        width: 36, height: 36, borderRadius: '50%',
                        background: 'var(--green-pale)', color: 'var(--green-dark)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        border: '1px solid var(--green3)',
                        textDecoration: 'none', flexShrink: 0,
                        transition: 'transform .12s ease',
                      }}
                      onMouseDown={e => (e.currentTarget.style.transform = 'scale(0.96)')}
                      onMouseUp={e => (e.currentTarget.style.transform = 'scale(1)')}
                      onTouchStart={e => (e.currentTarget.style.transform = 'scale(0.96)')}
                      onTouchEnd={e => (e.currentTarget.style.transform = 'scale(1)')}
                    >
                      <Phone size={16} strokeWidth={2.2} />
                    </a>
                  )
                })()}
                <span style={{ color: 'var(--fog)', fontSize: 14, width: 14, textAlign: 'center' }}>{isOpen ? '▾' : '▸'}</span>
              </div>

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
