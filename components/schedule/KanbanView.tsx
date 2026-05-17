'use client'

// Three-column Trello layout: Upcoming / Current / Past. "Current" is
// the ±7-day window around today; everything else falls into one of
// the side columns. Buying events + trunk shows mixed in each column.

import type { Event } from '@/types'
import { CALENDAR_COLORS } from '@/lib/calendarColors'
import { eventSpend } from '@/lib/eventSpend'
import { fmtMoney } from '@/lib/format'
import { buyingMainColor, evDays } from './helpers'
import type { TrunkShowOverlay } from './types'

type KanbanItem =
  | { kind: 'event'; start_date: string; ev: Event }
  | { kind: 'trunk'; start_date: string; ts: TrunkShowOverlay }

export default function KanbanView({ events, stores, onSelect, isNarrow, trunkShows = [], users = [], onOpenTrunkShow }: { events: Event[]; stores: any[]; onSelect: (e: Event) => void; isNarrow: boolean; trunkShows?: TrunkShowOverlay[]; users?: any[]; onOpenTrunkShow?: (id: string) => void }) {
  const today = new Date(); today.setHours(0,0,0,0)
  const weekMs = 7 * 24 * 60 * 60 * 1000

  const categorize = (start: string) => {
    const diff = new Date(start+'T12:00:00').getTime() - today.getTime()
    if (diff >= -weekMs && diff <= weekMs) return 'current'
    if (diff > weekMs) return 'upcoming'
    return 'past'
  }

  const allItems: KanbanItem[] = [
    ...events.map(ev => ({ kind: 'event' as const, start_date: ev.start_date, ev })),
    ...trunkShows.map(ts => ({ kind: 'trunk' as const, start_date: ts.start_date, ts })),
  ]

  const cols = [
    { id: 'upcoming', label: 'Upcoming', color: 'var(--green)', badge: 'badge-jade' },
    { id: 'current',  label: 'Current',  color: '#f59e0b',      badge: 'badge-gold' },
    { id: 'past',     label: 'Past',     color: 'var(--mist)',   badge: 'badge-silver' },
  ]

  const fmtDate = (ds: string) => new Date(ds+'T12:00:00').toLocaleDateString('en-US', {month:'short', day:'numeric'})

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: isNarrow ? '1fr' : 'repeat(3,1fr)',
      gap: isNarrow ? 20 : 16, alignItems: 'start',
    }}>
      {cols.map(col => {
        const colItems = allItems
          .filter(it => categorize(it.start_date) === col.id)
          .sort((a,b) => col.id === 'past'
            ? b.start_date.localeCompare(a.start_date)
            : a.start_date.localeCompare(b.start_date))

        return (
          <div key={col.id}>
            {/* Column header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: col.color }} />
              <div style={{ fontWeight: 900, fontSize: 14, color: 'var(--ink)' }}>{col.label}</div>
              <div style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: 'var(--cream2)', color: 'var(--mist)' }}>
                {colItems.length}
              </div>
            </div>

            {/* Cards */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {colItems.map(it => {
                if (it.kind === 'trunk') {
                  const t = it.ts
                  const repName = t.assigned_rep_id ? users.find((u: any) => u.id === t.assigned_rep_id)?.name : null
                  return (
                    <div key={`trunk-${t.id}`} onClick={onOpenTrunkShow ? () => onOpenTrunkShow(t.id) : undefined} style={{
                      background: 'var(--cream)', borderRadius: 'var(--r)',
                      border: '1px solid var(--pearl)', borderTop: `3px solid ${CALENDAR_COLORS.trunk.main}`,
                      padding: '12px 14px', cursor: onOpenTrunkShow ? 'pointer' : 'default',
                      boxShadow: '0 1px 4px rgba(0,0,0,.06)',
                    }}>
                      <div style={{ fontWeight: 900, fontSize: 13, color: 'var(--ink)', marginBottom: 4 }}>💼 {t.store_name}</div>
                      <div style={{ fontSize: 11, color: 'var(--mist)', marginBottom: 6 }}>
                        {fmtDate(t.start_date)} – {fmtDate(t.end_date)}
                        {t.city && <> · {t.city}{t.state ? `, ${t.state}` : ''}</>}
                      </div>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 99, background: CALENDAR_COLORS.trunk.light, color: CALENDAR_COLORS.trunk.text }}>Trunk Show</span>
                        {repName ? (
                          <span style={{ fontSize: 10, color: 'var(--mist)' }}>Rep: <strong style={{ color: 'var(--ink)' }}>{repName}</strong></span>
                        ) : (
                          <span style={{ fontSize: 10, color: 'var(--mist)', fontStyle: 'italic' }}>Unassigned</span>
                        )}
                      </div>
                    </div>
                  )
                }
                const ev = it.ev
                const color = buyingMainColor()
                const dollars = eventSpend(ev)
                const purchases = ev.days.reduce((s,d) => s + (d.purchases||0), 0)
                return (
                  <div key={ev.id} onClick={() => onSelect(ev)} style={{
                    background: 'var(--cream)', borderRadius: 'var(--r)',
                    border: '1px solid var(--pearl)', borderTop: `3px solid ${color}`,
                    padding: '12px 14px', cursor: 'pointer',
                    boxShadow: '0 1px 4px rgba(0,0,0,.06)',
                    transition: 'box-shadow .15s',
                  }}>
                    <div style={{ fontWeight: 900, fontSize: 13, color: 'var(--ink)', marginBottom: 4 }}>◆ {ev.store_name}</div>
                    <div style={{ fontSize: 11, color: 'var(--mist)', marginBottom: 8 }}>
                      {fmtDate(ev.start_date)} – {fmtDate(evDays(ev)[2])}
                    </div>
                    {(ev.workers||[]).length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                        {(ev.workers||[]).map((w:any) => (
                          <span key={w.id} style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 99, background: 'var(--green-pale)', color: 'var(--green-dark)' }}>👤 {w.name}</span>
                        ))}
                      </div>
                    )}
                    {ev.days.length > 0 && (
                      <div style={{ display: 'flex', gap: 12, paddingTop: 8, borderTop: '1px solid var(--cream2)' }}>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 900, color: 'var(--green)' }}>{purchases}</div>
                          <div style={{ fontSize: 9, color: 'var(--mist)', textTransform: 'uppercase' }}>Purchases</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 900, color: 'var(--green)' }}>{fmtMoney(dollars)}</div>
                          <div style={{ fontSize: 9, color: 'var(--mist)', textTransform: 'uppercase' }}>Amount Spent</div>
                        </div>
                      </div>
                    )}
                    {ev.days.length === 0 && (
                      <div style={{ fontSize: 11, color: 'var(--silver)', fontStyle: 'italic' }}>No data entered yet</div>
                    )}
                  </div>
                )
              })}
              {colItems.length === 0 && (
                <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--silver)', fontSize: 13 }}>None</div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
