'use client'

import { useMemo, useState } from 'react'
import { useApp } from '@/lib/context'
import type { NavPage } from '@/app/page'

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

const INELIGIBLE = ['joe', 'max', 'rich']
const fmtMoney = (n: number) => `$${Math.round(n).toLocaleString()}`

const weekStart = (d: Date) => {
  const r = new Date(d); r.setHours(0, 0, 0, 0)
  const day = r.getDay()
  const diff = r.getDate() - day + (day === 0 ? -6 : 1)
  r.setDate(diff)
  return r
}
const weekEnd = (d: Date) => {
  const r = weekStart(d); r.setDate(r.getDate() + 6); r.setHours(23, 59, 59, 999); return r
}
const overlapsWeek = (e: any, ws: Date, we: Date) => {
  if (!e.start_date) return false
  const s = new Date(e.start_date + 'T00:00:00')
  const en = new Date(e.start_date + 'T00:00:00'); en.setDate(en.getDate() + 2); en.setHours(23, 59, 59, 999)
  return s <= we && en >= ws
}
const eventSpend = (ev: any) =>
  (ev.days || []).reduce((s: number, d: any) => s + (Number(d.dollars10) || 0) + (Number(d.dollars5) || 0), 0)
const eventDayStatus = (ev: any) => {
  const entered = (ev.days || []).filter((d: any) =>
    (Number(d.purchases) || 0) > 0 || (Number(d.dollars10) || 0) > 0 || (Number(d.dollars5) || 0) > 0
  ).length
  return entered === 0 ? '' : `Day ${entered} of 3`
}

interface Props {
  setNav?: (n: NavPage) => void
}

