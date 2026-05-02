// POST /api/metals-prices/refresh
//
// Manual refresh trigger from the buyer dashboard's refresh icon.
// Anyone authenticated can call it; the actual fetch is throttled
// globally to once per 60 seconds (the cache's most-recent
// fetched_at is the throttle clock — there's no per-user table
// because abuse can only ever cause one extra fetch per 60s,
// which is negligible).
//
// Also doubles as the "cache miss" first-load fetcher: if the
// cache is empty, the dashboard hits this route to populate it.

import { NextResponse } from 'next/server'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { newestFetchedAt, refreshAllMetals } from '@/lib/metals/server'

export const dynamic = 'force-dynamic'

const MIN_REFRESH_GAP_MS = 60 * 1000

export async function POST(req: Request) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const newest = await newestFetchedAt()
  const ageMs = newest ? Date.now() - newest.getTime() : Infinity
  if (ageMs < MIN_REFRESH_GAP_MS) {
    return NextResponse.json({
      ok: true,
      throttled: true,
      lastFetchedAt: newest!.toISOString(),
      message: 'Cache is fresh; refresh skipped.',
    })
  }
  const result = await refreshAllMetals()
  return NextResponse.json({
    ok: true,
    throttled: false,
    fetched: result.ok,
    failed: result.failed,
    details: result.details,
  })
}
