import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { geocodeAddress, distanceMiles } from '@/lib/geocoding'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export async function POST(req: NextRequest) {
  // Phase tag for error reporting — every catch updates this so the
  // 500 body and Vercel logs show exactly which step failed
  // (postmark activity log surfaces the response body verbatim).
  let phase = 'init'
  try {
    phase = 'auth'
    // Verify Postmark webhook secret
    const { data: secretSetting } = await sb.from('settings').select('value').eq('key', 'postmark_webhook_secret').single()
    const secret = secretSetting?.value?.replace(/"/g, '')
    const token = req.headers.get('x-postmark-secret')
    if (secret && secret !== 'change_me' && token !== secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    phase = 'parse-body'
    const body = await req.json()

    // Debug: log raw payload to see what Postmark sends. Best-effort —
    // a debug-table failure should not 500 the whole webhook.
    phase = 'debug-log'
    try { await sb.from('debug_logs').insert({ payload: body }) }
    catch (e: any) { console.error('[inbound-travel] debug_logs insert failed:', e?.message) }
    
    const fromEmail = body.From?.toLowerCase() || ''
    const subject = body.Subject || ''
    const textBody = body.TextBody || ''
    const htmlBody = body.HtmlBody || ''
    // Postmark surfaces forwarded-from / reply-to in the Headers array. When
    // someone forwards an itinerary from inside the travel@ inbox the From
    // gets rewritten to travel@bebllp.com — these headers usually still
    // hold the real sender we can match against a user.
    const headersArr: { Name: string; Value: string }[] = body.Headers || []
    const headerEmail = (name: string): string | null => {
      const h = headersArr.find(x => x?.Name?.toLowerCase() === name.toLowerCase())
      if (!h?.Value) return null
      const m = h.Value.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)
      return m ? m[0].toLowerCase() : null
    }
    const replyTo = headerEmail('Reply-To') || headerEmail('X-Original-From') || headerEmail('X-Forwarded-For')
    // Strip tracking URLs and compress whitespace from text body
    const cleanText = textBody
      .replace(/https?:\/\/[^\s>]+/g, '')  // remove URLs
      .replace(/\[image:[^\]]*\]/g, '')      // remove [image: ...] tags
      .replace(/[\n\r]+/g, '\n')              // collapse newlines
      .replace(/[ \t]+/g, ' ')                 // collapse spaces
      .trim()
    // Also clean HTML version as fallback
    const cleanHtml = htmlBody
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/https?:\/\/[^\s]+/g, '')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    // Use whichever is cleaner and longer
    const emailContent = cleanText.length > 200 ? cleanText : cleanHtml

    // Find buyer by email (sender, then header fallbacks like Reply-To /
    // X-Forwarded-For — useful when the user forwards from inside
    // travel@bebllp.com and the From: gets rewritten).
    const { data: allUsers } = await sb.from('users').select('id, name, email, alternate_emails')
    const findByEmail = (e: string | null): typeof allUsers extends Array<infer U> | null ? U | undefined : never =>
      (allUsers as any)?.find((u: any) => {
        if (!e) return false
        if (u.email?.toLowerCase() === e) return true
        const alts = u.alternate_emails || []
        return alts.some((a: string) => a.toLowerCase() === e)
      })
    phase = 'find-buyer'
    let buyer: any = findByEmail(fromEmail) || findByEmail(replyTo)

    phase = 'claude-parse'
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured', phase }, { status: 500 })
    }
    // Use Claude to parse the email
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const parseResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: `Parse this travel confirmation email and extract the reservation details. Return ONLY valid JSON, no markdown.

The email may be a forwarded itinerary from Apple Mail, Gmail, or Outlook — ignore "Begin forwarded message:" headers and the forwarder's signature, focus on the original confirmation. Subject lines often hint at the type (e.g. "Your reservation at Hilton…", "Flight confirmation…", "Hertz reservation…"). Use BOTH the subject and the body to classify. Only return type='unknown' if there is genuinely no travel content.

Email subject: ${subject}
Email content: ${emailContent.slice(0, 12000)}

Return this exact JSON structure:
{
  "type": "flight" | "hotel" | "rental_car" | "unknown",
  "vendor": "airline/hotel/rental company name",
  "confirmation_number": "confirmation or record locator",
  "amount": number or null,
  "details": {
    "flight_number": "if flight",
    "from": "departure airport code if flight",
    "to": "arrival airport code if flight", 
    "seat": "seat number if flight",
    "address": "hotel address if hotel",
    "room_type": "room type if hotel",
    "car_class": "car class if rental",
    "pickup_location": "pickup location if rental"
  },
  "departure_at": "ISO datetime if flight departure",
  "arrival_at": "ISO datetime if flight arrival",
  "check_in": "YYYY-MM-DD if hotel or rental",
  "check_out": "YYYY-MM-DD if hotel or rental",
  "city": "destination city",
  "travel_dates": ["YYYY-MM-DD", "YYYY-MM-DD"],
  "traveler_name": "name of the traveler/passenger if mentioned (full name, e.g., 'Max Weiner')",
  "traveler_email": "the traveler's personal email if mentioned anywhere in the body"
}`
      }]
    })

    phase = 'claude-json-parse'
    const claudeText = parseResponse.content[0].type === 'text' ? parseResponse.content[0].text : '{}'
    let parsed: any
    try { parsed = JSON.parse(claudeText) }
    catch (e: any) {
      console.error('[inbound-travel] Claude returned non-JSON:', claudeText.slice(0, 500))
      return NextResponse.json({ error: 'Claude returned non-JSON', phase, snippet: claudeText.slice(0, 200) }, { status: 500 })
    }
    // Don't drop unclassified emails on the floor. Insert with
    // type='unknown' so they land in the user's Unassigned queue
    // for manual classification + placement. The matcher below
    // skips trying to find a candidate event for these (no useful
    // city/date signal we can trust), so they always end up
    // unassigned by design.
    const isUnknown = parsed.type === 'unknown'
    if (isUnknown) {
      // Normalize fields the type-specific paths assume.
      parsed.type = 'unknown'
      parsed.vendor = parsed.vendor || subject || 'Unclassified email'
    }

    // Smarter buyer match: if email-based lookup didn't find anyone, try
    // matching against the traveler name + email Claude extracted from
    // the body. Name match is normalized + token-based so "Max Weiner",
    // "WEINER, MAX", "Max  S Weiner" all align.
    if (!buyer) {
      const travelerEmail: string = (parsed.traveler_email || '').toLowerCase().trim()
      if (travelerEmail) buyer = findByEmail(travelerEmail) || buyer
    }
    if (!buyer && parsed.traveler_name) {
      const tokens = (s: string) => String(s || '')
        .toLowerCase()
        .replace(/[^a-z\s]/g, ' ')
        .split(/\s+/).filter(Boolean)
      const targetTokens = new Set(tokens(parsed.traveler_name))
      // Need at least 2 matching name tokens to count — avoids single-name collisions.
      buyer = (allUsers as any)?.find((u: any) => {
        const userTokens = tokens(u.name || '')
        const overlap = userTokens.filter(t => targetTokens.has(t)).length
        return overlap >= 2 || (userTokens.length === 1 && targetTokens.has(userTokens[0]))
      }) || buyer
    }

    // Geocode the hotel address (only meaningful for type=hotel; flights
    // and rentals don't have a useful address to geocode). Failures are
    // non-fatal — we just skip the radius filter for that reservation.
    phase = 'geocode-hotel'
    let hotelGeo: { lat: number; lon: number } | null = null
    if (parsed.type === 'hotel') {
      const addr = (parsed.details?.address || '').trim()
      if (addr) {
        try {
          const r = await geocodeAddress(addr)
          if (r) hotelGeo = { lat: r.lat, lon: r.lon }
        } catch (e: any) {
          console.error('[inbound-travel] geocode failed:', e?.message)
        }
      }
    }

    // Resolve the radius from settings (default 25mi). Stored as raw
    // JSON number string (e.g. '25') by the Settings UI.
    let radiusMiles = 25
    const { data: radiusSetting } = await sb.from('settings').select('value').eq('key', 'travel.match_radius_miles').maybeSingle()
    if (radiusSetting?.value != null) {
      const raw = typeof radiusSetting.value === 'number' ? radiusSetting.value : parseInt(String(radiusSetting.value).replace(/[^\d]/g, ''))
      if (!Number.isNaN(raw) && raw > 0) radiusMiles = raw
    }

    // Match against both buying events AND trade shows. We unify them
    // into a single candidate list with a normalized shape so the
    // date+radius/city logic runs once.
    phase = 'fetch-candidates'
    const [eventsRes, tradeShowsRes] = await Promise.all([
      sb.from('events')
        .select('id, store_name, start_date, stores(city, state, lat, lon)')
        .order('start_date', { ascending: false }),
      sb.from('trade_shows')
        .select('id, name, venue_city, venue_state, lat, lon, start_date, end_date')
        .is('deleted_at', null)
        .order('start_date', { ascending: false }),
    ])
    if (eventsRes.error) {
      return NextResponse.json({ error: `events fetch: ${eventsRes.error.message}`, phase }, { status: 500 })
    }
    if (tradeShowsRes.error) {
      return NextResponse.json({ error: `trade_shows fetch: ${tradeShowsRes.error.message}`, phase }, { status: 500 })
    }
    const events = eventsRes.data
    const tradeShows = tradeShowsRes.data

    type Candidate = {
      kind: 'event' | 'trade_show'
      ev: any
      start: Date
      end: Date
      city: string
      state: string
      lat: number | null
      lon: number | null
    }
    const candidates: Candidate[] = [
      ...(events || []).map(ev => {
        const start = new Date(ev.start_date + 'T12:00:00')
        const end = new Date(ev.start_date + 'T12:00:00'); end.setDate(end.getDate() + 4)
        const s = (ev.stores as any)
        return { kind: 'event' as const, ev, start, end,
          city: (s?.city || '').toLowerCase(), state: (s?.state || '').toLowerCase(),
          lat: s?.lat ?? null, lon: s?.lon ?? null }
      }),
      ...(tradeShows || []).map(ts => ({
        kind: 'trade_show' as const, ev: ts,
        start: new Date(ts.start_date + 'T12:00:00'),
        end: new Date(ts.end_date + 'T12:00:00'),
        city: ((ts as any).venue_city || '').toLowerCase(),
        state: ((ts as any).venue_state || '').toLowerCase(),
        lat: (ts as any).lat ?? null, lon: (ts as any).lon ?? null,
      })),
    ]

    let matched: Candidate | null = null
    // Unknown-type emails skip matching by design — we don't trust
    // the parsed signals enough to risk auto-placing them. They
    // land in the user's Unassigned queue for manual placement.
    if (!isUnknown && parsed.travel_dates?.length > 0) {
      const travelDate = new Date(parsed.travel_dates[0])
      const inDateRange = (c: Candidate) =>
        travelDate >= new Date(c.start.getTime() - 3 * 86400000) && travelDate <= c.end

      if (hotelGeo) {
        // Hotel with coords — require radius match. Pick closest.
        const within = candidates
          .filter(inDateRange)
          .map(c => ({ c, dist: distanceMiles(hotelGeo!, { lat: c.lat, lon: c.lon }) }))
          .filter(x => x.dist <= radiusMiles)
          .sort((a, b) => a.dist - b.dist)
        if (within.length > 0) matched = within[0].c
      } else {
        // Flight / rental / un-geocodable hotel — fall back to city/state.
        if (parsed.city) {
          const parsedCity = parsed.city.toLowerCase()
          const parsedState = (parsed.state || '').toLowerCase()
          matched = candidates.find(c => {
            if (!inDateRange(c)) return false
            const cityMatch = c.city.includes(parsedCity) || parsedCity.includes(c.city)
            const stateMatch = parsedState && (c.state.includes(parsedState) || parsedState.includes(c.state))
            return cityMatch || stateMatch
          }) || null
        }
        if (!matched) {
          const dateMatches = candidates.filter(inDateRange)
          if (dateMatches.length === 1) matched = dateMatches[0]
          else if (dateMatches.length > 1) {
            matched = dateMatches.reduce((closest, c) => {
              const cDiff = Math.abs(c.start.getTime() - travelDate.getTime())
              const closestDiff = Math.abs(closest.start.getTime() - travelDate.getTime())
              return cDiff < closestDiff ? c : closest
            })
          }
        }
      }
    }

    const matchedEvent = matched?.kind === 'event' ? matched.ev : null
    const matchedTradeShow = matched?.kind === 'trade_show' ? matched.ev : null

    // Save reservation
    phase = 'insert-reservation'
    const { error } = await sb.from('travel_reservations').insert({
      event_id: matchedEvent?.id || null,
      trade_show_id: matchedTradeShow?.id || null,
      buyer_id: buyer?.id || null,
      buyer_name: buyer?.name || fromEmail,
      type: parsed.type,
      vendor: parsed.vendor || '',
      confirmation_number: parsed.confirmation_number || '',
      amount: parsed.amount || 0,
      details: parsed.details || {},
      departure_at: parsed.departure_at || null,
      arrival_at: parsed.arrival_at || null,
      check_in: parsed.check_in || null,
      check_out: parsed.check_out || null,
      lat: hotelGeo?.lat ?? null,
      lon: hotelGeo?.lon ?? null,
      geocoded_at: hotelGeo ? new Date().toISOString() : null,
      raw_email: (cleanText || cleanHtml).slice(0, 5000),
      parsed_at: new Date().toISOString(),
    })

    if (error) {
      console.error('[inbound-travel] insert error:', error.message)
      return NextResponse.json({ error: error.message, phase }, { status: 500 })
    }

    // Send confirmation back to buyer. Best-effort — Resend hiccups
    // shouldn't 500 the webhook (the reservation is already saved).
    phase = 'confirmation-email'
    try {
      const { data: resendKey } = await sb.from('settings').select('value').eq('key', 'resend_api_key').single()
      if (resendKey?.value && buyer) {
        const key = resendKey.value.replace(/"/g, '')
        const portalUrl = `${process.env.NEXT_PUBLIC_APP_URL}/travel`
        const subjectLine = isUnknown
          ? `📬 Email saved — needs your classification`
          : `✅ ${parsed.vendor || parsed.type} confirmation saved`
        const html = isUnknown
          ? `<p>Hi ${buyer.name},</p><p>We saved your forwarded email but couldn't auto-classify it as a flight, hotel, or rental car. It's in your <a href="${portalUrl}">Travel Share → Unassigned</a> queue for you to label and place on the right event or trade show.</p>`
          : `<p>Hi ${buyer.name},</p><p>Your <strong>${parsed.vendor || parsed.type}</strong> confirmation <strong>${parsed.confirmation_number}</strong> has been saved to <strong>${matchedEvent?.store_name || matchedTradeShow?.name || 'your unassigned travel queue (we couldn\'t auto-match an event)'}</strong> in the BEB portal.</p><p>View it at <a href="${portalUrl}">Travel Share</a>.</p>`
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'BEB Travel <travel@updates.bebllp.com>',
            to: buyer.email,
            subject: subjectLine,
            html,
          })
        })
      }
    } catch (e: any) {
      console.error('[inbound-travel] confirmation email failed (non-fatal):', e?.message)
    }

    return NextResponse.json({
      success: true,
      type: parsed.type,
      event: matchedEvent?.store_name,
      trade_show: matchedTradeShow?.name,
      unassigned: isUnknown || (!matchedEvent && !matchedTradeShow),
    })
  } catch (err: any) {
    console.error(`[inbound-travel] uncaught error in phase=${phase}:`, err?.stack || err?.message)
    return NextResponse.json({ error: err?.message || 'Unknown error', phase }, { status: 500 })
  }
}
