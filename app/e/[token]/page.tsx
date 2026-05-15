// Public per-event dashboard for the store owner.
//
// Audience: the store's owner (or whoever the BEB partner texts the
// URL to). Distinct from /store-portal/[token] which is the booking
// surface for store EMPLOYEES — different audience, different
// permissions: employees shouldn't see live KPIs.
//
// Auth: token in the URL. No login. The token is unguessable and
// revocable (see `event_share_tokens.revoked_at`). Reads are done with
// the service-role client, matching the pattern used by /edge/[token]
// and /store-portal/[token].
//
// Refresh: server-rendered for the initial paint; a tiny client
// component (<AutoRefresh />) calls router.refresh() every 30s so
// KPIs and rosters stay current without a hard reload.
//
// URL pattern: /e/[token] (NOT /event/[token] — the latter is the
// staff-internal event view at app/event/[id]/page.tsx). The /e/
// prefix is also short for SMS forwarding.

import { Fragment } from 'react'
import type { Metadata } from 'next'
import { createClient } from '@supabase/supabase-js'
import { headers } from 'next/headers'
import { QRCodeSVG } from 'qrcode.react'
import { initials } from '@/lib/initials'
import AutoRefresh from './AutoRefresh'

export const dynamic = 'force-dynamic'

/** Per-token metadata for rich link previews (iMessage / Slack /
 *  Discord / etc.). The OG image points at /api/store/[id]/logo,
 *  which streams the store's base64 logo as binary bytes since
 *  link previewers won't render data: URLs. */
export async function generateMetadata({ params }: { params: { token: string } }): Promise<Metadata> {
  const fallback: Metadata = {
    title: 'Event Dashboard',
    description: 'Live event dashboard from Beneficial Estate Buyers.',
  }
  if (!params.token || params.token.length < 8 || params.token.length > 64) {
    return fallback
  }
  try {
    const sb = admin()
    const { data: tokenRow } = await sb
      .from('store_share_tokens')
      .select('store_id, revoked_at')
      .eq('token', params.token)
      .maybeSingle()
    if (!tokenRow || tokenRow.revoked_at) return fallback

    const { data: store } = await sb
      .from('stores')
      .select('id, name, city, state, store_image_url')
      .eq('id', tokenRow.store_id)
      .maybeSingle()
    if (!store) return fallback

    const h = headers()
    const host = h.get('host') || ''
    const proto = h.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https')
    const origin = host ? `${proto}://${host}` : ''

    const storeName = (store as any).name as string
    const where = [(store as any).city, (store as any).state].filter(Boolean).join(', ')

    // Resolve the same "current event" the dashboard would pick:
    // live → recently-ended (≤24h) → soonest upcoming. Stuff the
    // resulting date range into the title so the link preview reads
    // "Sami Fine Jewelers · May 11–13" instead of just "Event".
    const todayMeta = todayIso()
    const horizonIso = addDays(todayMeta, -3) // start_date >= today-3 ⇒ end >= today
    const { data: evRows } = await sb
      .from('events')
      .select('id, start_date, status')
      .eq('store_id', (store as any).id)
      .gte('start_date', horizonIso)
      .neq('status', 'cancelled')
      .order('start_date', { ascending: true })
    const evList = (evRows || []) as any[]
    const liveEv = evList.find(e => e.start_date && e.start_date <= todayMeta && addDays(e.start_date, 2) >= todayMeta)
    const recentEv = !liveEv ? evList.find(e => {
      if (!e.start_date) return false
      const end = addDays(e.start_date, 2)
      return end < todayMeta && daysBetween(end, todayMeta) <= 1
    }) : null
    const upcomingEv = !liveEv && !recentEv
      ? evList.find(e => e.start_date && e.start_date > todayMeta)
      : null
    const currentEv = liveEv || recentEv || upcomingEv || null
    const dateLabel = currentEv?.start_date
      ? formatDateRange(currentEv.start_date, addDays(currentEv.start_date, 2))
      : null
    const phaseTag = liveEv ? ' · LIVE' : (recentEv ? ' · just ended' : '')

    const title = dateLabel
      ? `${storeName} · ${dateLabel}${phaseTag}`
      : storeName
    const description = where
      ? `Live event dashboard for ${storeName} in ${where}.`
      : `Live event dashboard for ${storeName}.`
    const imageUrl = (store as any).store_image_url
      ? `${origin}/api/store/${(store as any).id}/logo`
      : undefined

    return {
      title,
      description,
      openGraph: {
        title,
        description,
        url: origin ? `${origin}/e/${params.token}` : undefined,
        siteName: 'Beneficial Estate Buyers',
        type: 'website',
        ...(imageUrl ? {
          images: [{
            url: imageUrl,
            width: 512,
            height: 512,
            alt: `${storeName} logo`,
          }],
        } : {}),
      },
      twitter: {
        card: 'summary',
        title,
        description,
        ...(imageUrl ? { images: [imageUrl] } : {}),
      },
    }
  } catch {
    return fallback
  }
}
export const revalidate = 0

/** Fetch + parse the store's iCal feed (Google Calendar / SimplyBook),
 *  filter to events that fall within the picked event's 3-day window,
 *  and map them to the dashboard's appointment shape. Mirrors the
 *  staff AppointmentsAdmin pattern. Best-effort: any fetch / parse
 *  error returns an empty list rather than failing the whole page. */
async function fetchGcalAppointmentsForEvent(
  feedUrl: string | null | undefined,
  offsetHours: number | null | undefined,
  eventStartIso: string | null | undefined,
): Promise<any[]> {
  if (!feedUrl || !eventStartIso) return []
  try {
    const hdrs = headers()
    const host = hdrs.get('host') || ''
    const proto = hdrs.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https')
    const origin = host ? `${proto}://${host}` : ''
    if (!origin) return []

    const res = await fetch(
      `${origin}/api/fetch-ical?url=${encodeURIComponent(feedUrl)}`,
      { next: { revalidate: 60 } },  // 1-minute server cache
    )
    if (!res.ok) return []
    const text = await res.text()

    const { parseIcal, parseApptDetail } = await import('@/lib/calendar')
    const offsetMs = (offsetHours || 0) * 60 * 60 * 1000

    // Inclusive window: Day 1 → Day 3 of the event (start_date + 0..2).
    const startDay = eventStartIso
    const endDay = addDays(eventStartIso, 2)

    const out: any[] = []
    for (const a of parseIcal(text)) {
      const adj = offsetMs === 0
        ? a
        : { ...a, start: new Date(a.start.getTime() + offsetMs), end: new Date(a.end.getTime() + offsetMs) }
      const date = `${adj.start.getUTCFullYear()}-${String(adj.start.getUTCMonth() + 1).padStart(2, '0')}-${String(adj.start.getUTCDate()).padStart(2, '0')}`
      // Filter: must fall on Day 1–3 of this event.
      if (date < startDay || date > endDay) continue

      const time = `${String(adj.start.getUTCHours()).padStart(2, '0')}:${String(adj.start.getUTCMinutes()).padStart(2, '0')}`
      const detail = parseApptDetail(adj)
      const customerName = detail.name || adj.title || ''
      out.push({
        id: `gcal-${date}-${time}-${customerName}`,
        appointment_date: date,
        appointment_time: time,
        customer_name: customerName,
        items_bringing: detail.items ? [detail.items] : [],
        // Use a status the renderer treats as "upcoming" by default.
        // GCal events don't carry per-row status — staff would need to
        // mark served/no-show on the canonical side.
        status: 'confirmed',
        is_walkin: false,
        _source: 'gcal',
      })
    }
    return out
  } catch {
    return []
  }
}

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