export default function MobileDashboard({ setNav }: Props) {
  const { user, users, events, setDayEntryIntent } = useApp()
  const currentYear = String(new Date().getFullYear())
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin'
  const greet = new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'

  const yearEvents = events.filter(e => e.start_date?.startsWith(currentYear))
  const buyers = users.filter(u => u.active && u.is_buyer !== false)

  /* ── Week calc ── */
  const today = new Date()
  const ws = weekStart(today)
  const we = weekEnd(today)
  const thisWeek = events.filter(e => overlapsWeek(e, ws, we))
  const nextWs = new Date(ws); nextWs.setDate(ws.getDate() + 7)
  const nextWe = new Date(we); nextWe.setDate(we.getDate() + 7)
  const nextWeek = thisWeek.length === 0 ? events.filter(e => overlapsWeek(e, nextWs, nextWe)) : []
  const showingFallback = thisWeek.length === 0 && nextWeek.length > 0
  const displayed = thisWeek.length > 0 ? thisWeek : nextWeek

  // Sort so the user's own events come first (only for buyers).
  const sortedDisplayed = useMemo(() => {
    if (isAdmin) return displayed
    return [...displayed].sort((a, b) => {
      const aMine = (a.workers || []).some((w: any) => w.id === user?.id) ? 0 : 1
      const bMine = (b.workers || []).some((w: any) => w.id === user?.id) ? 0 : 1
      if (aMine !== bMine) return aMine - bMine
      return a.start_date.localeCompare(b.start_date)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayed, isAdmin, user?.id])

  /* ── Personal stats (for name-tap popup) ── */
  const myDays = yearEvents.reduce((s, ev) =>
    s + ((ev.workers || []).some((w: any) => w.id === user?.id) ? countDays(ev) : 0), 0)
  const myEvents = yearEvents.filter(ev => (ev.workers || []).some((w: any) => w.id === user?.id)).length

  let rank = 0; let lastDays = -1
  const ranked = buyers.map(b => {
    const days = yearEvents.reduce((s, ev) =>
      s + ((ev.workers || []).some((w: any) => w.id === b.id) ? countDays(ev) : 0), 0)
    return { ...b, days, isIneligible: INELIGIBLE.some(n => b.name?.toLowerCase().includes(n)) }
  }).sort((a, b) => b.days - a.days).map((b, i) => {
    if (b.days !== lastDays) { rank = i + 1; lastDays = b.days }
    return { ...b, rank }
  })
  const myRank = ranked.find(b => b.id === user?.id)
  const myTier = myRank && myRank.rank <= 3 ? TIERS[myRank.rank] : null

  const [statsOpen, setStatsOpen] = useState(false)

  /* ── Navigate to Enter Day Data with the event pre-selected ── */
  const openEvent = (ev: any) => {
    setDayEntryIntent({ eventId: ev.id, day: 1 })
    setNav?.('dayentry')
  }

  return (
    <div style={{ background: 'var(--cream2)', minHeight: '100%' }}>
      {/* Slim hero — greeting + tappable name */}
      <div style={{
        background: 'var(--gradient-primary)',
        padding: '22px 18px 20px', borderRadius: '0 0 24px 24px',
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
          <button onClick={() => setStatsOpen(true)} style={{
            background: 'none', border: 'none', padding: 0, cursor: 'pointer',
            color: '#fff', fontSize: 28, fontWeight: 900, marginTop: 2, letterSpacing: '-.02em',
            display: 'inline-flex', alignItems: 'baseline', gap: 8, fontFamily: 'inherit',
          }}>
            {user?.name?.split(' ')[0]}
            <span aria-hidden style={{ fontSize: 14, opacity: .7, fontWeight: 500 }}>▾</span>
          </button>

          {/* Week event cards — styled to sit inside the glassy hero */}
          <div style={{ marginTop: 16 }}>
            {showingFallback && (
              <div style={{
                fontSize: 11, fontWeight: 700, color: 'rgba(245,240,232,.8)',
                textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8,
              }}>
                Nothing this week — here's what's coming
              </div>
            )}

            {displayed.length === 0 ? (
              <div style={{
                background: 'rgba(240,253,244,.12)', borderRadius: 12, padding: '18px 14px',
                border: '1px solid rgba(134,239,172,.2)', textAlign: 'center',
                color: 'rgba(245,240,232,.75)', fontSize: 13,
              }}>
                No events scheduled.
              </div>
            ) : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: displayed.length === 1 ? '1fr' : 'repeat(auto-fill, minmax(150px, 1fr))',
                gap: 8,
              }}>
                {sortedDisplayed.map(ev => {
                  const isMine = !isAdmin && (ev.workers || []).some((w: any) => w.id === user?.id)
                  const spend = eventSpend(ev)
                  const status = eventDayStatus(ev)
                  return (
                    <button key={ev.id} onClick={() => openEvent(ev)} style={{
                      background: 'rgba(240,253,244,.95)', borderRadius: 12,
                      border: isMine ? '2px solid #F59E0B' : '1px solid var(--green3)',
                      padding: '10px 12px', textAlign: 'left', cursor: 'pointer',
                      position: 'relative', fontFamily: 'inherit',
                      boxShadow: '0 2px 8px rgba(0,0,0,.1)',
                      display: 'flex', flexDirection: 'column', gap: 2,
                    }}>
                      {isMine && (
                        <span style={{
                          position: 'absolute', top: 6, right: 6,
                          background: '#F59E0B', color: '#fff',
                          fontSize: 9, fontWeight: 900, letterSpacing: '.06em',
                          padding: '2px 6px', borderRadius: 99,
                        }}>YOU</span>
                      )}
                      <div style={{
                        fontSize: 13, fontWeight: 900, color: 'var(--green-dark)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        paddingRight: isMine ? 40 : 0,
                      }}>{ev.store_name}</div>
                      {spend > 0 ? (
                        <>
                          <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--green-dark)', lineHeight: 1.1 }}>
                            {fmtMoney(spend)}
                          </div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--green-dark)', opacity: 0.65 }}>
                            {status}
                          </div>
                        </>
                      ) : (
                        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--green-dark)', opacity: 0.55 }}>
                          Not started
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Leaderboard (unchanged) */}
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
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

      {/* Name-tap personal stats popup */}
      {statsOpen && (
        <div onClick={() => setStatsOpen(false)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)',
          zIndex: 1100, display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
          animation: 'mdFade .2s ease-out',
        }}>
          <style>{`
            @keyframes mdFade { from { opacity: 0 } to { opacity: 1 } }
            @keyframes mdSlide { from { transform: translateY(20px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
          `}</style>
          <div onClick={e => e.stopPropagation()} style={{
            background: 'var(--cream)', width: '100%', maxWidth: 500,
            borderRadius: '20px 20px 0 0',
            padding: '16px 20px 28px',
            paddingBottom: 'max(env(safe-area-inset-bottom), 28px)',
            boxShadow: '0 -10px 40px rgba(0,0,0,.25)',
            animation: 'mdSlide .25s cubic-bezier(.2,1.2,.4,1)',
          }}>
            <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--pearl)', margin: '0 auto 14px' }} />

            {/* Avatar + name header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
              {user?.photo_url
                ? <img src={user.photo_url} alt="" style={{ width: 54, height: 54, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                : <div style={{
                    width: 54, height: 54, borderRadius: '50%',
                    background: myTier?.color || 'var(--green)',
                    color: '#fff', fontWeight: 900, fontSize: 22,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}>{user?.name?.charAt(0)}</div>
              }
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 19, fontWeight: 900, color: 'var(--ink)' }}>{user?.name}</div>
                <div style={{ fontSize: 12, color: 'var(--mist)' }}>Your {currentYear} so far</div>
              </div>
              <button onClick={() => setStatsOpen(false)} aria-label="Close" style={{
                background: 'var(--cream2)', border: 'none', cursor: 'pointer',
                width: 32, height: 32, borderRadius: 8,
                color: 'var(--mist)', fontSize: 18, fontWeight: 600,
              }}>×</button>
            </div>

            {/* Tier award */}
            {myTier && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 14,
                padding: '14px 16px', marginBottom: 14,
                background: `linear-gradient(135deg, ${myTier.color}22, ${myTier.color}11)`,
                border: `1px solid ${myTier.color}66`, borderRadius: 14,
              }}>
                <div style={{ fontSize: 36, lineHeight: 1 }}>{myTier.icon}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: myTier.color, textTransform: 'uppercase', letterSpacing: '.08em' }}>Status</div>
                  <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--ink)' }}>{myTier.label}</div>
                </div>
              </div>
            )}

            {/* Three stat tiles */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 6 }}>
              {[
                { label: 'Days', value: String(myDays), color: 'var(--green)' },
                { label: 'Events', value: String(myEvents), color: '#3B82F6' },
                { label: 'Rank', value: myRank ? `#${myRank.rank}` : '—', color: myTier?.color || 'var(--mist)' },
              ].map(s => (
                <div key={s.label} style={{
                  background: '#fff', border: '1px solid var(--pearl)',
                  borderRadius: 12, padding: '14px 10px', textAlign: 'center',
                }}>
                  <div style={{ fontSize: 26, fontWeight: 900, color: s.color as any, lineHeight: 1 }}>{s.value}</div>
                  <div style={{ fontSize: 10, color: 'var(--mist)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', marginTop: 4 }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
