// POST /api/customers/phone-lookup — public, no auth.
//
// Used by the booking form (/book/[slug] + Store Portal + admin
// modal) to autofill the customer name when the booker enters a
// phone that matches an existing customer at the same store.
//
// Privacy note: a public name-by-phone endpoint is a small PII
// disclosure surface. We constrain it to:
//   - Resolved by store slug (caller can't enumerate "all stores")
//   - 10-digit normalized phone only — partial digits don't return
//     anything, so an attacker can't probe prefix-by-prefix.
//   - Returns just first/last name + flag — no email, address,
//     DOB, notes, or any other field.
//   - Per-IP rate limit (60 lookups / 5 min) to make brute-forcing
//     a contact list impractical.
//
// Body: { slug: string, phone: string }
// Returns:
//   200 { match: true, first_name, last_name, customer_id, is_repeat_customer: true }
//   200 { match: false }
//   429 { error: 'Too many lookups' }
//   400 { error: '...' }

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { normalizePhone } from '@/lib/customers/csv'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

// Tiny in-memory rate limiter. Per-IP sliding window. Survives only
// within a single Vercel function instance; that's fine — Fluid
// Compute reuses the same instance across concurrent requests, and
// for the threat model (someone hand-cranking phone prefixes) this
// is plenty. A determined adversary could rotate IPs, but they'd
// need a real customer DB to even know what to probe — there's no
// list-all endpoint.
const WINDOW_MS = 5 * 60 * 1000
const MAX_LOOKUPS_PER_WINDOW = 60
const ipHits = new Map<string, number[]>()

function rateLimit(ip: string): boolean {
  const now = Date.now()
  const cutoff = now - WINDOW_MS
  const hits = (ipHits.get(ip) || []).filter(t => t > cutoff)
  hits.push(now)
  ipHits.set(ip, hits)
  // Lazy cleanup so the map doesn't grow forever
  if (ipHits.size > 500) {
    for (const [k, v] of ipHits) {
      const trimmed = v.filter(t => t > cutoff)
      if (trimmed.length === 0) ipHits.delete(k)
      else ipHits.set(k, trimmed)
    }
  }
  return hits.length <= MAX_LOOKUPS_PER_WINDOW
}

export async function POST(req: Request) {
  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { slug, phone } = body ?? {}
  if (typeof slug !== 'string' || !slug.trim()) {
    return NextResponse.json({ error: 'Missing slug' }, { status: 400 })
  }
  if (typeof phone !== 'string') {
    return NextResponse.json({ error: 'Missing phone' }, { status: 400 })
  }

  const normalized = normalizePhone(phone)
  if (!normalized) {
    // Not 10 digits — don't even count against the rate limit, just
    // return no-match so the client UI doesn't flicker on every
    // intermediate keystroke.
    return NextResponse.json({ match: false })
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim()
    || req.headers.get('x-real-ip')
    || 'unknown'
  if (!rateLimit(ip)) {
    return NextResponse.json({ error: 'Too many lookups' }, { status: 429 })
  }

  const sb = admin()

  // Resolve store by slug. Pull only id to minimize disclosure.
  const { data: store } = await sb
    .from('stores')
    .select('id')
    .eq('slug', slug.trim())
    .maybeSingle()
  if (!store) return NextResponse.json({ match: false })

  // Look up customer by (store_id, phone_normalized). first hit wins.
  const { data: customer } = await sb
    .from('customers')
    .select('id, first_name, last_name')
    .eq('store_id', store.id)
    .eq('phone_normalized', normalized)
    .limit(1)
    .maybeSingle()

  if (!customer) {
    return NextResponse.json({ match: false })
  }

  return NextResponse.json({
    match: true,
    customer_id: customer.id,
    first_name: customer.first_name || '',
    last_name: customer.last_name || '',
    is_repeat_customer: true,
  })
}
