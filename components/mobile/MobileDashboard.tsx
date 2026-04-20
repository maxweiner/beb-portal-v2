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


export default function MobileDashboard() {
  const { user, users, events } = useApp()
  const currentYear = String(new Date().getFullYear())
  const yearEvents = events.filter(e => e.start_date?.startsWith(currentYear))
  const buyers = users.filter(u => u.active && u.is_buyer !== false)
  const ineligible = ['joe', 'max', 'rich'].map(n => n.toLowerCase())

  const totals = yearEvents.reduce((acc, ev) => {
    ev.days.forEach((d: any) => {
      acc.purchases += d.purchases || 0
      acc.dollars += parseFloat(d.dollars10 || 0) + parseFloat(d.dollars5 || 0)
    })
    return acc
  }, { purchases: 0, dollars: 0 })

  // Current user's stats
  const myDays = yearEvents.reduce((s, ev) => {
    const workedEvent = (ev.workers || []).some((w: any) => w.id === user?.id)
    return s + (workedEvent ? countDays(ev) : 0)
  }, 0)
  const myEvents = yearEvents.filter(ev => (ev.workers || []).some((w: any) => w.id === user?.id))

  // Leaderboard
  let rank = 0; let lastDays = -1
  const ranked = buyers.map(b => {
    const days = yearEvents.reduce((s, ev) => {
      const workedEvent = (ev.workers || []).some((w: any) => w.id === b.id)
      return s + (workedEvent ? countDays(ev) : 0)
    }, 0)
    return { ...b, days, isIneligible: ineligible.some(n => b.name?.toLowerCase().includes(n)) }
  }).sort((a, b) => b.days - a.days).map((b, i) => {
    if (b.days !== lastDays) { rank = i + 1; lastDays = b.days }
    return { ...b, rank }
  })

  const myRank = ranked.find(b => b.id === user?.id)
  const TIERS: Record<number, { label: string; icon: string; color: string }> = {
    1: { label: 'Estate Elite', icon: '👑', color: '#F5A000' },
    2: { label: 'Platinum', icon: '💎', color: '#6B7FD4' },
    3: { label: 'Gold', icon: '🥇', color: '#C9A84C' },
  }
  const myTier = myRank?.rank && myRank.rank <= 3 ? TIERS[myRank.rank] : null

  const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`
  const fmtDate = (ds: string) => new Date(ds + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  return (
    <div style={{ padding: 16 }}>
      {/* Welcome */}
      <div style={{ background: 'var(--sidebar-bg)', borderRadius: 16, padding: '20px', marginBottom: 16 }}>
        <div style={{ color: '#7EC8A0', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>
          Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}
        </div>
        <div style={{ color: '#fff', fontSize: 22, fontWeight: 900, marginBottom: 12 }}>{user?.name?.split(' ')[0]}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          {[
            ['My Days', String(myDays)],
            ['My Events', String(myEvents.length)],
            ['My Rank', myRank ? `#${myRank.rank}` : '—'],
          ].map(([label, value]) => (
            <div key={label} style={{ background: 'rgba(255,255,255,.1)', borderRadius: 10, padding: '10px 8px', textAlign: 'center' }}>
              <div style={{ color: '#fff', fontSize: 20, fontWeight: 900 }}>{value}</div>
              <div style={{ color: 'rgba(255,255,255,.5)', fontSize: 10, marginTop: 2 }}>{label}</div>
            </div>
          ))}
        </div>
        {myTier && (
          <div style={{ marginTop: 12, padding: '8px 12px', background: 'rgba(255,255,255,.1)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 18 }}>{myTier.icon}</span>
            <span style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>{myTier.label} Status</span>
          </div>
        )}
      </div>

      {/* Active event stats or next event countdown */}
      {(() => {
        const now = new Date(); now.setHours(0,0,0,0)
        const activeEvent = myEvents.find(ev => {
          const start = new Date(ev.start_date + 'T12:00:00')
          const end = new Date(ev.start_date + 'T12:00:00'); end.setDate(end.getDate() + 2); end.setHours(23,59,59)
          return now >= start && now <= end
        })
        if (activeEvent) {
          const evPurchases = activeEvent.days.reduce((s: number, d: any) => s + (d.purchases || 0), 0)
          const evDollars = activeEvent.days.reduce((s: number, d: any) => s + (d.dollars10 || 0) + (d.dollars5 || 0), 0)
          return (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: 'var(--mist)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 6, paddingLeft: 2 }}>
                Live — {activeEvent.store_name}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={{ background: 'var(--cream)', borderRadius: 12, padding: '14px 16px', border: '1px solid var(--pearl)' }}>
                  <div style={{ fontSize: 11, color: 'var(--mist)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>📦 Purchases</div>
                  <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--green)' }}>{evPurchases.toLocaleString()}</div>
                </div>
                <div style={{ background: 'var(--cream)', borderRadius: 12, padding: '14px 16px', border: '1px solid var(--pearl)' }}>
                  <div style={{ fontSize: 11, color: 'var(--mist)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>💰 Amount Spent</div>
                  <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--green)' }}>{fmt(evDollars)}</div>
                </div>
              </div>
            </div>
          )
        }
        const futureEvents = [...myEvents].filter(ev => new Date(ev.start_date + 'T12:00:00') > now).sort((a, b) => a.start_date.localeCompare(b.start_date))
        const nextEvent = futureEvents[0]
        if (nextEvent) {
          const nextDay = new Date(nextEvent.start_date + 'T12:00:00'); nextDay.setHours(0,0,0,0)
          const todayDate = new Date(); todayDate.setHours(0,0,0,0)
          const daysUntil = Math.round((nextDay.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24))
          const countdownLabel = daysUntil <= 0 ? 'Today' : daysUntil === 1 ? 'Tomorrow' : `In ${daysUntil} days`
          return (
            <div style={{ background: 'var(--cream)', borderRadius: 12, padding: '16px', border: '1px solid var(--pearl)', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ width: 50, height: 50, borderRadius: 12, background: 'var(--green-pale)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--green)' }}>{daysUntil <= 1 ? (daysUntil <= 0 ? '!' : '1') : daysUntil}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--mist)', fontWeight: 700, textTransform: 'uppercase' }}>{countdownLabel}</div>
                <div style={{ fontSize: 15, fontWeight: 900, color: 'var(--ink)', marginTop: 2 }}>{nextEvent.store_name}</div>
                <div style={{ fontSize: 12, color: 'var(--mist)' }}>{fmtDate(nextEvent.start_date)}</div>
              </div>
            </div>
          )
        }
        return null
      })()}

      {/* My upcoming events */}
      {myEvents.length > 0 && (
        <div style={{ background: 'var(--cream)', borderRadius: 12, padding: 16, marginBottom: 16, border: '1px solid var(--pearl)' }}>
          <div style={{ fontWeight: 900, fontSize: 14, color: 'var(--ink)', marginBottom: 12 }}>My Events</div>
          {[...myEvents].sort((a, b) => a.start_date.localeCompare(b.start_date)).slice(0, 5).map(ev => {
            const evStart = new Date(ev.start_date + 'T12:00:00')
              const evEnd = new Date(ev.start_date + 'T12:00:00'); evEnd.setDate(evEnd.getDate() + 2); evEnd.setHours(23,59,59)
              const now = new Date()
              const isPast = evEnd < now
              const isCurrent = now >= evStart && now <= evEnd
              const today = new Date(); today.setHours(0,0,0,0)
              const evDay = new Date(ev.start_date + 'T12:00:00'); evDay.setHours(0,0,0,0)
              const daysAway = Math.round((evDay.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
              const statusText = isCurrent ? 'Now' : isPast ? 'Done' : daysAway <= 0 ? 'Today' : daysAway === 1 ? 'Tomorrow' : `${daysAway} days`
              const statusColor = isCurrent ? 'var(--green)' : isPast ? 'var(--fog)' : 'var(--ash)'
              return (
                <div key={ev.id} style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 10, marginBottom: 10, borderBottom: '1px solid var(--cream2)' }}>
                  <div style={{ width: 4, height: 36, borderRadius: 2, background: isCurrent ? 'var(--green)' : isPast ? 'var(--fog)' : 'var(--green)', flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: isPast ? 'var(--mist)' : 'var(--ink)' }}>{ev.store_name}</div>
                    <div style={{ fontSize: 12, color: 'var(--mist)' }}>{fmtDate(ev.start_date)}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: statusColor }}>{statusText}</div>
                  </div>
                </div>
              )
          })}
        </div>
      )}

      {/* Mini leaderboard */}
      <div style={{ background: 'var(--cream)', borderRadius: 12, overflow: 'hidden', border: '1px solid var(--pearl)' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--cream2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontWeight: 900, fontSize: 14, color: 'var(--ink)' }}>🏆 {currentYear} Leaderboard</div>
          <div style={{ fontSize: 11, color: 'var(--mist)' }}>Days submitted</div>
        </div>
        {ranked.slice(0, 6).map((b, i) => {
          const tier = b.rank <= 3 ? TIERS[b.rank] : null
          const isMe = b.id === user?.id
          return (
            <div key={b.id} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px',
              background: isMe ? 'var(--green-pale)' : i % 2 === 0 ? 'transparent' : 'var(--cream2)',
              borderBottom: '1px solid var(--cream2)',
            }}>
              <div style={{ width: 24, textAlign: 'center', fontWeight: 900, fontSize: 13, color: tier ? tier.color : 'var(--mist)' }}>
                {b.rank}
              </div>
              {b.photo_url ? (
                <img src={b.photo_url} alt="" style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
              ) : (
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: tier ? tier.color : 'var(--green)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 900, fontSize: 13, flexShrink: 0 }}>
                  {b.name?.charAt(0)}
                </div>
              )}
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: isMe ? 900 : 600, fontSize: 14, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  {b.name?.split(' ')[0]}
                  {isMe && <span style={{ fontSize: 10, color: 'var(--green)', fontWeight: 700 }}>YOU</span>}
                  {b.isIneligible && <span title="Not eligible for prize" style={{ fontSize: 10, color: 'var(--mist)', cursor: 'help' }}>*</span>}
                </div>
                {tier && <div style={{ fontSize: 10, color: tier.color, fontWeight: 700 }}>{tier.icon} {tier.label}</div>}
              </div>
              <div style={{ fontWeight: 900, fontSize: 16, color: tier ? tier.color : 'var(--ash)' }}>{b.days}</div>
            </div>
          )
        })}
        {ranked.length > 6 && (
          <div style={{ padding: '10px 16px', fontSize: 12, color: 'var(--mist)', textAlign: 'center' }}>
            +{ranked.length - 6} more buyers
          </div>
        )}
        <div style={{ padding: '8px 16px', fontSize: 10, color: 'var(--mist)', borderTop: '1px solid var(--cream2)' }}>
          * Not eligible for cash prize · Prizes: $1,000 / $500 / $250
        </div>
      </div>
    </div>
  )
}
