'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { tradeShowDaysByBuyer } from '@/lib/leaderboard'

/**
 * Per-user completed-trade-show day credit for the standings
 * leaderboard. Returns an empty map while loading or on error so
 * callers can safely `(map.get(id) ?? 0)`.
 *
 * Fetched directly off the consumer's mount rather than baked into
 * AppContext — the standings is the only consumer and both tables
 * are small (well under a thousand rows total across BEB history).
 *
 * Filter shape:
 *   - trade_shows: start_date within [year, year+1), not soft-deleted
 *   - trade_show_staff: every row (the helper drops rows whose show
 *     wasn't in the fetched slice)
 *
 * Completed-only filtering happens inside `tradeShowDaysByBuyer`.
 */
export function useTradeShowDays(year: number): Map<string, number> {
  const [map, setMap] = useState<Map<string, number>>(new Map())
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const yearStart = `${year}-01-01`
      const yearEnd = `${year + 1}-01-01`
      const [showsRes, staffRes] = await Promise.all([
        supabase.from('trade_shows')
          .select('id, start_date, end_date')
          .is('deleted_at', null)
          .gte('start_date', yearStart)
          .lt('start_date', yearEnd),
        supabase.from('trade_show_staff')
          .select('user_id, trade_show_id'),
      ])
      if (cancelled) return
      const shows = (showsRes.data ?? []) as { id: string; start_date: string; end_date: string }[]
      const staff = (staffRes.data ?? []) as { user_id: string; trade_show_id: string }[]
      const showIds = new Set(shows.map(s => s.id))
      const relevant = staff.filter(r => showIds.has(r.trade_show_id))
      setMap(tradeShowDaysByBuyer(relevant, shows, year))
    })()
    return () => { cancelled = true }
  }, [year])
  return map
}
