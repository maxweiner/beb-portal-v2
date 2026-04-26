import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    // Verify Postmark webhook secret
    const { data: secretSetting } = await sb.from('settings').select('value').eq('key', 'postmark_webhook_secret').single()
    const secret = secretSetting?.value?.replace(/"/g, '')
    const token = req.headers.get('x-postmark-secret')
    if (secret && secret !== 'change_me' && token !== secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    
    // Debug: log raw payload to see what Postmark sends
    await sb.from('debug_logs').insert({ payload: body })
    
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
    let buyer: any = findByEmail(fromEmail) || findByEmail(replyTo)

    // Use Claude to parse the email
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const parseResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: `Parse this travel confirmation email and extract the reservation details. Return ONLY valid JSON, no markdown.

Email subject: ${subject}
Email content: ${emailContent.slice(0, 6000)}

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

    const parsed = JSON.parse(parseResponse.content[0].type === 'text' ? parseResponse.content[0].text : '{}')
    if (parsed.type === 'unknown') {
      return NextResponse.json({ message: 'Could not identify reservation type' })
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

    // Match to event by date range first, then city/state
    const { data: events } = await sb.from('events')
      .select('id, store_name, start_date, stores(city, state)')
      .order('start_date', { ascending: false })

    let matchedEvent = null
    if (parsed.travel_dates?.length > 0) {
      const travelDate = new Date(parsed.travel_dates[0])
      
      // First try: match by city name (exact or partial)
      if (parsed.city) {
        matchedEvent = events?.find(ev => {
          const evStart = new Date(ev.start_date + 'T12:00:00')
          const evEnd = new Date(ev.start_date + 'T12:00:00')
          evEnd.setDate(evEnd.getDate() + 4)
          const dateMatch = travelDate >= new Date(evStart.getTime() - 3 * 86400000) && travelDate <= evEnd
          const storeCity = (ev.stores as any)?.city?.toLowerCase() || ''
          const storeState = (ev.stores as any)?.state?.toLowerCase() || ''
          const parsedCity = parsed.city.toLowerCase()
          const parsedState = (parsed.state || '').toLowerCase()
          const cityMatch = storeCity.includes(parsedCity) || parsedCity.includes(storeCity)
          const stateMatch = parsedState && (storeState.includes(parsedState) || parsedState.includes(storeState))
          return dateMatch && (cityMatch || stateMatch)
        })
      }

      // Second try: if no city match, just match by date range (closest event)
      if (!matchedEvent) {
        const dateMatches = events?.filter(ev => {
          const evStart = new Date(ev.start_date + 'T12:00:00')
          const evEnd = new Date(ev.start_date + 'T12:00:00')
          evEnd.setDate(evEnd.getDate() + 4)
          return travelDate >= new Date(evStart.getTime() - 3 * 86400000) && travelDate <= evEnd
        })
        // Pick the closest event by date
        if (dateMatches && dateMatches.length === 1) {
          matchedEvent = dateMatches[0]
        } else if (dateMatches && dateMatches.length > 1) {
          // Multiple events on same dates - pick closest by start date
          matchedEvent = dateMatches.reduce((closest, ev) => {
            const evDiff = Math.abs(new Date(ev.start_date + 'T12:00:00').getTime() - travelDate.getTime())
            const closestDiff = Math.abs(new Date(closest.start_date + 'T12:00:00').getTime() - travelDate.getTime())
            return evDiff < closestDiff ? ev : closest
          })
        }
      }
    }

    // Save reservation
    const { error } = await sb.from('travel_reservations').insert({
      event_id: matchedEvent?.id || null,
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
      raw_email: (cleanText || cleanHtml).slice(0, 5000),
      parsed_at: new Date().toISOString(),
    })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Send confirmation back to buyer
    const { data: resendKey } = await sb.from('settings').select('value').eq('key', 'resend_api_key').single()
    if (resendKey?.value && buyer) {
      const key = resendKey.value.replace(/"/g, '')
      const eventName = matchedEvent?.store_name || 'an upcoming event'
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'BEB Travel <travel@updates.bebllp.com>',
          to: buyer.email,
          subject: `✅ ${parsed.vendor || parsed.type} confirmation saved`,
          html: `<p>Hi ${buyer.name},</p><p>Your <strong>${parsed.vendor || parsed.type}</strong> confirmation <strong>${parsed.confirmation_number}</strong> has been saved to <strong>${eventName}</strong> in the BEB portal.</p><p>View it at <a href="${process.env.NEXT_PUBLIC_APP_URL}/travel">Travel Share</a>.</p>`
        })
      })
    }

    return NextResponse.json({ success: true, type: parsed.type, event: matchedEvent?.store_name })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
