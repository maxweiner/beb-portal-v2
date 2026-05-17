'use client'

// Shared helpers for the Schedule module. Mostly pure date utilities +
// the calendar palette constants; useIsNarrow is the one React hook
// here (called by the Schedule orchestrator and the picked-up via the
// isNarrow prop on every view component).

import { useState, useEffect } from 'react'
import type { Event } from '@/types'
import { CALENDAR_COLORS, type CalendarFamily } from '@/lib/calendarColors'
import type { TradeShowOverlay, TrunkShowOverlay } from './types'

export function useIsNarrow(breakpoint = 768) {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.innerWidth <= breakpoint
  )
  useEffect(() => {
    const handler = () => setNarrow(window.innerWidth <= breakpoint)
    handler()
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [breakpoint])
  return narrow
}

// Calendar palette consolidated to 3 families (buying / trunk / trade)
// 2026-05-06. storeColor / COLORS rotation retired — every buying event
// is now blue regardless of store. Reserved events render dashed.
export const FAMILY_BUYING: CalendarFamily = 'buying'
export const FAMILY_TRUNK:  CalendarFamily = 'trunk'
export const FAMILY_TRADE:  CalendarFamily = 'trade'

/** All buying events use the blue family. Reserved (STD) events get
 *  a dashed outline + light fill via eventChipStyle(); see callers. */
export function buyingMainColor(): string {
  return CALENDAR_COLORS.buying.main
}

/** All three days an event covers, as ISO date strings (start_date + 0/1/2). */
export function evDays(ev: Event): string[] {
  return [0,1,2].map(i => {
    const d = new Date(ev.start_date + 'T12:00:00')
    d.setDate(d.getDate() + i)
    return d.toISOString().slice(0,10)
  })
}

/** Enumerate every ISO date in a trade show's range, capped defensively at 30. */
export function tradeShowDays(t: TradeShowOverlay): string[] {
  const out: string[] = []
  if (!t.start_date || !t.end_date) return out
  const s = new Date(t.start_date + 'T12:00:00')
  const e = new Date(t.end_date + 'T12:00:00')
  for (let d = new Date(s); d <= e && out.length < 30; d.setDate(d.getDate() + 1)) {
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

/** Enumerate every ISO date in a trunk show's range, capped defensively at 30. */
export function trunkShowDays(t: TrunkShowOverlay): string[] {
  const out: string[] = []
  if (!t.start_date || !t.end_date) return out
  const s = new Date(t.start_date + 'T12:00:00')
  const e = new Date(t.end_date + 'T12:00:00')
  for (let d = new Date(s); d <= e && out.length < 30; d.setDate(d.getDate() + 1)) {
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

/**
 * Per-week bar layout for any date-ranged item (event / trade / trunk).
 * Returns a list of segments with grid-column placement + a track index
 * so multiple overlapping items stack visually without colliding.
 *
 * Greedy track assignment, sorted by length-desc + start-asc so longer
 * bars take the top tracks (typical month-calendar look).
 */
export interface WeekSegment<T> {
  item: T
  startCol: number   // 0-6
  span: number       // 1-7
  isStart: boolean   // bar's first column matches the item's actual start day
  isEnd: boolean     // bar's last column matches the item's actual end day
  track: number
}
export function computeWeekSegments<T>(
  weekDates: string[],  // 7 ISO date strings
  items: T[],
  getRange: (item: T) => { start: string | null; end: string | null },
): WeekSegment<T>[] {
  const weekStart = weekDates[0]
  const weekEnd = weekDates[6]
  type Tmp = Omit<WeekSegment<T>, 'track'>
  const tmp: Tmp[] = []
  for (const item of items) {
    const r = getRange(item)
    if (!r.start || !r.end) continue
    if (r.end < weekStart || r.start > weekEnd) continue
    const segStart = r.start < weekStart ? weekStart : r.start
    const segEnd   = r.end   > weekEnd   ? weekEnd   : r.end
    const startCol = weekDates.indexOf(segStart)
    const endCol   = weekDates.indexOf(segEnd)
    if (startCol < 0 || endCol < 0) continue
    tmp.push({
      item,
      startCol,
      span: endCol - startCol + 1,
      isStart: r.start === segStart,
      isEnd:   r.end   === segEnd,
    })
  }
  // Longer first; ties go to earlier start so packing is deterministic.
  tmp.sort((a, b) => (b.span - a.span) || (a.startCol - b.startCol))
  const out: WeekSegment<T>[] = []
  for (const s of tmp) {
    let track = 0
    while (out.some(t =>
      t.track === track &&
      !(s.startCol + s.span - 1 < t.startCol || s.startCol > t.startCol + t.span - 1)
    )) track++
    out.push({ ...s, track })
  }
  return out
}
