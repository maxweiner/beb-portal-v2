'use client'

import { useState } from 'react'
import { useApp } from '@/lib/context'
import type { NavPage } from '@/app/page'
import { leaderboardBuyers } from '@/lib/leaderboard'

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

// Count days worked: past events = 3 days, current/future = days with data
const countDays = (ev: any) => {
  const end = new Date(ev.start_date + 'T12:00:00')
  end.setDate(end.getDate() + 2)
  end.setHours(23, 59, 59)
  const isPast = end < new Date()
  return isPast ? 3 : (ev.days || []).length
}


export default function Dashboard({ setNav }: { setNav?: (n: NavPage) => void }) {
  const { user, users, stores, events, year, setYear } = useApp()
  const [expandedBuyerId, setExpandedBuyerId] = useState<string | null>(null)

  const YEARS = Array.from(
    { length: new Date().getFullYear() - 2017 },
    (_, i) => String(2018 + i)
  ).reverse()

  const yearEvents = events.filter(e => e.start_date?.startsWith(year))

  // This week: Monday to Sunday
  const today = new Date()
  const dayOfWeek = today.getDay() // 0=Sun, 1=Mon...
  const monday = new Date(today)
  monday.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1))
  monday.setHours(0, 0, 0, 0)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  sunday.setHours(23, 59, 59, 999)

  // An event "falls in" the week if ANY of its 3 days overlaps Mon–Sun.
  const overlapsWeek = (e: any, weekStart: Date, weekEnd: Date) => {
    if (!e.start_date) return false
    const evStart = new Date(e.start_date + 'T00:00:00')
    const evEnd = new Date(e.start_date + 'T00:00:00'); evEnd.setDate(evEnd.getDate() + 2)
    evEnd.setHours(23, 59, 59, 999)
    return evStart <= weekEnd && evEnd >= weekStart
  }
  const weekEvents = events.filter(e => overlapsWeek(e, monday, sunday))

  // Fallback: if nothing this week, peek at next week's window.
  const nextWeekStart = new Date(monday); nextWeekStart.setDate(monday.getDate() + 7)
  const nextWeekEnd = new Date(sunday); nextWeekEnd.setDate(sunday.getDate() + 7)
  const nextWeekFallback = weekEvents.length === 0
    ? events.filter(e => overlapsWeek(e, nextWeekStart, nextWeekEnd))
    : []
  const showingNextWeek = weekEvents.length === 0 && nextWeekFallback.length > 0
  const displayedEvents = weekEvents.length > 0 ? weekEvents : nextWeekFallback

  const getEventSpend = (ev: any): number =>
    (ev.days || []).reduce((s: number, d: any) => s + (Number(d.dollars10) || 0) + (Number(d.dollars5) || 0), 0)
  const getEventDayStatus = (ev: any): string => {
    const entered = (ev.days || []).filter((d: any) =>
      (Number(d.purchases) || 0) > 0 || (Number(d.dollars10) || 0) > 0 || (Number(d.dollars5) || 0) > 0
    ).length
    return entered === 0 ? '' : `Day ${entered} of 3`
  }

  const weekTotals = weekEvents.reduce((acc, ev) => {
    ev.days.forEach((d: any) => {
      acc.purchases  += d.purchases  || 0
      acc.customers  += d.customers  || 0
      acc.dollars    += parseFloat(d.dollars10 || 0) + parseFloat(d.dollars5 || 0)
      acc.commission += parseFloat(d.dollars10 || 0) * 0.10 + parseFloat(d.dollars5 || 0) * 0.05
    })
    return acc
  }, { purchases: 0, customers: 0, dollars: 0, commission: 0 })


  // Next week preview (only visible on Saturday/Sunday)
  const dayOfWeekNum = today.getDay() // 0=Sun, 6=Sat
  const isWeekend = dayOfWeekNum === 0 || dayOfWeekNum === 6
  const nextMonday = new Date(today)
  nextMonday.setDate(today.getDate() + (dayOfWeekNum === 0 ? 1 : 8 - dayOfWeekNum))
  nextMonday.setHours(0, 0, 0, 0)
  const nextSunday = new Date(nextMonday)
  nextSunday.setDate(nextMonday.getDate() + 6)
  nextSunday.setHours(23, 59, 59, 999)

  const nextWeekEvents = isWeekend ? events.filter(e => {
    const d = new Date(e.start_date + 'T12:00:00')
    return d >= nextMonday && d <= nextSunday
  }) : []

  const fmtNextWeek = `${nextMonday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${nextSunday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`

  const storeColors = ['#1D6B44', '#E67E22', '#9B59B6', '#3498DB', '#E74C3C', '#1ABC9C', '#F39C12', '#2C3E50']
  const fmtWeek = `${monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${sunday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`

  const totals = yearEvents.reduce((acc, ev) => {
    ev.days.forEach(d => {
      acc.customers  += d.customers  || 0
      acc.purchases  += d.purchases  || 0
      acc.dollars    += (d.dollars10 || 0) + (d.dollars5 || 0)
      acc.commission += (d.dollars10 || 0) * 0.10 + (d.dollars5 || 0) * 0.05
      acc.src_vdp         += d.src_vdp         || 0
      acc.src_postcard    += d.src_postcard    || 0
      acc.src_social      += d.src_social      || 0
      acc.src_wordofmouth += d.src_wordofmouth || 0
      acc.src_other       += d.src_other       || 0
      acc.src_repeat      += d.src_repeat      || 0
    })
    return acc
  }, { customers: 0, purchases: 0, dollars: 0, commission: 0, src_vdp: 0, src_postcard: 0, src_social: 0, src_wordofmouth: 0, src_other: 0, src_repeat: 0 })

  const closeRate = totals.customers > 0 ? Math.round(totals.purchases / totals.customers * 100) : 0

  const storeRows = stores.map(store => {
    const evs = yearEvents.filter(e => e.store_id === store.id)
    const days = evs.flatMap(e => e.days)
    const purchases = days.reduce((s, d) => s + (d.purchases || 0), 0)
    const customers = days.reduce((s, d) => s + (d.customers || 0), 0)
    const dollars = days.reduce((s, d) => s + (d.dollars10 || 0) + (d.dollars5 || 0), 0)
    const cr = customers > 0 ? Math.round(purchases / customers * 100) : 0
    return { store, evs: evs.length, purchases, customers, dollars, cr }
  }).filter(r => r.evs > 0).sort((a, b) => b.dollars - a.dollars)

  const srcTotal = totals.src_vdp + totals.src_postcard + totals.src_social + totals.src_wordofmouth + totals.src_other + totals.src_repeat
  const sources = [
    { label: 'VDP / Large Postcard', value: totals.src_vdp, color: '#059669' },
    { label: 'Store Postcard', value: totals.src_postcard, color: '#3B82F6' },
    { label: 'Social Media', value: totals.src_social, color: '#8B5CF6' },
    { label: 'Word of Mouth', value: totals.src_wordofmouth, color: '#F59E0B' },
    { label: 'Repeat Customer', value: totals.src_repeat, color: '#F43F5E' },
    { label: 'Other', value: totals.src_other, color: '#6B7280' },
  ]

  const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`
  // Roster = active buyers assigned to at least one current-year event in
  // the active brand. Brand-scoping happens upstream via context.events.
  const buyers = leaderboardBuyers(users, events)

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Hero: gradient header with greeting + week stats as interior pills */}
      <div style={{
        background: 'linear-gradient(160deg, var(--sidebar-bg) 0%, var(--green-dark) 50%, var(--green) 100%)',
        borderRadius: 20, padding: '26px 28px', marginBottom: 24,
        position: 'relative', overflow: 'hidden',
        boxShadow: '0 8px 28px rgba(29,107,68,.18)',
      }}>
        <div style={{
          position: 'absolute', top: -40, right: -80, width: 320, height: 320,
          borderRadius: '50%', background: 'rgba(134,239,172,.12)', filter: 'blur(40px)',
          pointerEvents: 'none',
        }} />
        <div style={{ position: 'relative' }}>
          <div className="flex items-start justify-between flex-wrap gap-3 mb-5">
            <div>
              <div style={{ color: 'rgba(245,240,232,.8)', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em' }}>
                Good {greeting}
              </div>
              <h1 style={{ color: '#fff', fontSize: 28, fontWeight: 900, letterSpacing: '-.02em', marginTop: 2 }}>
                {user?.name?.split(' ')[0]} 👋
              </h1>
              <div style={{ color: 'rgba(245,240,232,.6)', fontSize: 13, marginTop: 4 }}>
                {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} · Week of {fmtWeek}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span style={{ color: 'rgba(245,240,232,.6)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em' }}>Year</span>
              <select value={year} onChange={e => setYear(e.target.value)}
                style={{
                  padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 700,
                  background: 'rgba(255,255,255,.12)', color: '#fff',
                  border: '1px solid rgba(255,255,255,.2)', cursor: 'pointer',
                  WebkitAppearance: 'none', appearance: 'none',
                }}>
                {YEARS.map(y => <option key={y} style={{ color: 'var(--ink)' }}>{y}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Events This Week', value: weekEvents.length, sub: fmtWeek },
              { label: 'Purchases', value: weekTotals.purchases.toLocaleString(), sub: `${weekTotals.customers.toLocaleString()} customers` },
              { label: '💰 Amount Spent', value: fmt(weekTotals.dollars), sub: weekTotals.customers > 0 ? `${Math.round(weekTotals.purchases / weekTotals.customers * 100)}% close rate` : 'This week' },
              { label: 'Commission Due', value: fmt(weekTotals.commission), sub: '10% + 5% tiers' },
            ].map(({ label, value, sub }) => (
              <div key={label} style={{
                background: 'rgba(240,253,244,.95)', borderRadius: 12, padding: '14px 16px',
                border: '1px solid var(--green3)',
                boxShadow: '0 2px 10px rgba(0,0,0,.08)',
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--green-dark)', opacity: 0.7, textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</div>
                <div style={{ fontSize: 28, fontWeight: 900, color: 'var(--green-dark)', letterSpacing: '-.02em', marginTop: 4, lineHeight: 1 }}>{value}</div>
                <div style={{ fontSize: 11, color: 'var(--green-dark)', opacity: 0.6, marginTop: 4 }}>{sub}</div>
              </div>
            ))}
          </div>

          {/* This week's events — one card per event, live spend + day status */}
          {displayedEvents.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <div style={{
                fontSize: 11, fontWeight: 700, color: 'rgba(245,240,232,.75)',
                textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 10,
              }}>
                {showingNextWeek
                  ? 'Nothing this week — here\'s what\'s coming'
                  : 'This week\'s events'}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
                {displayedEvents.map(ev => {
                  const spend = getEventSpend(ev)
                  const status = getEventDayStatus(ev)
                  const store = stores.find(s => s.id === ev.store_id)
                  return (
                    <button key={ev.id} onClick={() => setNav?.('events')} style={{
                      background: 'rgba(240,253,244,.95)', borderRadius: 12, padding: '14px 16px',
                      border: '1px solid var(--green3)',
                      boxShadow: '0 2px 10px rgba(0,0,0,.08)',
                      textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
                      display: 'flex', flexDirection: 'column', gap: 4,
                    }}>
                      <div style={{
                        fontSize: 14, fontWeight: 900, color: 'var(--green-dark)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>{ev.store_name}</div>
                      <div style={{ fontSize: 11, color: 'var(--green-dark)', opacity: 0.65 }}>
                        {store?.city}{store?.state ? ', ' + store.state : ''}
                      </div>
                      {spend > 0 ? (
                        <div style={{ marginTop: 4, display: 'flex', alignItems: 'baseline', gap: 8 }}>
                          <span style={{ fontSize: 22, fontWeight: 900, color: 'var(--green-dark)' }}>{fmt(spend)}</span>
                          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--green-dark)', opacity: 0.65 }}>{status}</span>
                        </div>
                      ) : (
                        <div style={{ marginTop: 4, fontSize: 11, fontWeight: 700, color: 'var(--green-dark)', opacity: 0.55 }}>
                          Not started
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Next Week Preview — only on weekends */}
      {isWeekend && nextWeekEvents.length > 0 && (
        <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--r2)', border: '1px solid var(--pearl)', marginBottom: 24, overflow: 'hidden' }}>
          <div style={{ background: 'var(--green-pale)', padding: '12px 20px', borderBottom: '1px solid var(--green3)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--green)', boxShadow: '0 0 0 3px rgba(29,107,68,.15)' }} />
              <span style={{ fontWeight: 900, fontSize: 13, color: 'var(--green-dark)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Next Week</span>
              <span style={{ fontSize: 12, color: 'var(--green-dark)', opacity: 0.7 }}>{fmtNextWeek}</span>
            </div>
            <span style={{ fontSize: 12, fontWeight: 900, color: 'var(--green-dark)' }}>{nextWeekEvents.length} event{nextWeekEvents.length !== 1 ? 's' : ''}</span>
          </div>
          <div style={{ padding: '16px 20px' }}>
          <div style={{ display: 'flex', gap: 12, overflowX: 'auto' }}>
            {nextWeekEvents.sort((a, b) => a.start_date.localeCompare(b.start_date)).map((ev, i) => {
              const store = stores.find(s => s.id === ev.store_id)
              const evStart = new Date(ev.start_date + 'T12:00:00')
              const evEnd = new Date(ev.start_date + 'T12:00:00')
              evEnd.setDate(evEnd.getDate() + 2)
              const fmtD = (d: Date) => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
              const evWorkersList = (ev.workers || []).filter((w: any) => w.name)
              return (
                <div key={ev.id} style={{ minWidth: 190, flex: 1, background: 'var(--cream2)', borderRadius: 'var(--r)', padding: '12px 14px', borderLeft: `3px solid ${storeColors[i % storeColors.length]}` }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--ink)', marginBottom: 2 }}>{ev.store_name}</div>
                  <div style={{ fontSize: 12, color: 'var(--mist)' }}>{store?.city}{store?.city && store?.state ? ', ' : ''}{store?.state}</div>
                  <div style={{ fontSize: 11, color: 'var(--fog)', marginTop: 6 }}>{fmtD(evStart)} – {fmtD(evEnd)}</div>
                  {evWorkersList.length > 0 && (
                    <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                      {evWorkersList.map((w: any) => {
                        const u = users.find((x: any) => x.id === w.id)
                        const tip = [u?.phone, u?.email].filter(Boolean).join(' · ') || ''
                        return (
                          <span key={w.id} title={tip} style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'var(--green-pale)', color: 'var(--green-dark)', fontWeight: 700, cursor: tip ? 'help' : 'default' }}>{w.name?.split(' ')[0]}</span>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Store performance table */}
        <div className="lg:col-span-2 rounded-xl overflow-hidden" style={{ background: 'var(--card-bg)', border: '1px solid var(--pearl)', boxShadow: '0 2px 10px rgba(0,0,0,.04)' }}>
          <div style={{ background: 'var(--green-pale)', padding: '12px 20px', borderBottom: '1px solid var(--green3)', fontWeight: 900, fontSize: 13, color: 'var(--green-dark)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
            Store Performance — {year}
          </div>
          {storeRows.length === 0 ? (
            <div className="text-center py-10" style={{ color: 'var(--mist)' }}>No data for {year}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--cream2)', background: 'var(--cream2)' }}>
                    {['Store', 'Events', 'Purchases', 'Close Rate', '💰 Amount Spent'].map(h => (
                      <th key={h} className="text-left px-5 py-2.5 text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--mist)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {storeRows.map(({ store, evs, purchases, customers, dollars, cr }) => (
                    <tr key={store.id} style={{ borderBottom: '1px solid var(--cream2)' }}>
                      <td className="px-5 py-3 font-semibold" style={{ color: 'var(--ink)' }}>{store.name}</td>
                      <td className="px-5 py-3" style={{ color: 'var(--mist)' }}>{evs}</td>
                      <td className="px-5 py-3 font-bold" style={{ color: 'var(--ink)' }}>{purchases.toLocaleString()}</td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 rounded-full overflow-hidden max-w-20" style={{ background: 'var(--cream2)' }}>
                            <div className="h-full rounded-full" style={{ width: `${cr}%`, background: 'var(--green)' }} />
                          </div>
                          <span className="text-xs" style={{ color: 'var(--mist)' }}>{cr}%</span>
                        </div>
                      </td>
                      <td className="px-5 py-3 font-bold" style={{ color: 'var(--green)' }}>{fmt(dollars)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Lead sources */}
        <div className="card">
          <div className="font-black text-sm mb-4" style={{ color: 'var(--ink)' }}>Lead Sources — {year}</div>
          <div className="space-y-3">
            {sources.map(({ label, value, color }) => {
              const pct = srcTotal > 0 ? Math.round(value / srcTotal * 100) : 0
              return (
                <div key={label}>
                  <div className="flex justify-between text-xs mb-1">
                    <span style={{ color: 'var(--ash)' }}>{label}</span>
                    <span className="font-bold" style={{ color: 'var(--ink)' }}>{pct}%</span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--cream2)' }}>
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
                  </div>
                </div>
              )
            })}
          </div>


          {/* Leaderboard mini */}
          {buyers.length > 0 && (
            <div className="mt-6 pt-5" style={{ borderTop: '1px solid var(--cream2)' }}>
              <div className="font-black text-sm mb-3" style={{ color: 'var(--ink)' }}>🏆 {new Date().getFullYear()} Standings</div>
              <div className="space-y-2">
                {(() => {
                  const currentYear = String(new Date().getFullYear())
                  const currentYearEvents = events.filter(e => e.start_date?.startsWith(currentYear))
                  const ranked = buyers.map(b => {
                    const days = currentYearEvents.reduce((s, ev) => {
                      const workedEvent = (ev.workers || []).some((w: any) => w.id === b.id)
                      return s + (workedEvent ? countDays(ev) : 0)
                    }, 0)
                    return { ...b, days }
                  }).sort((a, b) => b.days - a.days)

                  const ineligible = ['joe', 'max', 'rich'].map(n => n.toLowerCase())
                  let rank = 0; let lastDays = -1
                  return ranked.map((b, i) => {
                    if (b.days !== lastDays) { rank = i + 1; lastDays = b.days }
                    const isIneligible = ineligible.some(n => b.name?.toLowerCase().includes(n))
                    const tier = rank === 1 ? { label: 'Estate Elite', icon: '👑', color: '#B8860B', bg: 'rgba(184,134,11,.1)' }
                      : rank === 2 ? { label: 'Platinum', icon: '💎', color: '#6B7FD4', bg: 'rgba(107,127,212,.1)' }
                      : rank === 3 ? { label: 'Gold', icon: '🥇', color: '#C9A84C', bg: 'rgba(201,168,76,.1)' }
                      : null
                    const expanded = expandedBuyerId === b.id
                    const buyerEvents = expanded ? getBuyerEventsThisYear(b.id, events) : []
                    return (
                      <div key={b.id}>
                        <div
                          onClick={() => setExpandedBuyerId(expanded ? null : b.id)}
                          className="flex items-center justify-between text-sm"
                          style={{
                            padding: '4px 6px', borderRadius: 6,
                            background: tier ? tier.bg : 'transparent',
                            cursor: 'pointer',
                          }}>
                          <div className="flex items-center gap-2">
                            <span aria-hidden style={{
                              width: 10, display: 'inline-block',
                              color: 'var(--mist)', fontSize: 10, lineHeight: 1,
                              transform: expanded ? 'rotate(90deg)' : 'none',
                              transition: 'transform .15s',
                            }}>▸</span>
                            <div style={{ width: 18, fontSize: 11, fontWeight: 900, color: tier ? tier.color : 'var(--mist)', textAlign: 'center' }}>
                              {rank}
                            </div>
                            {b.photo_url ? (
                              <img src={b.photo_url} alt="" style={{ width: 24, height: 24, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                            ) : (
                              <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-black text-white"
                                style={{ background: tier ? tier.color : 'var(--green)', fontSize: 10 }}>
                                {b.name?.charAt(0)}
                              </div>
                            )}
                            <span style={{ color: 'var(--ash)', fontWeight: tier ? 700 : 400 }}>{b.name}</span>
                            {tier && <span style={{ fontSize: 10, fontWeight: 700, color: tier.color }}>{tier.icon} {tier.label}</span>}
                            {isIneligible && (
                              <span title="Not eligible for prize" style={{ fontSize: 10, color: 'var(--mist)', cursor: 'help' }}>*</span>
                            )}
                          </div>
                          <span className="text-xs font-bold" style={{ color: tier ? tier.color : 'var(--mist)' }}>{b.days} days</span>
                        </div>
                        {expanded && (
                          <div style={{
                            margin: '4px 6px 8px 32px',
                            background: 'var(--cream2)',
                            border: '1px solid var(--pearl)',
                            borderRadius: 6,
                            padding: '10px 12px',
                            animation: 'lbExpand .2s ease-out',
                          }}>
                            <style>{`@keyframes lbExpand { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }`}</style>
                            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--mist)', marginBottom: 6 }}>
                              {buyerEvents.length} event{buyerEvents.length === 1 ? '' : 's'}
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
                  })
                })()}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Full Leaderboard */}
      <Leaderboard events={events} users={users} buyers={buyers} />
    </div>
  )
}

/* ── LEADERBOARD ── */
function Leaderboard({ events, users, buyers }: { events: any[]; users: any[]; buyers: any[] }) {
  const currentYear = String(new Date().getFullYear())
  const currentYearEvents = events.filter(e => e.start_date?.startsWith(currentYear))
  const ineligible = ['joe', 'max', 'rich'].map(n => n.toLowerCase())

  const PRIZES: Record<number, { amount: string; label: string }> = {
    1: { amount: '$1,000', label: 'First Prize' },
    2: { amount: '$500', label: 'Second Prize' },
    3: { amount: '$250', label: 'Third Prize' },
  }

  const TIERS = [
    { rank: 1, label: 'Estate Elite', icon: '👑', color: '#D4A017', bg: 'linear-gradient(135deg, #F5C400, #FF9900)', textBg: 'rgba(245,196,0,.12)', border: '#F5C400' },
    { rank: 2, label: 'Platinum',     icon: '💎', color: '#5B6FBF', bg: 'linear-gradient(135deg, #3a4a8a, #6b7fd4)', textBg: 'rgba(107,127,212,.08)', border: '#6b7fd4' },
    { rank: 3, label: 'Gold',         icon: '🥇', color: '#9a7500', bg: 'linear-gradient(135deg, #6b5200, #c9a84c)', textBg: 'rgba(201,168,76,.08)', border: '#c9a84c' },
  ]

  const ranked = buyers.map(b => {
    const days = currentYearEvents.reduce((s, ev) => {
      const workedEvent = (ev.workers || []).some((w: any) => w.id === b.id)
      return s + (workedEvent ? countDays(ev) : 0)
    }, 0)
    const isIneligible = ineligible.some(n => b.name?.toLowerCase().includes(n))
    return { ...b, days, isIneligible }
  }).sort((a, b) => b.days - a.days)

  // Assign ranks (ties share rank)
  let rank = 0; let lastDays = -1
  const withRanks = ranked.map((b, i) => {
    if (b.days !== lastDays) { rank = i + 1; lastDays = b.days }
    return { ...b, rank }
  })

  const top3 = withRanks.filter(b => b.rank <= 3)
  const rest = withRanks.filter(b => b.rank > 3)
  const leader = withRanks[0]

  return (
    <div style={{ marginTop: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <div>
          <h2 className="text-xl font-black" style={{ color: 'var(--ink)', margin: 0 }}>
            🏆 {currentYear} Buyer Leaderboard
          </h2>
          <div style={{ fontSize: 13, color: 'var(--mist)', marginTop: 2 }}>
            Days with submitted data · Resets January 1st · <span style={{ color: 'var(--green)', fontWeight: 700 }}>Cash prizes for top 3 eligible buyers</span>
          </div>
        </div>
      </div>

      {/* Top 3 podium cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 20 }}>
        {TIERS.map(tier => {
          const buyer = top3.find(b => b.rank === tier.rank)
          const prize = PRIZES[tier.rank]
          const nextBuyer = withRanks.find(b => b.rank === tier.rank + 1)
          const gap = buyer && nextBuyer ? buyer.days - nextBuyer.days : 0

          return (
            <div key={tier.rank} style={{
              borderRadius: 16, overflow: 'hidden',
              border: `1px solid ${tier.border}`,
              boxShadow: tier.rank === 1 ? `0 4px 24px rgba(184,134,11,.2)` : '0 2px 8px rgba(0,0,0,.06)',
              background: 'var(--cream)',
            }}>
              {/* Gradient header */}
              <div style={{ background: tier.bg, padding: '16px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ fontSize: 28 }}>{tier.icon}</div>
                  <div style={{ color: 'rgba(255,255,255,.8)', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em' }}>
                    {prize.label}
                  </div>
                </div>
                <div style={{ color: '#fff', fontSize: 28, fontWeight: 900 }}>{prize.amount}</div>
                <div style={{ color: 'rgba(255,255,255,.7)', fontSize: 13, marginTop: 2 }}>{tier.label}</div>
              </div>

              {/* Buyer info */}
              <div style={{ padding: '16px 20px' }}>
                {buyer ? (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                      {buyer.photo_url ? (
                        <img src={buyer.photo_url} alt="" style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                      ) : (
                        <div style={{ width: 40, height: 40, borderRadius: '50%', background: tier.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 900, fontSize: 16, flexShrink: 0 }}>
                          {buyer.name?.charAt(0)}
                        </div>
                      )}
                      <div>
                        <div style={{ fontWeight: 900, fontSize: 15, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 6 }}>
                          {buyer.name}
                          {buyer.isIneligible && (
                            <span title="Not eligible for prize" style={{ fontSize: 11, color: 'var(--mist)', cursor: 'help', fontWeight: 400 }}>*</span>
                          )}
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--mist)' }}>{buyer.days} days worked</div>
                      </div>
                    </div>

                    {/* Progress bar to next rank */}
                    {tier.rank > 1 && leader && (
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: 11, color: 'var(--mist)', marginBottom: 4 }}>
                          {buyer.days === leader.days ? '🔥 Tied for the lead!' : `${leader.days - buyer.days} days behind ${leader.name?.split(' ')[0]}`}
                        </div>
                        <div style={{ height: 6, background: 'var(--cream2)', borderRadius: 99, overflow: 'hidden' }}>
                          <div style={{
                            height: '100%', borderRadius: 99,
                            background: tier.bg,
                            width: leader.days > 0 ? `${Math.round(buyer.days / leader.days * 100)}%` : '0%',
                            transition: 'width .5s',
                          }} />
                        </div>
                      </div>
                    )}

                    {/* Gap to next person */}
                    {gap > 0 && nextBuyer && (
                      <div style={{ fontSize: 11, color: 'var(--green)', fontWeight: 600 }}>
                        🛡 {gap} day{gap !== 1 ? 's' : ''} ahead of {nextBuyer.name?.split(' ')[0]}
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ textAlign: 'center', padding: '12px 0', color: 'var(--mist)', fontSize: 13 }}>
                    No one yet — could be you! 🎯
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

    </div>

  )
}
