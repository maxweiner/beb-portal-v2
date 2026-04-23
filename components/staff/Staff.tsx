'use client'

import { useState } from 'react'
import { useApp } from '@/lib/context'

// Count days worked: past events = 3 days, current/future = days with data
const countDays = (ev: any) => {
  const end = new Date(ev.start_date + 'T12:00:00')
  end.setDate(end.getDate() + 2)
  end.setHours(23, 59, 59)
  const isPast = end < new Date()
  return isPast ? 3 : (ev.days || []).length
}

/** Current-year past/current events where `buyerId` is in the workers array. */
function getBuyerEventsThisYear(buyerId: string, allEvents: any[]): any[] {
  const yearPrefix = String(new Date().getFullYear())
  const today = new Date(); today.setHours(23, 59, 59, 999)
  return allEvents.filter(ev => {
    if (!ev.start_date?.startsWith(yearPrefix)) return false
    if (!(ev.workers || []).some((w: any) => w.id === buyerId)) return false
    const start = new Date(ev.start_date + 'T00:00:00')
    return start <= today
  }).sort((a, b) => b.start_date.localeCompare(a.start_date))
}
/** "Apr 7–9, 2026" or "Jan 30 – Feb 1, 2026" across a month boundary. */
function formatEventDateRange(startDate: string): string {
  const start = new Date(startDate + 'T12:00:00')
  const end = new Date(startDate + 'T12:00:00'); end.setDate(end.getDate() + 2)
  const sm = start.toLocaleDateString('en-US', { month: 'short' })
  const em = end.toLocaleDateString('en-US', { month: 'short' })
  const year = start.getFullYear()
  if (sm !== em) return `${sm} ${start.getDate()} – ${em} ${end.getDate()}, ${year}`
  return `${sm} ${start.getDate()}–${end.getDate()}, ${year}`
}


