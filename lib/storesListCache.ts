// Per-(user, brand) snapshot of the Buying Event Stores list. On
// second-and-later visits to the module, Stores.tsx reads the cache,
// paints the list instantly, then revalidates in the background and
// patches state when fresh data arrives. Stale-while-revalidate.
//
// Distinct from lib/bootCache.ts: that one snapshots the global boot
// fetch (users, stores w/o logos, events, shipments) for context.tsx;
// this one snapshots the Stores page's own slim-with-logo fetch.
//
// Keyed by AUTH user id (supabase session.user.id) + brand so a
// different user signing in on the same browser cannot accidentally
// read the prior user's data. Matches the bootCache key scheme.
//
// TTL is 7 days (same as bootCache).
//
// localStorage cap is ~5 MB. With the legacy-logo migration
// (scripts/migrate-legacy-store-logos.ts) run, the cached payload
// for hundreds of stores is well under 100 KB. Pre-migration, legacy
// rows carry ~100KB base64 each in store_image_url — writeStoresList
// uses the same QuotaExceeded fallback bootCache has (drop all stale
// stores caches and retry once; otherwise give up silently).

import type { Store, Brand } from '@/types'

const KEY_PREFIX = 'beb-storeslist-v1'
const TTL_MS = 1000 * 60 * 60 * 24 * 7  // 7 days

export interface StoresListCachePayload {
  authUid: string
  brand: Brand
  cachedAt: number
  stores: Store[]
}

function keyFor(authUid: string, brand: Brand): string {
  return `${KEY_PREFIX}:${authUid}:${brand}`
}

export function readStoresListCache(authUid: string, brand: Brand): StoresListCachePayload | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(keyFor(authUid, brand))
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoresListCachePayload
    if (parsed.authUid !== authUid || parsed.brand !== brand) return null
    if (Date.now() - parsed.cachedAt > TTL_MS) return null
    return parsed
  } catch {
    return null
  }
}

export function writeStoresListCache(authUid: string, brand: Brand, stores: Store[]): void {
  if (typeof window === 'undefined') return
  const payload: StoresListCachePayload = { authUid, brand, cachedAt: Date.now(), stores }
  const json = JSON.stringify(payload)
  try {
    window.localStorage.setItem(keyFor(authUid, brand), json)
  } catch {
    // QuotaExceeded most likely (legacy rows pre-migration can push
    // the payload past localStorage's 5MB cap). Drop other stores
    // caches and retry once; otherwise give up silently and let the
    // next visit refetch.
    try {
      clearAllStoresListCaches()
      window.localStorage.setItem(keyFor(authUid, brand), json)
    } catch { /* give up */ }
  }
}

export function clearStoresListCacheFor(authUid: string): void {
  if (typeof window === 'undefined') return
  const prefix = `${KEY_PREFIX}:${authUid}:`
  const toRemove: string[] = []
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i)
    if (k && k.startsWith(prefix)) toRemove.push(k)
  }
  toRemove.forEach(k => window.localStorage.removeItem(k))
}

export function clearAllStoresListCaches(): void {
  if (typeof window === 'undefined') return
  const prefix = `${KEY_PREFIX}:`
  const toRemove: string[] = []
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i)
    if (k && k.startsWith(prefix)) toRemove.push(k)
  }
  toRemove.forEach(k => window.localStorage.removeItem(k))
}
