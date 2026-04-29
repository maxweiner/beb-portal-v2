'use client'

// Single source of truth for "this user's events" used by the dashboard
// Next-Event card and the profile sheet. Reads from useApp().events
// (already in context — no extra DB round-trip) and filters to the
// signed-in user's assignments.
//
// Events have no end_date column today; we treat them as 3-day events
// (start_date + 2). Same assumption as lib/eventStaffing.ts.

import { useMemo } from 'react'
import { useApp } from './context'
import type { Event } from '@/types'

const ASSUMED_EVENT_LENGTH_DAYS = 3

function todayIsoLocal(): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function eventEndIso(startIso: string): string {
  const d = new Date(startIso + 'T12:00:00')
  d.setDate(d.getDate() + (ASSUMED_EVENT_LENGTH_DAYS - 1))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export interface MyEventsResult {
  /** Soonest upcoming or in-progress event for the current user. */
  nextEvent: Event | null
  /** All upcoming + in-progress events, sorted ascending by start_date. */
  upcomingEvents: Event[]
  /** All past events, sorted descending by start_date. */
  pastEvents: Event[]
  /** True once the user + events context is hydrated. */
  loaded: boolean
}

export function useMyEvents(): MyEventsResult {
  const { user, events } = useApp()

  return useMemo(() => {
    const userId = user?.id
    if (!userId) {
      return { nextEvent: null, upcomingEvents: [], pastEvents: [], loaded: !!user }
    }
    const today = todayIsoLocal()
    const mine = events.filter(ev =>
      (ev.workers || []).some((w: any) => w.id === userId && !w.deleted)
    )

    const upcoming: Event[] = []
    const past: Event[] = []
    for (const ev of mine) {
      if (!ev.start_date) continue
      if (eventEndIso(ev.start_date) >= today) upcoming.push(ev)
      else past.push(ev)
    }
    upcoming.sort((a, b) => a.start_date.localeCompare(b.start_date))
    past.sort((a, b) => b.start_date.localeCompare(a.start_date))

    return {
      nextEvent: upcoming[0] ?? null,
      upcomingEvents: upcoming,
      pastEvents: past,
      loaded: true,
    }
  }, [user?.id, events])
}

/**
 * Countdown label + emphasis for the Next Event card.
 *  - "In 6 days" / "Tomorrow"      → normal
 *  - "Today"                       → attention (event starts today)
 *  - "Day 2 of 3" / "Day 3 of 3"   → attention (in progress)
 */
export function eventCountdown(startIso: string): { label: string; emphasis: 'normal' | 'attention' } {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const start = new Date(startIso + 'T12:00:00'); start.setHours(0, 0, 0, 0)
  const diff = Math.round((start.getTime() - today.getTime()) / 86400000)

  if (diff > 1) return { label: `In ${diff} days`, emphasis: 'normal' }
  if (diff === 1) return { label: 'Tomorrow', emphasis: 'normal' }
  if (diff === 0) return { label: 'Today', emphasis: 'attention' }
  if (diff >= -(ASSUMED_EVENT_LENGTH_DAYS - 1)) {
    return { label: `Day ${1 - diff} of ${ASSUMED_EVENT_LENGTH_DAYS}`, emphasis: 'attention' }
  }
  return { label: '', emphasis: 'normal' }
}

/**
 * Format an event's date range. 3-day events span start..start+2.
 *   "Mar 11–14, 2026"   when start and end share month / year
 *   "Feb 28 – Mar 2, 2026"   when they cross a month boundary
 */
export function formatEventRange(startIso: string): string {
  const start = new Date(startIso + 'T12:00:00')
  const end = new Date(start); end.setDate(end.getDate() + (ASSUMED_EVENT_LENGTH_DAYS - 1))
  const sm = start.toLocaleDateString('en-US', { month: 'short' })
  const em = end.toLocaleDateString('en-US', { month: 'short' })
  const year = start.getFullYear()
  return sm !== em
    ? `${sm} ${start.getDate()} – ${em} ${end.getDate()}, ${year}`
    : `${sm} ${start.getDate()}–${end.getDate()}, ${year}`
}