export default function Staff() {
  const { users, events } = useApp()
  const [expandedBuyerId, setExpandedBuyerId] = useState<string | null>(null)

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const staff = users.filter(u => u.active && u.is_buyer !== false)

  const staffStats = staff.map(u => {
    const daysWorked = events.reduce((total, ev) => {
      const isWorker = (ev.workers || []).some(w => w.id === u.id)
      if (!isWorker) return total
      return total + countDays(ev)
    }, 0)

    const upcomingDays = events.reduce((total, ev) => {
      const isWorker = (ev.workers || []).some(w => w.id === u.id)
      if (!isWorker) return total
      const evStart = new Date(ev.start_date + 'T12:00:00')
      if (evStart < today) return total
      return total + 3
    }, 0)

    const eventsWorked = events.filter(ev =>
      (ev.workers || []).some(w => w.id === u.id)
    ).length

    return { ...u, daysWorked, upcomingDays, eventsWorked }
  }).sort((a, b) => b.daysWorked - a.daysWorked)

  const topDays = Math.max(...staffStats.map(s => s.daysWorked), 1)

  return (
    <div style={{ padding: 24, maxWidth: 800, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink)', marginBottom: 6 }}>Staff</h1>
      <p style={{ color: 'var(--mist)', fontSize: 14, marginBottom: 24 }}>
        Leaderboard of all active buyers — days worked and upcoming schedule.
      </p>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 120px 160px 70px 90px 90px',
          padding: '12px 16px', background: 'var(--sidebar-bg)',
          fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'rgba(255,255,255,.5)'
        }}>
          <div>Staff Member</div>
          <div>Phone</div>
          <div>Email</div>
          <div style={{ textAlign: 'center' }}>Events</div>
          <div style={{ textAlign: 'center' }}>Days</div>
          <div style={{ textAlign: 'center' }}>Upcoming</div>
        </div>

        {staffStats.length === 0 && (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--mist)' }}>No active buyers found.</div>
        )}

        {staffStats.map((s, i) => {
          const expanded = expandedBuyerId === s.id
          const buyerEvents = expanded ? getBuyerEventsThisYear(s.id, events) : []
          return (
            <div key={s.id}>
              <div
                onClick={() => setExpandedBuyerId(expanded ? null : s.id)}
                style={{
                  display: 'grid', gridTemplateColumns: '1fr 120px 160px 70px 90px 90px',
                  padding: '12px 16px',
                  borderBottom: expanded ? 'none' : '1px solid var(--cream2)',
                  alignItems: 'center',
                  cursor: 'pointer',
                }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span aria-hidden style={{
                    width: 10, display: 'inline-block',
                    color: 'var(--mist)', fontSize: 11, lineHeight: 1,
                    transform: expanded ? 'rotate(90deg)' : 'none',
                    transition: 'transform .15s',
                  }}>▸</span>
                  {s.photo_url ? (
                    <img src={s.photo_url} alt={s.name}
                      style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                  ) : (
                    <div style={{
                      width: 36, height: 36, borderRadius: '50%', background: 'var(--green-pale)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 14, fontWeight: 700, color: 'var(--green-dark)', flexShrink: 0,
                    }}>{s.name.charAt(0).toUpperCase()}</div>
                  )}
                  <span style={{ fontWeight: 500, color: 'var(--ink)', fontSize: 14 }}>{s.name}</span>
                </div>

                <div style={{ fontSize: 12, color: 'var(--ash)' }}>
                  {s.phone ? <a href={`tel:${s.phone}`} onClick={e => e.stopPropagation()} style={{ color: 'var(--ash)', textDecoration: 'none' }}>{s.phone}</a> : <span style={{ color: 'var(--fog)' }}>—</span>}
                </div>
                <div style={{ fontSize: 12, color: 'var(--green)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.email ? <a href={`mailto:${s.email}`} onClick={e => e.stopPropagation()} style={{ color: 'var(--green)', textDecoration: 'none' }}>{s.email}</a> : <span style={{ color: 'var(--fog)' }}>—</span>}
                </div>

                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontWeight: 900, fontSize: 16, color: 'var(--ink)' }}>{s.eventsWorked}</div>
                </div>

                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontWeight: 900, fontSize: 18, color: 'var(--green)' }}>{s.daysWorked}</div>
                  <div style={{ height: 4, background: 'var(--cream2)', borderRadius: 2, marginTop: 4, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', borderRadius: 2, background: 'var(--green)',
                      width: `${Math.round(s.daysWorked / topDays * 100)}%`,
                    }} />
                  </div>
                </div>

                <div style={{ textAlign: 'center' }}>
                  {s.upcomingDays > 0 ? (
                    <div style={{
                      display: 'inline-block', padding: '2px 10px', borderRadius: 99,
                      background: 'var(--green-pale)', color: 'var(--green-dark)', fontWeight: 700, fontSize: 14,
                    }}>{s.upcomingDays} days</div>
                  ) : (
                    <div style={{ color: 'var(--silver)', fontSize: 13 }}>—</div>
                  )}
                </div>
              </div>

              {expanded && (
                <div style={{
                  background: 'var(--cream2)',
                  borderBottom: '1px solid var(--pearl)',
                  padding: '12px 20px 14px 44px',
                  animation: 'staffExpand .2s ease-out',
                }}>
                  <style>{`@keyframes staffExpand { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }`}</style>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--mist)', marginBottom: 8 }}>
                    {buyerEvents.length} event{buyerEvents.length === 1 ? '' : 's'} this year
                  </div>
                  {buyerEvents.length === 0 ? (
                    <div style={{ fontSize: 13, color: 'var(--mist)', fontStyle: 'italic' }}>No events yet this year</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {buyerEvents.map(ev => (
                        <div key={ev.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13 }}>
                          <span style={{ color: 'var(--ink)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {ev.store_name}
                          </span>
                          <span style={{ color: 'var(--mist)', flexShrink: 0 }}>{formatEventDateRange(ev.start_date)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
