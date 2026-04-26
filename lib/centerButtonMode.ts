// Decides what the mobile bottom-nav center button shows.
//
// Two modes — `travel` (airplane to Travel Share) and `scan` (camera to
// the scan flow). The slide-out menu mirrors the swap so the OTHER item
// is always reachable from there:
//   travel mode → menu shows Camera; Travel Share hidden from menu
//   scan mode   → menu shows Travel Share; Camera hidden from menu
//
// User can override via Settings (Auto / Always Travel / Always Scan).
// In Auto, the choice flips to `scan` when the user is assigned to an
// event whose running window contains today.

import { useEffect, useState } from 'react'
import type { Event } from '@/types'

export type CenterMode = 'travel' | 'scan'
export type CenterModeOverride = 'auto' | 'always-travel' | 'always-scan'

export const CENTER_MODE_KEY = 'beb-center-button-mode'

export function getCenterModeOverride(): CenterModeOverride {
  if (typeof window === 'undefined') return 'auto'
  const v = window.localStorage.getItem(CENTER_MODE_KEY)
  if (v === 'always-travel' || v === 'always-scan' || v === 'auto') return v
  return 'auto'
}

export function setCenterModeOverride(v: CenterModeOverride): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(CENTER_MODE_KEY, v)
  // Notify same-tab listeners (storage event only fires in OTHER tabs).
  window.dispatchEvent(new CustomEvent('beb:center-mode-changed'))
}

/**
 * Returns true if the user is currently on a running event day.
 * Pure date math — uses the browser's local-day boundary. Events run
 * 3 days from start_date.
 */
function isOnRunningEventDay(events: Event[], userId?: string): boolean {
  if (!userId) return false
  const today = new Date().toISOString().slice(0, 10)
  return events.some(ev => {
    const isAssigned = (ev.workers || []).some((w: any) => w.id === userId)
    if (!isAssigned) return false
    const last = new Date(ev.start_date + 'T12:00:00')
    last.setDate(last.getDate() + 2)
    return ev.start_date <= today && today <= last.toISOString().slice(0, 10)
  })
}

export function useCenterButtonMode(events: Event[], userId?: string): CenterMode {
  const [override, setOverrideState] = useState<CenterModeOverride>('auto')
  useEffect(() => {
    setOverrideState(getCenterModeOverride())
    const onChange = () => setOverrideState(getCenterModeOverride())
    window.addEventListener('beb:center-mode-changed', onChange as EventListener)
    window.addEventListener('storage', onChange)
    return () => {
      window.removeEventListener('beb:center-mode-changed', onChange as EventListener)
      window.removeEventListener('storage', onChange)
    }
  }, [])

  if (override === 'always-travel') return 'travel'
  if (override === 'always-scan') return 'scan'
  return isOnRunningEventDay(events, userId) ? 'scan' : 'travel'
}
