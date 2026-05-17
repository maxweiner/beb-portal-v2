// Per-(user, brand) snapshot of the boot fetch (users, stores, events,
// shipments, trunk_show_stores). On second-and-later loads, lib/context.tsx
// reads the cache, hydrates state immediately, and dismisses the loading
// splash — then refetches in the background and updates state when fresh
// data arrives. Classic stale-while-revalidate.
//
// Keyed by AUTH user id (supabase session.user.id) + brand so a different
// user signing in on the same browser cannot accidentally read the prior
// user's data. Sign-out clears the prior user's cache as a privacy
// hygiene step even though the key check would already filter it out.
//
// TTL is 7 days. Beyond that, the cache entry is treated as missing so a
// laptop that's been closed for a week falls back to a fresh fetch
// instead of rendering very stale state.
//
// localStorage cap is ~5 MB. With buyer_entries(*) dropped from the
// events fetch (PR #733), the cached payload comfortably fits.

import type { User, Store, TrunkShowStore, Event, Shipment, Brand } from '@/types'

const KEY_PREFIX = 'beb-bootcache-v1'
const TTL_MS = 1000 * 60 * 60 * 24 * 7  // 7 days

export interface BootCachePayload {
  authUid: string
  brand: Brand
  cachedAt: number
  users: User[]
  stores: Store[]
  trunkShowStores: TrunkShowStore[]
  events: Event[]
  shipments: Shipment[]
}

function keyFor(authUid: string, brand: Brand): string {
  return `${KEY_PREFIX}:${authUid}:${brand}`
}

export function readBootCache(authUid: string, brand: Brand): BootCachePayload | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(keyFor(authUid, brand))
    if (!raw) return null
    const parsed = JSON.parse(raw) as BootCachePayload
    if (parsed.authUid !== authUid || parsed.brand !== brand) return null
    if (Date.now() - parsed.cachedAt > TTL_MS) return null
    return parsed
  } catch {
    return null
  }
}

export function writeBootCache(payload: BootCachePayload): void {
  if (typeof window === 'undefined') return
  const json = JSON.stringify(payload)
  try {
    window.localStorage.setItem(keyFor(payload.authUid, payload.brand), json)
  } catch {
    // QuotaExceeded most likely. Drop every stale boot cache and retry
    // once. If that still fails we give up silently — splash will just
    // show on next load like before.
    try {
      clearAllBootCaches()
      window.localStorage.setItem(keyFor(payload.authUid, payload.brand), json)
    } catch { /* give up */ }
  }
}

export function clearBootCacheFor(authUid: string): void {
  if (typeof window === 'undefined') return
  const prefix = `${KEY_PREFIX}:${authUid}:`
  const toRemove: string[] = []
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i)
    if (k && k.startsWith(prefix)) toRemove.push(k)
  }
  toRemove.forEach(k => window.localStorage.removeItem(k))
}

export function clearAllBootCaches(): void {
  if (typeof window === 'undefined') return
  const prefix = `${KEY_PREFIX}:`
  const toRemove: string[] = []
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i)
    if (k && k.startsWith(prefix)) toRemove.push(k)
  }
  toRemove.forEach(k => window.localStorage.removeItem(k))
}