// ── Page ────────────────────────────────────────────────────────
export default async function Page({
  params,
  searchParams,
}: {
  params: { token: string }
  searchParams?: { ev?: string }
}) {
  const token = params.token
  if (!token || token.length < 8 || token.length > 64) {
    return <NotFound />
  }

  const sb = admin()
  const today = todayIso()
  const nowIso = new Date().toISOString()

  // 1. Look up the token (must be unrevoked) in store_share_tokens.
  //    The page now resolves to a STORE — picker chooses the event.
  const { data: tokenRow } = await sb
    .from('store_share_tokens')
    .select('id, store_id, revoked_at, revoked_reason, view_count, first_viewed_at')
    .eq('token', token)
    .maybeSingle()
  if (!tokenRow) return <NotFound />
  if (tokenRow.revoked_at) return <Revoked reason={tokenRow.revoked_reason} />

  // 2. Fire-and-forget view tracking (best-effort; never block render).
  sb.from('store_share_tokens').update({
    first_viewed_at: tokenRow.first_viewed_at || nowIso,
    last_viewed_at: nowIso,
    view_count: (tokenRow.view_count || 0) + 1,
  }).eq('id', tokenRow.id).then(() => {}, () => {})

  // 3. Store.
  const { data: store } = await sb
    .from('stores')
    .select('id, name, slug, city, state, store_image_url, color_primary, calendar_feed_url, calendar_offset_hours')
    .eq('id', tokenRow.store_id)
    .maybeSingle()
  if (!store) return <NotFound />

  // 4. Fetch this store's events that are LIVE / RECENTLY-ENDED
  //    (within 24h post-end) / UPCOMING. Past events older than that
  //    window are hidden per user spec ("hide past").
  //
  //    Event window = start_date through start_date + 2 days (3-day
  //    event). "Recently ended" window = up to 24h after the last
  //    day, i.e. start_date + 3 days >= today.
  const yesterdayIso = addDays(today, -3) // start_date >= yesterday-3 == start_date+3 >= today

  const { data: evs } = await sb
    .from('events')
    .select('id, store_id, store_name, start_date, status, workers, brand')
    .eq('store_id', store.id)
    .gte('start_date', yesterdayIso)
    .order('start_date', { ascending: true })
  const allEvents = (evs || []) as any[]

  // Filter out cancelled events. Reserved events kept — they're
  // upcoming-soon and worth surfacing.
  const eligibleEvents = allEvents.filter(e => e.status !== 'cancelled')

  if (eligibleEvents.length === 0) {
    return (
      <NoActiveEvents
        storeName={store.name}
        storeLogo={store.store_image_url}
      />
    )
  }

  // 5. Default-event picker, rule (b):
  //    (1) currently LIVE  → that event
  //    (2) just ended ≤24h → that event (post-event recap)
  //    (3) soonest upcoming → that event
  const live = eligibleEvents.find(e => {
    if (!e.start_date) return false
    return e.start_date <= today && addDays(e.start_date, 2) >= today
  })
  const recentlyEnded = !live ? eligibleEvents.find(e => {
    if (!e.start_date) return false
    const endIso = addDays(e.start_date, 2)
    // "Within 24h after end" = today is exactly endIso + 1 day or earlier
    return endIso < today && daysBetween(endIso, today) <= 1
  }) : null
  const soonestUpcoming = !live && !recentlyEnded
    ? eligibleEvents.find(e => e.start_date && e.start_date > today)
    : null
  const defaultEvent = live || recentlyEnded || soonestUpcoming || eligibleEvents[0]

  // 6. Honor ?ev=<id> override if present and valid.
  const requestedEventId = (searchParams?.ev || '').trim()
  const ev = (requestedEventId && eligibleEvents.find(e => e.id === requestedEventId))
    || defaultEvent

  // 7. Compute phase + day label (mirrors the staff HubView logic).
  const start = ev.start_date as string
  const endIso = addDays(start, 2)
  const reserved = ev.status === 'reserved'
  const cancelled = ev.status === 'cancelled'
  const isLive = !reserved && !cancelled && start <= today && endIso >= today
  const past = !reserved && !cancelled && endIso < today
  const dayIndexZeroBased = isLive ? clamp(daysBetween(start, today), 0, 2) : 0
  const dayNumber = dayIndexZeroBased + 1  // 1..3
  const phase: 'live' | 'soon' | 'past' | 'reserved' | 'cancelled' | 'upcoming' =
    cancelled ? 'cancelled'
    : reserved ? 'reserved'
    : past ? 'past'
    : isLive ? 'live'
    : 'upcoming'

  // (phase / day label / etc. computed above when ev was picked)

  // 5. Data fetch.
  //    - appts: ALL non-cancelled appointments for the event (every day)
  //    - waitlist: live waiting queue only
  //    - buys: ALL buyer_checks for the event (every day) — drives both
  //      the Check Register section and the per-day spend totals
  //    - days: event_days rows (one per day_number, denormalized
  //      day-level totals + source breakdown from staff Day Entry)
  const [apptsRes, waitlistRes, buysRes, daysRes] = await Promise.all([
    sb.from('appointments')
      .select('id, appointment_date, appointment_time, customer_name, items_bringing, status, is_walkin, is_repeat_customer')
      .eq('event_id', ev.id)
      .neq('status', 'cancelled')
      .order('appointment_date', { ascending: true })
      .order('appointment_time', { ascending: true }),
    sb.from('event_waitlist')
      .select('id, name, party_size:item_count, notify_pref, created_at, expires_at, status')
      .eq('event_id', ev.id)
      .eq('status', 'waiting')
      .gt('expires_at', nowIso)
      .order('created_at', { ascending: true }),
    sb.from('buyer_checks')
      .select('id, check_number, buy_form_number, amount, commission_rate, commission_note, customer_name, buyer_id, day_number, created_at, payment_type')
      .eq('event_id', ev.id)
      .order('day_number', { ascending: true })
      .order('created_at', { ascending: true }),
    sb.from('event_days')
      .select('*')
      .eq('event_id', ev.id)
      .order('day_number', { ascending: true }),
  ])
  const portalAppts = apptsRes.data ?? []
  const waitlist = waitlistRes.data ?? []
  const buys = buysRes.data ?? []
  const days: any[] = daysRes.data ?? []

  // 5b. Pull Google Calendar / SimplyBook appointments via the
  //     store's iCal feed and merge into the appointments list. This
  //     mirrors the staff AppointmentsAdmin behavior so the dashboard
  //     shows the same merged set the BEB team sees internally.
  //
  //     Window: only events that fall on Day 1–3 of the picked event.
  //     The iCal feed often contains months of bookings — we filter
  //     down to this event's dates so the section isn't flooded.
  const gcalAppts = await fetchGcalAppointmentsForEvent(
    (store as any).calendar_feed_url,
    (store as any).calendar_offset_hours,
    ev.start_date,
  )

  // Concatenate. Sort happens later when grouping by date. If a
  // portal-table booking and a gcal event share a customer + time
  // we don't try to dedupe (the staff view doesn't either) — better
  // to over-show than to hide a real booking.
  const appts = [...portalAppts, ...gcalAppts]

  // 6. KPIs — cumulative across all days. We pull customer counts +
  //    source attribution from event_days (the Day Entry totals row),
  //    but for **dollar amounts** we prefer the buyer_checks sum per
  //    day when any checks exist for that day. Why: event_days.dollars*
  //    is a denormalized snapshot — if a user fixes a check amount in
  //    the register (e.g. $799.99 → $800) but the parent totals row
  //    didn't get re-saved, the staleness sticks in event_days.dollars*
  //    forever. The buyer_checks rows always carry the canonical
  //    amount, so deriving from them self-heals.
  const buysByDay = new Map<number, { d10: number; d5: number; d0: number; n: number }>()
  for (const b of buys) {
    const dn = Number(b.day_number) || 0
    if (!dn) continue
    // Voided checks stay in the register list (for audit) but don't
    // contribute to Spend / Bought totals on the dashboard.
    if ((b as any).payment_type === 'voided') continue
    const amt = Number(b.amount) || 0
    const rate = Number(b.commission_rate ?? 10)
    const slot = buysByDay.get(dn) || { d10: 0, d5: 0, d0: 0, n: 0 }
    if (rate === 5) slot.d5 += amt
    else if (rate === 0) slot.d0 += amt
    else slot.d10 += amt
    slot.n += 1
    buysByDay.set(dn, slot)
  }

  const dayTotals = days.reduce((acc: any, d: any) => {
    const checks = buysByDay.get(Number(d.day_number) || 0)
    const useChecks = checks && checks.n > 0
    return {
      customers: acc.customers + (Number(d.customers) || 0),
      purchases: acc.purchases + (Number(d.purchases) || 0),
      // Prefer check-sum when present; fall back to event_days totals
      // for days with no checks (quick-mode entry).
      dollars10: acc.dollars10 + (useChecks ? checks!.d10 : (Number(d.dollars10) || 0)),
      dollars5:  acc.dollars5  + (useChecks ? checks!.d5  : (Number(d.dollars5)  || 0)),
      dollars0:  acc.dollars0  + (useChecks ? checks!.d0  : (Number(d.dollars0)  || 0)),
      src_vdp:        acc.src_vdp        + (Number(d.src_vdp)        || 0),
      src_postcard:   acc.src_postcard   + (Number(d.src_postcard)   || 0),
      src_social:     acc.src_social     + (Number(d.src_social)     || 0),
      src_wom:        acc.src_wom        + (Number(d.src_wordofmouth) || 0),
      src_repeat:     acc.src_repeat     + (Number(d.src_repeat)     || 0),
      src_store:      acc.src_store      + (Number(d.src_store)      || 0),
      src_text:       acc.src_text       + (Number(d.src_text)       || 0),
      src_newspaper:  acc.src_newspaper  + (Number(d.src_newspaper)  || 0),
      src_other:      acc.src_other      + (Number(d.src_other)      || 0),
    }
  }, {
    customers:0, purchases:0, dollars10:0, dollars5:0, dollars0:0,
    src_vdp:0, src_postcard:0, src_social:0, src_wom:0, src_repeat:0,
    src_store:0, src_text:0, src_newspaper:0, src_other:0,
  })
  const totalSpentCents = Math.round((dayTotals.dollars10 + dayTotals.dollars5) * 100)
  const closeRate = dayTotals.customers > 0
    ? Math.round((dayTotals.purchases / dayTotals.customers) * 100)
    : 0
  const sources = [
    { label: 'VDP / Large Postcard', value: dayTotals.src_vdp,       color: '#059669' },
    { label: 'Store Postcard',       value: dayTotals.src_postcard,  color: '#3B82F6' },
    { label: 'Social Media',         value: dayTotals.src_social,    color: '#8B5CF6' },
    { label: 'Word of Mouth',        value: dayTotals.src_wom,       color: '#F59E0B' },
    { label: 'Repeat Customer',      value: dayTotals.src_repeat,    color: '#F43F5E' },
    { label: 'Store',                value: dayTotals.src_store,     color: '#0EA5E9' },
    { label: 'Text Message',         value: dayTotals.src_text,      color: '#10B981' },
    { label: 'Newspaper',            value: dayTotals.src_newspaper, color: '#6366F1' },
    { label: 'Other',                value: dayTotals.src_other,     color: '#6B7280' },
  ].filter(s => s.value > 0)
  const srcTotal = sources.reduce((a, b) => a + b.value, 0)

  // 7. Buyer roster — events.workers JSONB has {id, name, deleted?}.
  //    Join to users for photo_url if we have buyer ids.
  const workers = ((ev.workers as any[]) || []).filter(w => !w.deleted)
  const workerIds = workers.map(w => w.id).filter(Boolean)
  let userPhotos: Record<string, string | null> = {}
  if (workerIds.length) {
    const { data: usersRows } = await sb
      .from('users')
      .select('id, photo_url')
      .in('id', workerIds)
    for (const u of (usersRows || []) as any[]) {
      userPhotos[u.id] = u.photo_url || null
    }
  }

  // 8. Booking-page URL: link out to the most recent active store-
  //    portal token (so the store owner can hand it to their staff
  //    if they don't have it). Best-effort; skip the button if none.
  let bookingUrl: string | null = null
  if (store?.id) {
    const { data: portalRow } = await sb
      .from('store_portal_tokens')
      .select('token')
      .eq('store_id', store.id)
      .eq('active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (portalRow?.token) bookingUrl = `/store-portal/${portalRow.token}`
  }

  // Absolute version of the booking URL for the QR code — relative
  // paths don't scan into anything useful on a phone. Pulled from
  // request headers so preview deploys, custom domains, and localhost
  // all get the correct origin.
  const h = headers()
  const headerHost = h.get('host') || ''
  const headerProto = h.get('x-forwarded-proto') || (headerHost.startsWith('localhost') ? 'http' : 'https')
  const headerOrigin = headerHost ? `${headerProto}://${headerHost}` : ''
  const bookingUrlAbsolute = bookingUrl ? `${headerOrigin}${bookingUrl}` : null

  const phaseLabel = phaseLabelFor(phase, dayNumber, start, today, endIso)

  // 9. Pre-shape for rendering.
  const storeName = store?.name || ev.store_name || 'Event'
  const storeLocation = [store?.city, store?.state].filter(Boolean).join(', ')
  const dateRange = formatDateRange(start, endIso)

  return (
    <div style={{
      minHeight: '100vh',
      background: '#FAF8F4',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
      color: '#1f2937',
    }}>
      <AutoRefresh />
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px' }}>

        {/* Event picker — visible whenever the store has >1 eligible
            event. Each option is a regular <a> so it survives the
            30-second auto-refresh + lands the user on the same event
            on browser back/forward. Past events (>24h after end) are
            already filtered out upstream per the "hide past" spec. */}
        {eligibleEvents.length > 1 && (
          <div style={{
            background: '#fff', borderRadius: 10, padding: '10px 14px',
            marginBottom: 12, boxShadow: '0 1px 3px rgba(0,0,0,.04)',
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: '#6b7280', letterSpacing: '.05em', textTransform: 'uppercase' }}>
              Event:
            </span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {eligibleEvents.map((e: any) => {
                const isSelected = e.id === ev.id
                const pillStr = eventPickerLabel(e, today)
                return (
                  <a key={e.id}
                    href={`/e/${token}?ev=${e.id}`}
                    style={{
                      padding: '5px 10px', borderRadius: 6,
                      fontSize: 12, fontWeight: 700, textDecoration: 'none',
                      background: isSelected ? '#1e3a8a' : '#F3F4F6',
                      color: isSelected ? '#fff' : '#374151',
                      border: isSelected ? '1px solid #1e3a8a' : '1px solid #E5E7EB',
                    }}>
                    {pillStr}
                  </a>
                )
              })}
            </div>
          </div>
        )}

        {/* Header card */}
        <div style={{
          borderRadius: 14,
          padding: '24px 26px',
          background: 'linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%)',
          color: '#fff',
          marginBottom: 16,
          boxShadow: '0 4px 12px rgba(30,58,138,.18)',
          display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap',
        }}>
          {/* Logo: store_image_url is a base64 data URL when present;
              fall back to a monogram disc with the store initials. */}
          {store?.store_image_url
            ? <img src={store.store_image_url} alt={storeName}
                style={{ width: 72, height: 72, borderRadius: '50%', objectFit: 'cover',
                  background: '#fff', boxShadow: '0 2px 6px rgba(0,0,0,.15)', flexShrink: 0 }} />
            : <div style={{
                flexShrink: 0,
                width: 72, height: 72, borderRadius: '50%',
                background: '#fff', color: '#1e3a8a',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 900, fontSize: 26, letterSpacing: '.04em',
                boxShadow: '0 2px 6px rgba(0,0,0,.15)',
              }}>{initials(storeName)}</div>
          }

          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <h1 style={{ fontSize: 28, fontWeight: 900, margin: 0, letterSpacing: '-0.02em' }}>
                {storeName}
              </h1>
              <span style={{
                background: 'rgba(255,255,255,.22)',
                padding: '4px 12px', borderRadius: 999,
                fontSize: 12, fontWeight: 800, letterSpacing: '.05em',
              }}>{phaseLabel}</span>
            </div>
            <div style={{ marginTop: 6, fontSize: 14, opacity: 0.92 }}>
              {storeLocation && <>{storeLocation} · </>}📅 {dateRange}
            </div>
          </div>

          {/* Store portal QR — top-right of the hero. Encodes the
              ABSOLUTE booking URL so customers/staff can scan it
              with their phones from across the counter. Only renders
              when an active store_portal_token exists for the store. */}
          {bookingUrlAbsolute && (
            <a href={bookingUrl!} target="_blank" rel="noopener noreferrer"
              style={{
                flexShrink: 0,
                background: '#fff',
                padding: 8,
                borderRadius: 10,
                boxShadow: '0 2px 6px rgba(0,0,0,.15)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                textDecoration: 'none',
              }}
              title="Open booking page in a new tab"
            >
              <QRCodeSVG value={bookingUrlAbsolute} size={96} level="M" />
              <div style={{ fontSize: 10, fontWeight: 800, color: '#1e3a8a', letterSpacing: '.04em', textTransform: 'uppercase' }}>
                Scan to book
              </div>
            </a>
          )}
        </div>

        {/* KPI row */}
        <div style={{
          background: '#fff', borderRadius: 14, padding: 0,
          marginBottom: 16,
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          overflow: 'hidden',
          boxShadow: '0 1px 3px rgba(0,0,0,.05)',
        }}>
          <Kpi label="Customers" value={`${dayTotals.customers.toLocaleString()}`}
            hint={`Cumulative · ${days.filter(d => Number(d.customers) > 0).length || 0} day${days.filter(d => Number(d.customers) > 0).length === 1 ? '' : 's'} of data`} />
          <Kpi label="Purchases" value={`${dayTotals.purchases.toLocaleString()}`}
            hint={dayTotals.customers > 0 ? `${closeRate}% close rate` : 'No buys logged yet'} />
          <Kpi label="Spend"     value={fmt(totalSpentCents)}
            hint="Cumulative across all days" emphasize />
        </div>

        {/* Launcher row */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12,
          marginBottom: 18,
        }}>
          <LauncherTile href="#appointments" icon="📅" label="Appointments"   sub={apptLauncherSub(appts, today)} />
          <LauncherTile href="#daily"        icon="📊" label="Daily Results"  sub={dailyLauncherSub(days)} />
          <LauncherTile href="#sources"      icon="📣" label="How heard"      sub={srcTotal > 0 ? `${srcTotal} attributed` : 'No data yet'} />
          <LauncherTile href="#buyers"       icon="👥" label="Buyers"         sub={`${workers.length} on-site`} />
          <LauncherTile href="#checks"       icon="💰" label="Check Register" sub={`${buys.length} buys · ${fmt(totalBuyerCheckCents(buys))}`} />
          <LauncherTile href="#waitlist"     icon="🕒" label="Waitlist"       sub={`${waitlist.length} waiting`} />
        </div>

        {/* Booking CTA */}
        {bookingUrl && (
          <div style={{
            marginBottom: 18, padding: 16,
            background: '#fff', borderRadius: 12,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 12, flexWrap: 'wrap',
            boxShadow: '0 1px 3px rgba(0,0,0,.04)',
            border: '1px dashed #d1d5db',
          }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Need to book an appointment for a customer?</div>
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                Your booking page is a separate URL — store staff use it to add appointments without seeing live results.
              </div>
            </div>
            <a href={bookingUrl} target="_blank" rel="noopener noreferrer"
              style={{
                background: '#1D6B44', color: '#fff',
                padding: '10px 18px', borderRadius: 8,
                fontSize: 13, fontWeight: 700, textDecoration: 'none',
                whiteSpace: 'nowrap',
              }}>
              Open booking page →
            </a>
          </div>
        )}

        {/* Appointments — grouped by date so all 3 days of the
            event are visible at once. */}
        <Section id="appointments" title="📅 Appointments">
          {appts.length === 0 ? (
            <Empty>No appointments scheduled yet.</Empty>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {groupApptsByDate(appts).map(group => (
                <Card key={group.date}>
                  <div style={{
                    padding: '8px 14px', background: '#F9FAFB',
                    fontSize: 11, fontWeight: 800, color: '#374151',
                    textTransform: 'uppercase', letterSpacing: '.05em',
                    borderBottom: '1px solid #F3F4F6',
                    display: 'flex', alignItems: 'center', gap: 8,
                  }}>
                    <span>{dateGroupLabel(group.date, today)}</span>
                    <span style={{ color: '#9CA3AF', fontWeight: 600 }}>·</span>
                    <span style={{ color: '#9CA3AF', fontWeight: 600 }}>
                      {group.rows.length} appointment{group.rows.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <table style={tableStyle}>
                    <tbody>
                      {group.rows.map((a, i) => (
                        <tr key={a.id} style={{ borderTop: i === 0 ? 'none' : '1px solid #F3F4F6' }}>
                          <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', fontWeight: 700, color: '#374151', width: 100 }}>
                            {formatTime(a.appointment_time)}
                          </td>
                          <td style={{ padding: '10px 6px', fontWeight: 600 }}>
                            {a.customer_name}
                            {a.is_repeat_customer && (
                              <span title="Repeat customer — phone matched an existing customer record"
                                style={{
                                  marginLeft: 6, padding: '1px 6px', borderRadius: 999,
                                  fontSize: 10, fontWeight: 800,
                                  background: '#FEF3C7', color: '#78350F',
                                }}>🔁 Repeat</span>
                            )}
                            {a.is_walkin && <span style={{ marginLeft: 6, fontSize: 10, color: '#1e40af', fontWeight: 700 }}>WALK-IN</span>}
                          </td>
                          <td style={{ padding: '10px 6px', color: '#6b7280', fontSize: 12 }}>
                            {(a.items_bringing || []).join(', ')}
                          </td>
                          <td style={{ padding: '10px 14px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <ApptStatusPill status={a.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              ))}
            </div>
          )}
        </Section>

        {/* Daily Results — Day Entry totals per day_number with a
            cumulative footer. Matches the staff event summary so the
            numbers line up exactly. */}
        <Section id="daily" title="📊 Daily Results">
          {days.length === 0 ? (
            <Empty>No daily totals submitted yet.</Empty>
          ) : (
            <Card>
              <table style={tableStyle}>
                <thead style={{ background: '#F9FAFB' }}>
                  <tr>
                    <Th>Day</Th>
                    <Th style={{ width: 90, textAlign: 'right' }}>Customers</Th>
                    <Th style={{ width: 90, textAlign: 'right' }}>Purchases</Th>
                    <Th style={{ width: 80, textAlign: 'right' }}>Close %</Th>
                    <Th style={{ width: 110, textAlign: 'right' }}>Amount</Th>
                  </tr>
                </thead>
                <tbody>
                  {days.map(d => {
                    const dayCustomers = Number(d.customers) || 0
                    const dayPurchases = Number(d.purchases) || 0
                    // Prefer check-sum when present (self-healing if
                    // event_days has stale dollars10/5 from before a
                    // check edit).
                    const dayCheckSlot = buysByDay.get(Number(d.day_number) || 0)
                    const dayDollars = (dayCheckSlot && dayCheckSlot.n > 0)
                      ? Math.round((dayCheckSlot.d10 + dayCheckSlot.d5) * 100)
                      : Math.round(((Number(d.dollars10) || 0) + (Number(d.dollars5) || 0)) * 100)
                    const dayClose = dayCustomers > 0 ? Math.round((dayPurchases / dayCustomers) * 100) : null
                    return (
                      <tr key={d.day_number} style={{ borderTop: '1px solid #F3F4F6' }}>
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', fontWeight: 700, color: '#374151' }}>
                          Day {d.day_number}
                          <div style={{ fontSize: 11, color: '#9CA3AF', fontWeight: 500, marginTop: 2 }}>
                            {dayDateLabel(start, d.day_number, today)}
                          </div>
                        </td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600 }}>
                          {dayCustomers.toLocaleString()}
                        </td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600 }}>
                          {dayPurchases.toLocaleString()}
                        </td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', whiteSpace: 'nowrap', color: '#6b7280' }}>
                          {dayClose != null ? `${dayClose}%` : '—'}
                        </td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 800 }}>
                          {fmt(dayDollars)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot style={{ background: '#F9FAFB' }}>
                  <tr style={{ borderTop: '2px solid var(--green-dark, #1D6B44)' }}>
                    <td style={{ padding: '10px 14px', fontWeight: 900, fontSize: 13, color: '#0f172a' }}>
                      Cumulative
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 900 }}>
                      {dayTotals.customers.toLocaleString()}
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 900 }}>
                      {dayTotals.purchases.toLocaleString()}
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 900, color: '#6b7280' }}>
                      {closeRate}%
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 900, color: '#1D6B44', fontSize: 15 }}>
                      {fmt(totalSpentCents)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </Card>
          )}
        </Section>

        {/* How did you hear — customer source attribution from Day
            Entry. Renders a sorted bar list so the biggest source
            jumps out visually. */}
        <Section id="sources" title="📣 How did you hear">
          {sources.length === 0 ? (
            <Empty>No source data logged yet.</Empty>
          ) : (
            <Card>
              <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {sources
                  .slice()
                  .sort((a, b) => b.value - a.value)
                  .map(s => {
                    const pctOfTotal = srcTotal > 0 ? (s.value / srcTotal) * 100 : 0
                    return (
                      <div key={s.label}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 3 }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: '#374151' }}>{s.label}</span>
                          <span style={{ fontSize: 12, color: '#6b7280' }}>
                            <strong style={{ color: '#0f172a' }}>{s.value}</strong> · {pctOfTotal.toFixed(0)}%
                          </span>
                        </div>
                        <div style={{ height: 8, background: '#F3F4F6', borderRadius: 4, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${pctOfTotal}%`, background: s.color, borderRadius: 4 }} />
                        </div>
                      </div>
                    )
                  })}
              </div>
            </Card>
          )}
        </Section>

        {/* Buyers */}
        <Section id="buyers" title="👥 Buyers on-site">
          {workers.length === 0 ? (
            <Empty>No buyers assigned yet.</Empty>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
              {workers.map((w: any) => {
                const photo = userPhotos[w.id]
                return (
                  <div key={w.id} style={{
                    background: '#fff', borderRadius: 10, padding: 12,
                    display: 'flex', alignItems: 'center', gap: 12,
                    boxShadow: '0 1px 3px rgba(0,0,0,.04)',
                  }}>
                    {photo
                      ? <img src={photo} alt={w.name} style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover' }} />
                      : <div style={{
                          width: 44, height: 44, borderRadius: '50%',
                          background: pickAvatarColor(w.id || w.name),
                          color: '#fff',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontWeight: 800, fontSize: 15, letterSpacing: '.04em',
                        }}>{initials(w.name || '?')}</div>
                    }
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>{w.name || '—'}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Section>

        {/* Check Register — every buy across every day, grouped by
            day_number. Each day group has its own footer subtotal,
            plus a grand-total footer for the whole event. */}
        <Section id="checks" title="💰 Check Register">
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8, marginTop: -4 }}>
            {buys.length} check{buys.length === 1 ? '' : 's'} across all days · {fmt(totalBuyerCheckCents(buys))} total
          </div>
          {buys.length === 0 ? (
            <Empty>No buys logged yet.</Empty>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {groupBuysByDay(buys).map(grp => (
                <Card key={grp.dayNumber}>
                  <div style={{
                    padding: '8px 14px', background: '#F9FAFB',
                    fontSize: 11, fontWeight: 800, color: '#374151',
                    textTransform: 'uppercase', letterSpacing: '.05em',
                    borderBottom: '1px solid #F3F4F6',
                    display: 'flex', alignItems: 'center', gap: 8,
                  }}>
                    <span>Day {grp.dayNumber} · {dayDateLabel(start, grp.dayNumber, today)}</span>
                    <span style={{ color: '#9CA3AF', fontWeight: 600 }}>·</span>
                    <span style={{ color: '#9CA3AF', fontWeight: 600 }}>
                      {grp.rows.length} check{grp.rows.length === 1 ? '' : 's'}
                    </span>
                    <span style={{ flex: 1 }} />
                    <span style={{ color: '#1D6B44', fontWeight: 800 }}>
                      {fmt(totalBuyerCheckCents(grp.rows))}
                    </span>
                  </div>
                  <table style={tableStyle}>
                    <thead style={{ background: '#FFF' }}>
                      <tr>
                        <Th style={{ width: 90 }}>Time</Th>
                        <Th>Form #</Th>
                        <Th>Check #</Th>
                        <Th style={{ width: 90, textAlign: 'center' }}>Comm</Th>
                        <Th style={{ width: 130, textAlign: 'right' }}>Amount</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {grp.rows.map(b => {
                        const isVoided = (b as any).payment_type === 'voided'
                        return (
                        <Fragment key={b.id}>
                          <tr style={{ borderTop: '1px solid #F3F4F6', background: isVoided ? '#FEF2F2' : undefined }}>
                            <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', fontWeight: 700, color: '#374151' }}>
                              {formatShortTime(b.created_at)}
                            </td>
                            <td style={{ ...mono, fontWeight: 700, color: '#0f172a' }}>
                              {b.buy_form_number ? `#${b.buy_form_number}` : '—'}
                            </td>
                            <td style={mono}>
                              {b.check_number ? `#${b.check_number}` : '—'}
                              {isVoided && (
                                <span style={{
                                  marginLeft: 6, padding: '1px 6px', borderRadius: 4,
                                  background: '#FECACA', color: '#7F1D1D',
                                  fontSize: 10, fontWeight: 800, letterSpacing: '.05em',
                                }}>VOIDED</span>
                              )}
                            </td>
                            <td style={{ padding: '10px 6px', textAlign: 'center' }}>
                              <CommPill rate={Number(b.commission_rate ?? 10)} />
                            </td>
                            <td style={{
                              padding: '10px 14px', textAlign: 'right', whiteSpace: 'nowrap',
                              fontWeight: 800, color: isVoided ? '#9CA3AF' : '#0f172a',
                              textDecoration: isVoided ? 'line-through' : undefined,
                            }}>
                              {fmt(Math.round(Number(b.amount || 0) * 100))}
                            </td>
                          </tr>
                          {b.commission_note && (
                            <tr style={{ borderTop: 'none' }}>
                              <td colSpan={5} style={{
                                padding: '0 14px 8px 14px',
                                fontSize: 11, color: '#92400e', fontStyle: 'italic',
                              }}>
                                📝 {b.commission_note}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </Card>
              ))}
              {/* Grand-total footer */}
              <div style={{
                background: '#FFF', borderRadius: 10,
                padding: '10px 14px', boxShadow: '0 1px 3px rgba(0,0,0,.04)',
                display: 'flex', alignItems: 'center', gap: 12,
              }}>
                <span style={{ fontWeight: 800, fontSize: 13, color: '#0f172a' }}>
                  Event total
                </span>
                <span style={{ color: '#9CA3AF', fontSize: 12, fontWeight: 600 }}>
                  {buys.length} check{buys.length === 1 ? '' : 's'} across all days
                </span>
                <span style={{ flex: 1 }} />
                <span style={{ color: '#1D6B44', fontWeight: 900, fontSize: 16 }}>
                  {fmt(totalBuyerCheckCents(buys))}
                </span>
              </div>
            </div>
          )}
        </Section>

        {/* Waitlist */}
        <Section id="waitlist" title="🕒 Waitlist">
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8, marginTop: -4 }}>
            {waitlist.length} currently waiting · refreshes automatically
          </div>
          {waitlist.length === 0 ? (
            <Empty>Nobody on the waitlist right now.</Empty>
          ) : (
            <Card>
              <table style={tableStyle}>
                <tbody>
                  {waitlist.map((w, i) => (
                    <tr key={w.id} style={{ borderTop: i === 0 ? 'none' : '1px solid #F3F4F6' }}>
                      <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', width: 36, fontWeight: 800, color: '#6b7280' }}>
                        #{i + 1}
                      </td>
                      <td style={{ padding: '10px 6px', fontWeight: 600 }}>{w.name}</td>
                      <td style={{ padding: '10px 6px', color: '#6b7280', fontSize: 12 }}>
                        joined {formatShortTime(w.created_at)} ·{' '}
                        {Number(w.party_size || 1) === 1 ? '1 person' : `${w.party_size} people`}
                      </td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {w.notify_pref === 'sms'
                          ? <span style={{ fontSize: 11, color: '#1e40af', fontWeight: 700 }}>📱 will text</span>
                          : <span style={{ fontSize: 11, color: '#9ca3af' }}>no text</span>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </Section>

        <p style={{ marginTop: 24, fontSize: 11, color: '#9ca3af', textAlign: 'center' }}>
          This is a private link for the store owner. Refreshes every 30 seconds. Reply to the text/email this URL came in with questions.
        </p>
      </div>
    </div>
  )
}


// ── Stubs for not-found / revoked ────────────────────────────────
/** Stub rendered when a store has no live / upcoming / recently-
 *  ended events. The token itself is still valid — just nothing to
 *  show. Matches the same blue gradient hero so it doesn't feel
 *  like an error page. */
function NoActiveEvents({ storeName, storeLogo }: { storeName: string; storeLogo: string | null | undefined }) {
  return (
    <div style={{ minHeight: '100vh', background: '#FAF8F4', padding: 24, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif' }}>
      <div style={{
        maxWidth: 600, margin: '64px auto', padding: 32,
        background: 'linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%)',
        color: '#fff', borderRadius: 14, textAlign: 'center',
        boxShadow: '0 4px 12px rgba(30,58,138,.18)',
      }}>
        {storeLogo
          ? <img src={storeLogo} alt={storeName} style={{ width: 72, height: 72, borderRadius: '50%', marginBottom: 16 }} />
          : null
        }
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 8px' }}>{storeName}</h1>
        <p style={{ opacity: 0.92, fontSize: 14, margin: 0 }}>
          No active or upcoming events right now. This page will populate when the next event is on the calendar.
        </p>
      </div>
    </div>
  )
}

function NotFound() {
  return (
    <Frame>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1f2937', marginBottom: 8 }}>Event not found</h1>
      <p style={{ color: '#6b7280' }}>The link you followed doesn&apos;t match any active event. If you think this is a mistake, reply to the text/email so we can resend.</p>
    </Frame>
  )
}
function Revoked({ reason }: { reason?: string | null }) {
  return (
    <Frame>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1f2937', marginBottom: 8 }}>This link has been revoked</h1>
      <p style={{ color: '#6b7280' }}>{reason || 'The sender revoked this URL. Reply to the original text/email if you still need access.'}</p>
    </Frame>
  )
}
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: '#FAF8F4', padding: 24 }}>
      <div style={{ maxWidth: 600, margin: '64px auto', padding: 32, background: '#fff', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,.06)' }}>
        {children}
      </div>
    </div>
  )
}


// ── helpers ────────────────────────────────────────────────────
function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function daysBetween(a: string, b: string): number {
  const aMs = new Date(a + 'T12:00:00').getTime()
  const bMs = new Date(b + 'T12:00:00').getTime()
  return Math.floor((bMs - aMs) / 86_400_000)
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}
function fmt(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}
function pct(part: number, whole: number): string {
  if (!whole) return '0'
  return ((part / whole) * 100).toFixed(0)
}
function formatTime(hhmm: string | null | undefined): string {
  if (!hhmm) return '—'
  const t = hhmm.length >= 5 ? hhmm.slice(0, 5) : hhmm
  const [h, m] = t.split(':').map(Number)
  if (isNaN(h)) return hhmm
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}
function formatShortTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  } catch { return '—' }
}
/** Sub-text for the Appointments launcher tile. If anything is on today,
 *  highlight today's counts; otherwise summarize the whole event. */
/** Sum of buyer_check.amount values (numbers in dollars) → cents. */
function totalBuyerCheckCents(rows: { amount: number | string | null | undefined }[]): number {
  return Math.round(rows.reduce((s, r) => s + (Number(r.amount || 0) * 100), 0))
}

/** Group buyer_checks rows by day_number (1–3). NULL day_number
 *  falls into a synthetic "Other" bucket at the end. */
function groupBuysByDay<T extends { day_number: number | null | undefined }>(rows: T[]): { dayNumber: number; rows: T[] }[] {
  const map = new Map<number, T[]>()
  for (const r of rows) {
    const d = Number(r.day_number) > 0 ? Number(r.day_number) : 99
    const arr = map.get(d) || []
    arr.push(r)
    map.set(d, arr)
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a - b)
    .map(([dayNumber, rs]) => ({ dayNumber, rows: rs }))
}

/** Per-day date label for table headers. Falls back to "—" if
 *  start_date is missing. */
function dayDateLabel(startIso: string | null | undefined, dayNumber: number, today: string): string {
  if (!startIso) return '—'
  const iso = addDays(startIso, dayNumber - 1)
  const d = new Date(iso + 'T12:00:00')
  const weekday = d.toLocaleDateString('en-US', { weekday: 'short' })
  const monthDay = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  if (iso === today) return `Today · ${weekday} ${monthDay}`
  return `${weekday} ${monthDay}`
}

/** Sub-text for the Daily Results launcher tile. Highlights cumulative
 *  customer + purchase counts when present; otherwise advertises N days. */
function dailyLauncherSub(days: any[]): string {
  if (days.length === 0) return 'No data yet'
  const tot = days.reduce((acc: any, d: any) => ({
    c: acc.c + (Number(d.customers) || 0),
    p: acc.p + (Number(d.purchases) || 0),
  }), { c: 0, p: 0 })
  if (tot.c === 0 && tot.p === 0) return `${days.length} day${days.length === 1 ? '' : 's'} of data`
  return `${tot.c.toLocaleString()} customers · ${tot.p.toLocaleString()} buys`
}

function apptLauncherSub(
  rows: { appointment_date: string; status: string }[],
  today: string,
): string {
  const todays = rows.filter(r => r.appointment_date === today)
  if (todays.length > 0) {
    const upcoming = todays.filter(r => r.status !== 'completed' && r.status !== 'no_show').length
    const served = todays.filter(r => r.status === 'completed').length
    return `today: ${upcoming} upcoming · ${served} served`
  }
  return `${rows.length} total this event`
}

/** Group appointment rows by appointment_date and return one entry
 *  per date in chronological order. */
function groupApptsByDate<T extends { appointment_date: string }>(rows: T[]): { date: string; rows: T[] }[] {
  const map = new Map<string, T[]>()
  for (const r of rows) {
    const arr = map.get(r.appointment_date) || []
    arr.push(r)
    map.set(r.appointment_date, arr)
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, rs]) => ({ date, rows: rs }))
}

/** Human-friendly day header: "Today · Mon May 12", "Tomorrow · Tue May 13",
 *  or just the weekday + date for further-out days. */
function dateGroupLabel(iso: string, today: string): string {
  const d = new Date(iso + 'T12:00:00')
  const weekday = d.toLocaleDateString('en-US', { weekday: 'short' })
  const monthDay = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  if (iso === today) return `Today · ${weekday} ${monthDay}`
  const tMs = new Date(today + 'T12:00:00').getTime()
  const dMs = d.getTime()
  if (dMs - tMs === 86_400_000) return `Tomorrow · ${weekday} ${monthDay}`
  if (tMs - dMs === 86_400_000) return `Yesterday · ${weekday} ${monthDay}`
  return `${weekday} ${monthDay}`
}

function formatDateRange(startIso: string, endIso: string): string {
  try {
    const s = new Date(startIso + 'T12:00:00')
    const e = new Date(endIso + 'T12:00:00')
    const fmtOpts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
    const sameMonth = s.getMonth() === e.getMonth()
    const startStr = s.toLocaleDateString('en-US', fmtOpts)
    const endStr = sameMonth ? String(e.getDate()) : e.toLocaleDateString('en-US', fmtOpts)
    return `${startStr}–${endStr}, ${e.getFullYear()}`
  } catch { return startIso }
}
/** Pill text for the event-picker chip. Mirrors the phase label
 *  conventions but keeps each chip compact. */
function eventPickerLabel(ev: any, today: string): string {
  if (!ev?.start_date) return '—'
  const start = ev.start_date as string
  const endIso = addDays(start, 2)
  const d = new Date(start + 'T12:00:00')
  const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  if (ev.status === 'cancelled') return `${dateStr} · cancelled`
  if (ev.status === 'reserved') return `${dateStr} · save the date`
  if (start <= today && endIso >= today) {
    const day = Math.max(0, Math.min(2, daysBetween(start, today))) + 1
    return `${dateStr} · LIVE · Day ${day}`
  }
  if (endIso < today) {
    return `${dateStr} · wrapped`
  }
  const days = daysBetween(today, start)
  if (days === 0) return `${dateStr} · starts today`
  if (days === 1) return `${dateStr} · in 1 day`
  return `${dateStr} · in ${days} days`
}

function phaseLabelFor(phase: string, dayNumber: number, start: string, today: string, endIso: string): string {
  if (phase === 'live') return `LIVE · DAY ${dayNumber}`
  if (phase === 'cancelled') return 'CANCELLED'
  if (phase === 'reserved') return 'SAVE THE DATE'
  if (phase === 'past') {
    const days = daysBetween(endIso, today)
    return days === 0 ? 'JUST ENDED' : `WRAPPED · ${days}d AGO`
  }
  // upcoming
  const d = daysBetween(today, start)
  if (d <= 0) return 'STARTING SOON'
  return `IN ${d} DAY${d === 1 ? '' : 'S'}`
}
function pickAvatarColor(seed: string): string {
  const colors = ['#1D6B44', '#1E40AF', '#92400E', '#7C2D12', '#5B21B6', '#0F766E']
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return colors[h % colors.length]
}
function buyerInitialsFor(buyerId: string, workers: any[]): string {
  const w = workers.find((x: any) => x.id === buyerId)
  return w?.name ? initials(w.name) : '—'
}


// ── small layout helpers ────────────────────────────────────────
function Kpi({ label, value, hint, emphasize }: { label: string; value: string; hint: string; emphasize?: boolean }) {
  return (
    <div style={{ padding: '20px 22px', borderRight: '1px solid #F3F4F6' }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: '#6b7280', letterSpacing: '.06em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 30, fontWeight: 900, color: emphasize ? '#1D6B44' : '#0f172a', marginTop: 4, letterSpacing: '-0.02em' }}>{value}</div>
      <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{hint}</div>
    </div>
  )
}
function LauncherTile({ href, icon, label, sub }: { href: string; icon: string; label: string; sub: string }) {
  return (
    <a href={href} style={{
      background: '#fff', borderRadius: 12, padding: '16px 14px',
      textDecoration: 'none', color: '#0f172a',
      boxShadow: '0 1px 3px rgba(0,0,0,.04)',
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <div style={{ fontSize: 28 }}>{icon}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 800 }}>{label}</div>
        <div style={{ fontSize: 11, color: '#6b7280' }}>{sub}</div>
      </div>
    </a>
  )
}
function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} style={{ marginTop: 22, scrollMarginTop: 16 }}>
      <h2 style={{ fontSize: 16, fontWeight: 900, color: '#0f172a', margin: '0 0 10px' }}>{title}</h2>
      {children}
    </section>
  )
}
function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
      {children}
    </div>
  )
}
function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', borderRadius: 10, padding: '18px 20px', color: '#6b7280', fontSize: 13, boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
      {children}
    </div>
  )
}
function Th({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <th style={{ textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 800, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.05em', ...style }}>
      {children}
    </th>
  )
}
function CommPill({ rate }: { rate: number }) {
  const map: Record<number, { bg: string; fg: string; label: string }> = {
    10: { bg: '#DBEAFE', fg: '#1E40AF', label: '10%' },
    5:  { bg: '#FEF3C7', fg: '#92400E', label: '5%'  },
    0:  { bg: '#E5E7EB', fg: '#374151', label: '0%'  },
  }
  const s = map[rate] || { bg: '#F3F4F6', fg: '#374151', label: `${rate}%` }
  return <span style={{ padding: '2px 8px', borderRadius: 4, background: s.bg, color: s.fg, fontWeight: 700, fontSize: 11 }}>{s.label}</span>
}
function ApptStatusPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    confirmed:  { bg: '#FEF3C7', fg: '#92400E', label: '⏳ upcoming' },
    completed:  { bg: '#D1FAE5', fg: '#065F46', label: '✓ served'   },
    no_show:    { bg: '#FEE2E2', fg: '#991B1B', label: '⚠ no-show' },
  }
  const s = map[status] || { bg: '#F3F4F6', fg: '#374151', label: status || '—' }
  return <span style={{ padding: '3px 8px', borderRadius: 4, background: s.bg, color: s.fg, fontWeight: 700, fontSize: 11 }}>{s.label}</span>
}

const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 }
const mono: React.CSSProperties = {
  padding: '10px 6px',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 12, color: '#6b7280',
}
