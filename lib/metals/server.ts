// Server-side fetcher + upsert logic for the metals price cache.
// Used by both the Vercel cron and the manual refresh route so
// they share one source of truth.

import { createClient } from '@supabase/supabase-js'

export type MetalKind = 'gold' | 'silver' | 'platinum'

export const METAL_SYMBOL: Record<MetalKind, string> = {
  gold: 'XAU',
  silver: 'XAG',
  platinum: 'XPT',
}

export const SOURCE = 'gold-api.com'

interface ParsedQuote {
  metal: MetalKind
  priceUsd: number
  // Some upstreams return a previous-close field; if so we use it.
  // Otherwise the upsert path falls back to its own daily anchor.
  previousCloseUsd: number | null
}

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

/**
 * Defensive numeric extraction. Some metal APIs return strings,
 * some wrap the price in nested objects, some use different
 * field names. We try a few likely shapes and return null if
 * nothing usable is found.
 */
function pickNumber(obj: any, keys: string[]): number | null {
  for (const k of keys) {
    const v = obj?.[k]
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v
    if (typeof v === 'string') {
      const n = parseFloat(v)
      if (Number.isFinite(n) && n > 0) return n
    }
  }
  return null
}

/** Fetch a single metal quote from gold-api.com. */
export async function fetchMetalQuote(metal: MetalKind): Promise<ParsedQuote | null> {
  const symbol = METAL_SYMBOL[metal]
  const url = `https://api.gold-api.com/price/${symbol}`
  let json: any
  try {
    const res = await fetch(url, {
      // Don't get long-tail Vercel hangs from a sluggish upstream.
      signal: AbortSignal.timeout(8000),
      headers: { 'Accept': 'application/json' },
    })
    if (!res.ok) {
      console.warn(`[metals] ${symbol} upstream HTTP ${res.status}`)
      return null
    }
    json = await res.json()
  } catch (err: any) {
    console.warn(`[metals] ${symbol} fetch failed:`, err?.message || err)
    return null
  }
  const priceUsd = pickNumber(json, ['price', 'Price', 'value', 'last', 'bid', 'ask'])
  if (priceUsd === null) {
    console.warn(`[metals] ${symbol} no usable price field; raw payload:`, JSON.stringify(json).slice(0, 400))
    return null
  }
  const previousCloseUsd = pickNumber(json, [
    'prev_close_price', 'previousClose', 'previous_close', 'open_price', 'open',
  ])
  return { metal, priceUsd, previousCloseUsd }
}

/**
 * Fetch all three metals and upsert into metals_prices_cache.
 * Returns counts so the cron / manual handler can report.
 *
 * previous_close_usd refresh rule: set on the first successful
 * write of each UTC day, then frozen until the next UTC day. The
 * percent-change shown on the dashboard is then "since today's
 * UTC open" — close enough to "since previous close" for a buyer
 * glancing at the ticker.
 */
export async function refreshAllMetals(): Promise<{
  ok: number
  failed: number
  details: Array<{ metal: MetalKind; status: 'ok' | 'failed'; price?: number; pct?: number | null }>
}> {
  const sb = adminClient()
  const metals: MetalKind[] = ['gold', 'silver', 'platinum']

  // Pull existing rows once so we can decide whether to roll the
  // previous-close anchor for each metal.
  const { data: existing } = await sb
    .from('metals_prices_cache')
    .select('metal, previous_close_usd, previous_close_set_at')
  const byMetal = new Map<string, { previous_close_usd: number | null; previous_close_set_at: string | null }>()
  for (const r of (existing || [])) {
    byMetal.set(r.metal as string, {
      previous_close_usd: r.previous_close_usd as any,
      previous_close_set_at: r.previous_close_set_at as any,
    })
  }
  const todayUtc = new Date().toISOString().slice(0, 10)

  const details: Array<{ metal: MetalKind; status: 'ok' | 'failed'; price?: number; pct?: number | null }> = []
  let ok = 0, failed = 0

  for (const metal of metals) {
    const quote = await fetchMetalQuote(metal)
    if (!quote) {
      failed++
      details.push({ metal, status: 'failed' })
      continue
    }

    const prior = byMetal.get(metal)
    const priorAnchorDay = prior?.previous_close_set_at
      ? new Date(prior.previous_close_set_at).toISOString().slice(0, 10)
      : null

    // Pick the previous-close baseline:
    //   1. If upstream gave us one, prefer it (most accurate).
    //   2. Else if no anchor yet OR anchor is from a prior day,
    //      adopt the current price as today's open.
    //   3. Else keep the existing anchor.
    let previousCloseUsd: number | null
    let previousCloseSetAt: string | null
    if (quote.previousCloseUsd !== null) {
      previousCloseUsd = quote.previousCloseUsd
      previousCloseSetAt = new Date().toISOString()
    } else if (!prior?.previous_close_usd || priorAnchorDay !== todayUtc) {
      previousCloseUsd = quote.priceUsd
      previousCloseSetAt = new Date().toISOString()
    } else {
      previousCloseUsd = prior.previous_close_usd
      previousCloseSetAt = prior.previous_close_set_at
    }

    const pct = previousCloseUsd && previousCloseUsd > 0
      ? ((quote.priceUsd - previousCloseUsd) / previousCloseUsd) * 100
      : null

    const { error: upErr } = await sb
      .from('metals_prices_cache')
      .upsert({
        metal,
        price_usd_per_oz: quote.priceUsd,
        change_percent_24h: pct,
        previous_close_usd: previousCloseUsd,
        previous_close_set_at: previousCloseSetAt,
        fetched_at: new Date().toISOString(),
        source: SOURCE,
      }, { onConflict: 'metal' })
    if (upErr) {
      failed++
      details.push({ metal, status: 'failed' })
      console.warn(`[metals] ${metal} upsert failed:`, upErr.message)
      continue
    }
    ok++
    details.push({ metal, status: 'ok', price: quote.priceUsd, pct })
  }

  return { ok, failed, details }
}

/**
 * Read freshness gate for the manual refresh endpoint. Returns
 * the most recent fetched_at timestamp across the three rows
 * (newest wins; null if cache is empty).
 */
export async function newestFetchedAt(): Promise<Date | null> {
  const sb = adminClient()
  const { data } = await sb
    .from('metals_prices_cache')
    .select('fetched_at')
    .order('fetched_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data?.fetched_at ? new Date(data.fetched_at) : null
}
