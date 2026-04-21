'use client'

import { useApp } from '@/lib/context'

const countDays = (ev: any) => {
  const end = new Date(ev.start_date + 'T12:00:00')
  end.setDate(end.getDate() + 2)
  end.setHours(23, 59, 59)
  return end < new Date() ? 3 : (ev.days || []).length
}

const TIERS: Record<number, { label: string; icon: string; color: string }> = {
  1: { label: 'Estate Elite', icon: '👑', color: '#F5A000' },
  2: { label: 'Platinum',     icon: '💎', color: '#6B7FD4' },
  3: { label: 'Gold',         icon: '🥇', color: '#C9A84C' },
}

const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`
const fmtDate = (ds: string) => new Date(ds + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

export default function MobileDashboard() {
  const { user, users, events } = useApp()
  const currentYear = String(new Date().getFullYear())
  const yearEvents = events.filter(e => e.start_date?.startsWith(currentYear))
  const buyers = users.filter(u => u.active && u.is_buyer !== false)
  const ineligibleNames = ['joe', 'max', 'rich']

  const today = new Date(); today.setHours(0, 0, 0, 0)
  const greet = new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'

  const myDays = yearEvents.reduce((s, ev) =>
    s + ((ev.workers || []).some((w: any) => w.id === user?.id) ? countDays(ev) : 0), 0)
  const allMyEvents = yearEvents.filter(ev => (ev.workers || []).some((w: any) => w.id === user?.id))

  // Hide past events from "My Events"
  const myUpcomingEvents = allMyEvents.filter(ev => {
    const end = new Date(ev.start_date + 'T12:00:00')
    end.setDate(end.getDate() + 2); end.setHours(23, 59, 59)
    return end >= today
  }).sort((a, b) => a.start_date.localeCompare(b.start_date))

  let rank = 0; let lastDays = -1
  const ranked = buyers.map(b => {
    const days = yearEvents.reduce((s, ev) =>
      s + ((ev.workers || []).some((w: any) => w.id === b.id) ? countDays(ev) : 0), 0)
    return { ...b, days, isIneligible: ineligibleNames.some(n => b.name?.toLowerCase().includes(n)) }
  }).sort((a, b) => b.days - a.days).map((b, i) => {
    if (b.days !== lastDays) { rank = i + 1; lastDays = b.days }
    return { ...b, rank }
  })
  const myRank = ranked.find(b => b.id === user?.id)
  const myTier = myRank && myRank.rank <= 3 ? TIERS[myRank.rank] : null

  const activeEvent = allMyEvents.find(ev => {
    const start = new Date(ev.start_date + 'T12:00:00')
    const end = new Date(ev.start_date + 'T12:00:00'); end.setDate(end.getDate() + 2); end.setHours(23, 59, 59)
    return today >= start && today <= end
  })
  const activeStats = activeEvent ? {
    purchases: activeEvent.days.reduce((s: number, d: any) => s + (d.purchases || 0), 0),
    dollars: activeEvent.days.reduce((s: number, d: any) => s + (d.dollars10 || 0) + (d.dollars5 || 0), 0),
    customers: activeEvent.days.reduce((s: number, d: any) => s + (d.customers || 0), 0),
  } : null

  const futureEvents = [...allMyEvents]
    .filter(ev => new Date(ev.start_date + 'T12:00:00') > today)
    .sort((a, b) => a.start_date.localeCompare(b.start_date))
  const nextEvent = futureEvents[0] || null
  let daysUntil = 0
  if (nextEvent) {
    const nd = new Date(nextEvent.start_date + 'T12:00:00'); nd.setHours(0, 0, 0, 0)
    daysUntil = Math.round((nd.getTime() - today.getTime()) / 86400000)
  }

  return (
    <div style={{ background: 'var(--cream2)', minHeight: '100%' }}>
      {/* Hero */}
      <div style={{
        background: 'linear-gradient(160deg, var(--sidebar-bg) 0%, var(--green-dark) 50%, var(--green) 100%)',
        padding: '22px 18px', borderRadius: '0 0 24px 24px',
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', top: 0, right: -60, width: 200, height: 200,
          borderRadius: '50%', background: 'rgba(134,239,172,.12)', filter: 'blur(20px)',
        }} />
        <div style={{ position: 'relative' }}>
          <div style={{ color: 'rgba(245,240,232,.85)', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em' }}>
            Good {greet}
          </div>
          <div style={{ color: '#fff', fontSize: 28, fontWeight: 900, marginTop: 2, letterSpacing: '-.02em' }}>
            {user?.name?.split(' ')[0]} 👋
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 16 }}>
            {[
              ['Days', String(myDays)],
              ['Events', String(allMyEvents.length)],
              ['Rank', myRank ? `#${myRank.rank}` : '—'],
            ].map(([l, v]) => (
              <div key={l} style={{
                background: 'rgba(240,253,244,.95)', borderRadius: 12, padding: '10px 8px',
                textAlign: 'center', border: '1px solid var(--green3)',
                boxShadow: '0 2px 8px rgba(0,0,0,.1)',
              }}>
                <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--green-dark)', lineHeight: 1 }}>{v}</div>
                <div style={{ fontSize: 10, color: 'var(--green-dark)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', marginTop: 3, opacity: 0.75 }}>{l}</div>
              </div>
            ))}
          </div>

          {myTier && (
            <div style={{
              marginTop: 12, padding: '8px 14px', background: 'rgba(255,255,255,.14)',
              borderRadius: 10, display: 'inline-flex', alignItems: 'center', gap: 8,
              border: '1px solid rgba(255,255,255,.2)',
            }}>
              <span style={{ fontSize: 16 }}>{myTier.icon}</span>
              <span style={{ color: '#fff', fontWeight: 900, fontSize: 12, letterSpacing: '.02em' }}>{myTier.label} Status</span>
            </div>
          )}
        </div>
      </div>

      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Live card */}
        {activeEvent && activeStats && (
          <div style={{
            background: 'linear-gradient(135deg, var(--green-pale), var(--cream))',
            borderRadius: 14, padding: 16,
            border: '2px solid var(--green3)',
            boxShadow: '0 0 0 4px rgba(134,239,172,.25), 0 4px 16px rgba(29,107,68,.12)',
            position: 'relative',
          }}>
            <div style={{ position: 'absolute', top: 12, right: 14, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--green)', boxShadow: '0 0 0 3px rgba(29,107,68,.2)' }} />
              <span style={{ fontSize: 10, fontWeight: 900, color: 'var(--green-dark)', textTransform: 'uppercase', letterSpacing: '.08em' }}>Live</span>
            </div>
            <div style={{ fontWeight: 900, fontSize: 15, color: 'var(--ink)', marginBottom: 10 }}>◆ {activeEvent.store_name}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <div style={{ fontSize: 10, color: 'var(--mist)', fontWeight: 700, textTransform: 'uppercase' }}>📦 Purchases</div>
                <div style={{ fontSize: 26, fontWeight: 900, color: 'var(--green)' }}>{activeStats.purchases.toLocaleString()}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'var(--mist)', fontWeight: 700, textTransform: 'uppercase' }}>💰 Amount</div>
                <div style={{ fontSize: 26, fontWeight: 900, color: 'var(--green)' }}>{fmt(activeStats.dollars)}</div>
              </div>
            </div>
          </div>
        )}

        {/* Countdown when no active event */}
        {!activeEvent && nextEvent && (
          <div style={{ background: 'var(--cream)', borderRadius: 14, padding: 14, border: '1px solid var(--pearl)', display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              minWidth: 60, height: 60, borderRadius: 14,
              background: 'linear-gradient(135deg, var(--green), var(--green-dark))',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              color: '#fff', boxShadow: '0 4px 12px rgba(29,107,68,.3)',
            }}>
              {daysUntil <= 0 ? (
                <div style={{ fontSize: 12, fontWeight: 900 }}>TODAY</div>
              ) : (
                <>
                  <div style={{ fontSize: 22, fontWeight: 900, lineHeight: 1 }}>{daysUntil}</div>
                  <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', opacity: 0.85, marginTop: 2 }}>{daysUntil === 1 ? 'day' : 'days'}</div>
                </>
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, color: 'var(--green)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em' }}>Next up</div>
              <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--ink)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {nextEvent.store_name}
              </div>
              <div style={{ fontSize: 12, color: 'var(--mist)' }}>{fmtDate(nextEvent.start_date)}</div>
            </div>
          </div>
        )}

        {/* My Events (future/current only) */}
        {myUpcomingEvents.length > 0 && (
          <div style={{ background: 'var(--cream)', borderRadius: 14, border: '1px solid var(--pearl)', overflow: 'hidden' }}>
            <div style={{ background: 'var(--green-pale)', padding: '10px 14px', borderBottom: '1px solid var(--green3)' }}>
              <div style={{ fontWeight: 900, fontSize: 13, color: 'var(--green-dark)', textTransform: 'uppercase', letterSpacing: '.04em' }}>My Upcoming Events</div>
            </div>
            {myUpcomingEvents.slice(0, 5).map((ev, i) => {
              const now = new Date()
              const evStart = new Date(ev.start_date + 'T12:00:00')
              const evEnd = new Date(ev.start_date + 'T12:00:00'); evEnd.setDate(evEnd.getDate() + 2); evEnd.setHours(23, 59, 59)
              const isCurrent = now >= evStart && now <= evEnd
              const evDay = new Date(ev.start_date + 'T12:00:00'); evDay.setHours(0, 0, 0, 0)
              const daysAway = Math.round((evDay.getTime() - today.getTime()) / 86400000)
              const statusText = isCurrent ? 'NOW' : daysAway <= 0 ? 'TODAY' : daysAway === 1 ? 'Tomorrow' : `in ${daysAway}d`
              return (
                <div key={ev.id} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
                  borderBottom: i < Math.min(myUpcomingEvents.length, 5) - 1 ? '1px solid var(--cream2)' : 'none',
                }}>
                  <div style={{
                    minWidth: 44, padding: '6px 4px', textAlign: 'center', borderRadius: 8,
                    background: isCurrent ? 'var(--green)' : 'var(--green-pale)',
                    color: isCurrent ? '#fff' : 'var(--green-dark)',
                  }}>
                    <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>{new Date(ev.start_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short' })}</div>
                    <div style={{ fontSize: 17, fontWeight: 900, lineHeight: 1 }}>{new Date(ev.start_date + 'T12:00:00').getDate()}</div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 900, fontSize: 14, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.store_name}</div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: isCurrent ? 'var(--green)' : 'var(--mist)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{statusText}</div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Leaderboard */}
        <div style={{ background: 'var(--cream)', borderRadius: 14, border: '1px solid var(--pearl)', overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--cream2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontWeight: 900, fontSize: 13, color: 'var(--ink)' }}>🏆 {currentYear} Leaderboard</div>
          </div>
          {ranked.slice(0, 6).map((b, i) => {
            const tier = b.rank <= 3 ? TIERS[b.rank] : null
            const isMe = b.id === user?.id
            return (
              <div key={b.id} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                background: isMe ? 'var(--green-pale)' : 'transparent',
                borderBottom: i < Math.min(ranked.length, 6) - 1 ? '1px solid var(--cream2)' : 'none',
              }}>
                <div style={{ width: 22, textAlign: 'center', fontWeight: 900, fontSize: 13, color: tier ? tier.color : 'var(--mist)' }}>{b.rank}</div>
                {b.photo_url
                  ? <img src={b.photo_url} alt="" style={{ width: 30, height: 30, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                  : <div style={{ width: 30, height: 30, borderRadius: '50%', background: tier?.color || 'var(--green)', color: '#fff', fontWeight: 900, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{b.name?.charAt(0)}</div>
                }
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: isMe ? 900 : 600, fontSize: 13, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {b.name?.split(' ')[0]}
                    {isMe && <span style={{ marginLeft: 6, fontSize: 9, color: 'var(--green)', fontWeight: 700 }}>YOU</span>}
                    {b.isIneligible && <span title="Not eligible for prize" style={{ marginLeft: 4, fontSize: 10, color: 'var(--mist)', cursor: 'help' }}>*</span>}
                  </div>
                  {tier && <div style={{ fontSize: 10, color: tier.color, fontWeight: 700 }}>{tier.icon} {tier.label}</div>}
                </div>
                <div style={{ fontWeight: 900, fontSize: 16, color: tier?.color || 'var(--ash)' }}>{b.days}</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
