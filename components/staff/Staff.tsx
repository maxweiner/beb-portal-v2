'use client'

import { useApp } from '@/lib/context'

// Count days worked: past events = 3 days, current/future = days with data
const countDays = (ev: any) => {
  const end = new Date(ev.start_date + 'T12:00:00')
  end.setDate(end.getDate() + 2)
  end.setHours(23, 59, 59)
  const isPast = end < new Date()
  return isPast ? 3 : (ev.days || []).length
}


export default function Staff() {
  const { users, events } = useApp()

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
          display: 'grid', gridTemplateColumns: '1fr 100px 130px 140px',
          padding: '12px 20px', background: 'var(--sidebar-bg)',
          fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'rgba(255,255,255,.5)'
        }}>
          <div>Staff Member</div>
          <div style={{ textAlign: 'center' }}>Events</div>
          <div style={{ textAlign: 'center' }}>Days Worked</div>
          <div style={{ textAlign: 'center' }}>Upcoming Days</div>
        </div>

        {staffStats.length === 0 && (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--mist)' }}>No active buyers found.</div>
        )}

        {staffStats.map((s, i) => (
          <div key={s.id} style={{
            display: 'grid', gridTemplateColumns: '1fr 100px 130px 140px',
            padding: '14px 20px', borderBottom: '1px solid var(--cream2)', alignItems: 'center',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%',
                background: i === 0 ? '#f59e0b' : i === 1 ? '#94a3b8' : i === 2 ? '#b45309' : 'var(--cream2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 900, color: i < 3 ? '#fff' : 'var(--mist)', flexShrink: 0,
              }}>{i + 1}</div>
              {s.photo_url ? (
                <img src={s.photo_url} alt={s.name}
                  style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
              ) : (
                <div style={{
                  width: 32, height: 32, borderRadius: '50%', background: 'var(--green-pale)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, fontWeight: 700, color: 'var(--green-dark)', flexShrink: 0,
                }}>{s.name.charAt(0).toUpperCase()}</div>
              )}
              <div>
                <div style={{ fontWeight: 700, color: 'var(--ink)', fontSize: 14 }}>{s.name}</div>
                <div style={{ fontSize: 11, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{s.role}</div>
              </div>
            </div>

            <div style={{ textAlign: 'center' }}>
              <div style={{ fontWeight: 900, fontSize: 18, color: 'var(--ink)' }}>{s.eventsWorked}</div>
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
        ))}
      </div>
    </div>
  )
}
