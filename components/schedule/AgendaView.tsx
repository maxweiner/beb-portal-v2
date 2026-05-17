'use client'

// Scrollable month-grouped list with a sticky "jump to month" sidebar
// (desktop) or horizontal pill row (mobile). Merges buying events and
// trunk shows into one chronological feed.

import type { Event } from '@/types'
import { CALENDAR_COLORS } from '@/lib/calendarColors'
import { eventSpend } from '@/lib/eventSpend'
import { buyingMainColor, evDays } from './helpers'
import type { TrunkShowOverlay } from './types'

type AgendaItem =
  | { kind: 'event';  start_date: string; ev: Event }
  | { kind: 'trunk';  start_date: string; ts: TrunkShowOverlay }

export default function AgendaView({ events, stores, onSelect, isNarrow, trunkShows = [], users = [], onOpenTrunkShow }: { events: Event[]; stores: any[]; onSelect: (e: Event) => void; isNarrow: boolean; trunkShows?: TrunkShowOverlay[]; users?: any[]; onOpenTrunkShow?: (id: string) => void }) {
  const today = new Date(); today.setHours(0,0,0,0)
  const todayStr = today.toISOString().slice(0,10)

  const items: AgendaItem[] = [
    ...events.map(ev => ({ kind: 'event' as const, start_date: ev.start_date, ev })),
    ...trunkShows.map(ts => ({ kind: 'trunk' as const, start_date: ts.start_date, ts })),
  ].sort((a, b) => a.start_date.localeCompare(b.start_date))

  const grouped: Record<string, AgendaItem[]> = {}
  items.forEach(it => {
    const key = it.start_date.slice(0,7)
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(it)
  })

  const fmtMonth = (k: string) => new Date(k+'-15').toLocaleDateString('en-US', {month:'long', year:'numeric'})
  const fmtDate = (ds: string) => new Date(ds+'T12:00:00').toLocaleDateString('en-US', {weekday:'short', month:'short', day:'numeric'})

  const isPast = (ev: Event) => new Date(ev.start_date+'T12:00:00') < today
  const isUpcoming = (ev: Event) => !isPast(ev)

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: isNarrow ? '1fr' : '180px 1fr',
      gap: isNarrow ? 14 : 24, alignItems: 'start',
    }}>
      {/* Mini month index — desktop: sticky sidebar; mobile: horizontal scroll row */}
      {isNarrow ? (
        <div style={{
          display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4,
          WebkitOverflowScrolling: 'touch',
        }}>
          {Object.keys(grouped).map(k => (
            <a key={k} href={`#month-${k}`} style={{
              flexShrink: 0, padding: '8px 12px', borderRadius: 99,
              fontSize: 13, fontWeight: 700, textDecoration: 'none',
              color: k === todayStr.slice(0,7) ? 'var(--green-dark)' : 'var(--ash)',
              background: k === todayStr.slice(0,7) ? 'var(--green-pale)' : 'var(--cream2)',
              border: '1px solid var(--pearl)', minHeight: 36, display: 'inline-flex', alignItems: 'center',
            }}>
              {fmtMonth(k)} · {grouped[k].length}
            </a>
          ))}
        </div>
      ) : (
        <div className="card card-accent" style={{ margin: 0, position: 'sticky', top: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--mist)', marginBottom: 10 }}>Jump to Month</div>
          {Object.keys(grouped).map(k => (
            <a key={k} href={`#month-${k}`} style={{
              display: 'block', padding: '5px 8px', borderRadius: 6, fontSize: 13, fontWeight: 600,
              color: 'var(--green-dark)', textDecoration: 'none', marginBottom: 2,
              background: k === todayStr.slice(0,7) ? 'var(--green-pale)' : 'transparent',
            }}>
              {fmtMonth(k)}
              <span style={{ float: 'right', fontSize: 11, color: 'var(--mist)', fontWeight: 400 }}>{grouped[k].length}</span>
            </a>
          ))}
        </div>
      )}

      {/* Event list */}
      <div>
        {Object.entries(grouped).map(([monthKey, monthItems]) => (
          <div key={monthKey} id={`month-${monthKey}`} style={{ marginBottom: 32 }}>
            <div style={{ fontSize: 13, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--green)', marginBottom: 12, paddingBottom: 8, borderBottom: '2px solid var(--green3)' }}>
              {fmtMonth(monthKey)}
            </div>
            {monthItems.map(it => {
              if (it.kind === 'trunk') {
                const t = it.ts
                const past = t.end_date < todayStr
                const repName = t.assigned_rep_id ? users.find((u: any) => u.id === t.assigned_rep_id)?.name : null
                return (
                  <div key={`trunk-${t.id}`} onClick={onOpenTrunkShow ? () => onOpenTrunkShow(t.id) : undefined} style={{
                    display: 'flex', flexDirection: isNarrow ? 'column' : 'row', gap: isNarrow ? 10 : 14,
                    alignItems: isNarrow ? 'stretch' : 'flex-start',
                    padding: '14px 16px', marginBottom: 10, borderRadius: 'var(--r)',
                    background: 'var(--cream)', border: '1px solid var(--pearl)',
                    borderLeft: `4px solid ${CALENDAR_COLORS.trunk.main}`,
                    cursor: onOpenTrunkShow ? 'pointer' : 'default', opacity: past ? 0.65 : 1,
                  }}>
                    <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flex: 1, minWidth: 0 }}>
                      <div style={{ textAlign: 'center', minWidth: 48, flexShrink: 0 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--mist)' }}>
                          {new Date(t.start_date+'T12:00:00').toLocaleDateString('en-US', {month:'short'})}
                        </div>
                        <div style={{ fontSize: 24, fontWeight: 900, color: 'var(--ink)', lineHeight: 1 }}>
                          {new Date(t.start_date+'T12:00:00').getDate()}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--mist)' }}>
                          {new Date(t.start_date+'T12:00:00').toLocaleDateString('en-US', {weekday:'short'})}
                        </div>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 900, fontSize: 15, color: 'var(--ink)', marginBottom: 2 }}>💼 {t.store_name}</div>
                        <div style={{ fontSize: 13, color: 'var(--mist)', marginBottom: 6 }}>
                          {fmtDate(t.start_date)} — {fmtDate(t.end_date)}
                          {t.city && <> · {t.city}{t.state ? `, ${t.state}` : ''}</>}
                          <span style={{ marginLeft: 8, fontSize: 10, background: CALENDAR_COLORS.trunk.light, color: CALENDAR_COLORS.trunk.text, padding: '1px 6px', borderRadius: 99, fontWeight: 700 }}>Trunk Show</span>
                          {past && <span style={{ marginLeft: 6, fontSize: 10, background: 'var(--cream2)', padding: '1px 6px', borderRadius: 99, fontWeight: 700 }}>Past</span>}
                        </div>
                        {repName && (
                          <div style={{ fontSize: 11, color: 'var(--mist)' }}>Rep: <strong style={{ color: 'var(--ink)' }}>{repName}</strong></div>
                        )}
                        {!repName && (
                          <div style={{ fontSize: 11, color: 'var(--mist)', fontStyle: 'italic' }}>Unassigned</div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              }
              const ev = it.ev
              const past = isPast(ev)
              const color = buyingMainColor()
              const dollars = eventSpend(ev)
              const purchases = ev.days.reduce((s,d) => s + (d.purchases||0), 0)
              return (
                <div key={ev.id} onClick={() => onSelect(ev)} style={{
                  display: 'flex',
                  flexDirection: isNarrow ? 'column' : 'row',
                  gap: isNarrow ? 10 : 14,
                  alignItems: isNarrow ? 'stretch' : 'flex-start',
                  padding: '14px 16px', marginBottom: 10, borderRadius: 'var(--r)',
                  background: 'var(--cream)', border: `1px solid var(--pearl)`,
                  borderLeft: `4px solid ${color}`,
                  cursor: 'pointer', opacity: past ? 0.65 : 1,
                  transition: 'box-shadow .15s',
                }}>
                  {/* Top row on mobile: date + info */}
                  <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flex: 1, minWidth: 0 }}>
                    <div style={{ textAlign: 'center', minWidth: 48, flexShrink: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--mist)' }}>
                        {new Date(ev.start_date+'T12:00:00').toLocaleDateString('en-US', {month:'short'})}
                      </div>
                      <div style={{ fontSize: 24, fontWeight: 900, color: 'var(--ink)', lineHeight: 1 }}>
                        {new Date(ev.start_date+'T12:00:00').getDate()}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--mist)' }}>
                        {new Date(ev.start_date+'T12:00:00').toLocaleDateString('en-US', {weekday:'short'})}
                      </div>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 900, fontSize: 15, color: 'var(--ink)', marginBottom: 2 }}>◆ {ev.store_name}</div>
                      <div style={{ fontSize: 13, color: 'var(--mist)', marginBottom: 6 }}>
                        {fmtDate(ev.start_date)} — {fmtDate(evDays(ev)[2])}
                        {past && <span style={{ marginLeft: 8, fontSize: 10, background: 'var(--cream2)', padding: '1px 6px', borderRadius: 99, fontWeight: 700 }}>Past</span>}
                        {isUpcoming(ev) && <span style={{ marginLeft: 8, fontSize: 10, background: 'var(--green-pale)', color: 'var(--green-dark)', padding: '1px 6px', borderRadius: 99, fontWeight: 700 }}>Upcoming</span>}
                      </div>
                      {(ev.workers||[]).length > 0 && (
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {(ev.workers||[]).map((w:any) => (
                            <span key={w.id} style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 99, background: 'var(--green-pale)', color: 'var(--green-dark)' }}>👤 {w.name}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  {/* Stats — side on desktop, below (full width row) on mobile */}
                  {ev.days.length > 0 && (
                    <div style={{
                      display: 'flex',
                      gap: 16,
                      flexShrink: 0,
                      justifyContent: isNarrow ? 'flex-start' : 'flex-end',
                      paddingTop: isNarrow ? 10 : 0,
                      borderTop: isNarrow ? '1px solid var(--cream2)' : 'none',
                      marginLeft: isNarrow ? 62 : 0,
                    }}>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--green)' }}>{purchases}</div>
                        <div style={{ fontSize: 10, color: 'var(--mist)' }}>Purchases</div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--green)' }}>${Math.round(dollars/1000)}k</div>
                        <div style={{ fontSize: 10, color: 'var(--mist)' }}>Amount Spent</div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))}
        {Object.keys(grouped).length === 0 && (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--mist)' }}>No events yet.</div>
        )}
      </div>
    </div>
  )
}
