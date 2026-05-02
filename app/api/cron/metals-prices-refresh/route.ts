// GET /api/cron/metals-prices-refresh?secret=<CRON_SECRET>
//
// Vercel cron schedule: every 15 minutes (configured in vercel.json).
// Mirrors the existing cron pattern in this repo: query-string secret
// validated against env CRON_SECRET, no other auth.
//
// Fetches gold/silver/platinum spot prices and upserts the three
// rows in metals_prices_cache. On any individual metal's failure
// the OTHER metals still update — partial success is preferred
// over an all-or-nothing failure that would freeze the whole
// ticker.

import { NextResponse } from 'next/server'
import { refreshAllMetals } from '@/lib/metals/server'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const secret = url.searchParams.get('secret')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const result = await refreshAllMetals()
  return NextResponse.json({
    success: true,
    fetched: result.ok,
    failed: result.failed,
    details: result.details,
  })
}
