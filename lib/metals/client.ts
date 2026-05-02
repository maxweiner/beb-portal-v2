'use client'

// Client-side hook for the metals ticker. Reads the cache via
// supabase-js (RLS allows authenticated SELECT) and exposes a
// manual-refresh helper that hits the throttled API route.

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export type MetalKind = 'gold' | 'silver' | 'platinum'

export interface MetalRow {
  metal: MetalKind
  priceUsd: number
  changePercent24h: number | null
  fetchedAt: string
}

export interface MetalsState {
  rows: MetalRow[]
  /** Newest fetched_at across the rows. null if cache is empty. */
  newestFetchedAt: Date | null
  /** UI freshness bucket. */
  freshness: 'fresh' | 'stale' | 'very-stale' | 'empty'
  loading: boolean
  refreshing: boolean
  error: string | null
}

const FRESH_MS       = 30 * 60 * 1000      // < 30 min  → fresh
const STALE_MS       = 2 * 60 * 60 * 1000  // < 2h      → stale (show "as of" time)
                                           // ≥ 2h      → very-stale (subtle dot)

function bucket(newest: Date | null): MetalsState['freshness'] {
  if (!newest) return 'empty'
  const age = Date.now() - newest.getTime()
  if (age < FRESH_MS) return 'fresh'
  if (age < STALE_MS) return 'stale'
  return 'very-stale'
}

async function fetchRows(): Promise<MetalRow[]> {
  const { data, error } = await supabase
    .from('metals_prices_cache')
    .select('metal, price_usd_per_oz, change_percent_24h, fetched_at')
  if (error) throw new Error(error.message)
  return (data || []).map(r => ({
    metal: r.metal as MetalKind,
    priceUsd: Number(r.price_usd_per_oz),
    changePercent24h: r.change_percent_24h === null ? null : Number(r.change_percent_24h),
    fetchedAt: r.fetched_at as string,
  }))
}

export function useMetals(enabled: boolean): MetalsState & { refresh: () => Promise<void> } {
  const [rows, setRows] = useState<MetalRow[]>([])
  const [loading, setLoading] = useState(enabled)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!enabled) { setLoading(false); return }
    try {
      const r = await fetchRows()
      setRows(r)
      setError(null)
      // Cache miss on first ever load — kick off a one-time fetch
      // through the manual route. The route handles auth + the 60s
      // global throttle, so a flurry of buyers hitting an empty
      // cache only causes one upstream fetch.
      if (r.length === 0) {
        try {
          const { data: session } = await supabase.auth.getSession()
          const token = session.session?.access_token
          await fetch('/api/metals-prices/refresh', {
            method: 'POST',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          })
          const r2 = await fetchRows()
          setRows(r2)
        } catch { /* swallow — UI shows empty placeholders */ }
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load metals prices')
    } finally {
      setLoading(false)
    }
  }, [enabled])

  useEffect(() => { void load() }, [load])

  const refresh = useCallback(async () => {
    if (!enabled || refreshing) return
    setRefreshing(true)
    try {
      const { data: session } = await supabase.auth.getSession()
      const token = session.session?.access_token
      await fetch('/api/metals-prices/refresh', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      // Always re-read from DB; the route may have throttled.
      const r = await fetchRows()
      setRows(r)
    } catch (err: any) {
      setError(err?.message || 'Refresh failed')
    } finally {
      setRefreshing(false)
    }
  }, [enabled, refreshing])

  const newestFetchedAt = rows.length > 0
    ? new Date(rows.reduce((max, r) => r.fetchedAt > max ? r.fetchedAt : max, rows[0].fetchedAt))
    : null

  return {
    rows,
    newestFetchedAt,
    freshness: bucket(newestFetchedAt),
    loading,
    refreshing,
    error,
    refresh,
  }
}
