import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

/* ───────────────────────── helpers ───────────────────────── */

const money = (n: number) => '$' + Math.round(n || 0).toLocaleString('en-US')

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

async function fetchWeather(apiKey: string, city: string): Promise<{ city: string; temp: number } | null> {
  if (!apiKey || !city) return null
  try {
    const res = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${apiKey}&units=imperial`,
      { cache: 'no-store' },
    )
    if (!res.ok) return null
    const data = await res.json()
    return { city, temp: Math.round(data?.main?.temp ?? 0) }
  } catch { return null }
}

async function generateShoutout(apiKey: string, firstNames: string[], totalPurchases: number, totalDollars: number, editorFallback?: string): Promise<string> {
  const fallback = editorFallback
    ? editorFallback
    : firstNames.length > 0
      ? `Great work yesterday — ${firstNames.join(', ')}. Let's make today count.`
      : `Morning team — let's make today count.`
  if (!apiKey) return fallback
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 200,
        system: `You write warm 1-2 sentence morning shoutouts for a jewelry buying team. Mention each buyer by first name. Keep it energizing, specific, and fresh — never use the same phrasing twice. Reply with ONLY the shoutout text, no quotes, no explanation, no markdown.`,
        messages: [{
          role: 'user',
          content: `Buyers: ${firstNames.join(', ') || '(team)'}\nYesterday total purchases: ${totalPurchases}\nYesterday total spend: ${money(totalDollars)}\n\nWrite today's shoutout.`,
        }],
      }),
    })
    if (!res.ok) {
      console.warn('[morning-briefing] anthropic error:', await res.text())
      return fallback
    }
    const data = await res.json()
    const text = data?.content?.[0]?.text?.trim()
    return text || fallback
  } catch (err) {
    console.warn('[morning-briefing] anthropic fetch failed:', err)
    return fallback
  }
}

// Wrap each first name in the shoutout with the green span color.
function colorNames(shoutout: string, firstNames: string[]): string {
  let out = shoutout
  // Sort longest first so "Maxwell" doesn't clobber "Max" mid-replacement.
  const sorted = [...firstNames].sort((a, b) => b.length - a.length)
  for (const name of sorted) {
    if (!name) continue
    const safe = name.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')
    out = out.replace(new RegExp(`\\b${safe}\\b`, 'g'), `<span style="color: #86efac;">${name}</span>`)
  }
  return out
}

interface EventSummary {
  store: string
  city: string
  state: string
  dayNumber: number            // 1/2/3 for today
  yesterdayPurchases: number
  yesterdayDollars: number
  cumulativePurchases: number
  cumulativeDollars: number
  cumulativeDays: number       // count of days included in cumulative
  hasYesterday: boolean
}

/* ───────────────────────── HTML builder ───────────────────────── */

function buildHTML(opts: {
  today: Date
  weather: Array<{ city: string; temp: number }>
  shoutout: string
  firstNames: string[]
  totalPurchases: number
  totalDollars: number
  events: EventSummary[]
  greeting: string
  headerSubtitle: string
  footer: string
}): string {
  const coloredShoutout = colorNames(opts.shoutout, opts.firstNames)

  const weatherCards = opts.weather.map(w => `
    <div style="background: rgba(255,255,255,.12); border-radius: 8px; padding: 8px 10px; text-align: center; min-width: 64px;">
      <div style="font-size: 16px; font-weight: 900; color: #fff;">${w.temp}°</div>
      <div style="font-size: 10px; color: rgba(255,255,255,.5);">${w.city}</div>
    </div>`).join('')

  const eventCards = opts.events.map(ev => {
    const isDay1 = ev.dayNumber === 1
    const accent = isDay1 ? '#D97706' : '#1D6B44'
    const pct = ev.dayNumber === 1 ? 33 : ev.dayNumber === 2 ? 66 : 100
    const cumulativeTile = isDay1
      ? `<div style="background: #FFFBEB; border: 1px solid #FDE68A; border-radius: 6px; padding: 10px 14px; flex: 1; display: flex; align-items: center; justify-content: center;">
           <div style="font-size: 12px; color: #92400E; font-weight: 700;">Day 1 — no cumulative yet</div>
         </div>`
      : `<div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 6px; padding: 10px 14px; flex: 1;">
           <div style="font-size: 10px; font-weight: 700; text-transform: uppercase; color: #14532d;">Cumulative</div>
           <div style="font-size: 20px; font-weight: 900; color: #14532d; margin-top: 2px;">${ev.cumulativePurchases} <span style="font-size: 12px; color: #14532d; font-weight: 500;">purch</span></div>
           <div style="font-size: 16px; font-weight: 900; color: #14532d;">${money(ev.cumulativeDollars)}</div>
         </div>`

    return `
    <div style="background: #fff; border: 1px solid #D8D3CA; border-radius: 10px; overflow: hidden; margin-bottom: 12px;">
      <div style="border-left: 4px solid ${accent}; padding: 16px 18px;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start;">
          <div>
            <div style="font-weight: 900; font-size: 15px; color: #1A1A16;">${ev.store}</div>
            <div style="font-size: 12px; color: #737368;">${ev.city}${ev.state ? ', ' + ev.state : ''}</div>
          </div>
          <div style="background: ${accent}; color: #fff; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 10px;">Day ${ev.dayNumber} of 3</div>
        </div>
        <div style="display: flex; gap: 20px; margin-top: 14px;">
          <div style="background: #EDE8DF; border-radius: 6px; padding: 10px 14px; flex: 1;">
            <div style="font-size: 10px; font-weight: 700; text-transform: uppercase; color: #737368;">Yesterday</div>
            <div style="font-size: 20px; font-weight: 900; color: #1A1A16; margin-top: 2px;">${ev.yesterdayPurchases} <span style="font-size: 12px; color: #737368; font-weight: 500;">purch</span></div>
            <div style="font-size: 16px; font-weight: 900; color: #1D6B44;">${money(ev.yesterdayDollars)}</div>
          </div>
          ${cumulativeTile}
        </div>
        <div style="margin-top: 12px;">
          <div style="display: flex; justify-content: space-between; font-size: 11px; color: #737368; margin-bottom: 4px;">
            <span>Event progress</span><span style="font-weight: 700;">${pct}%</span>
          </div>
          <div style="background: #EDE8DF; border-radius: 4px; height: 6px; overflow: hidden;">
            <div style="background: ${accent}; height: 100%; width: ${pct}%; border-radius: 4px;"></div>
          </div>
        </div>
      </div>
    </div>`
  }).join('')

  return `
<div style="max-width: 560px; margin: 0 auto; font-family: system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;">
  <div style="background: #F5F0E8; border-radius: 12px; border: 1px solid #D8D3CA; overflow: hidden;">
    <div style="background: linear-gradient(135deg, #2D3B2D, #1D6B44); padding: 24px 28px;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start;">
        <div>
          <div style="font-size: 20px; font-weight: 900; color: #fff;">${opts.greeting}</div>
          <div style="font-size: 13px; color: rgba(255,255,255,.5); margin-top: 2px;">${opts.headerSubtitle}</div>
        </div>
        <div style="display: flex; gap: 8px; flex-wrap: wrap;">${weatherCards}</div>
      </div>
      <div style="margin-top: 14px; background: rgba(255,255,255,.1); border-radius: 8px; padding: 12px 14px; font-size: 13px; color: rgba(255,255,255,.85); line-height: 1.5;">
        ${coloredShoutout}
      </div>
      <div style="margin-top: 16px; display: flex; gap: 12px;">
        <div style="flex: 1; background: rgba(255,255,255,.1); border-radius: 8px; padding: 12px 14px; text-align: center;">
          <div style="font-size: 28px; font-weight: 900; color: #fff;">${opts.totalPurchases}</div>
          <div style="font-size: 11px; color: rgba(255,255,255,.55);">total purchases yesterday</div>
        </div>
        <div style="flex: 1; background: rgba(255,255,255,.1); border-radius: 8px; padding: 12px 14px; text-align: center;">
          <div style="font-size: 28px; font-weight: 900; color: #86efac;">${money(opts.totalDollars)}</div>
          <div style="font-size: 11px; color: rgba(255,255,255,.55);">total amount spent</div>
        </div>
      </div>
    </div>
    <div style="padding: 24px 28px;">
      <div style="font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: #737368; margin-bottom: 10px;">By event</div>
      ${eventCards}
    </div>
    <div style="padding: 14px 28px; border-top: 1px solid #D8D3CA; text-align: center; font-size: 12px; color: #A8A89A;">
      ${opts.footer}
    </div>
  </div>
</div>`
}

/* ───────────────────────── handler ───────────────────────── */

type Brand = 'beb' | 'liberty'

const BRAND_FROM: Record<Brand, { fromName: string; fromEmail: string; notifyColumn: 'notify_beb' | 'notify_liberty' }> = {
  beb: {
    fromName: 'BEB Portal',
    fromEmail: 'noreply@updates.bebllp.com',
    notifyColumn: 'notify_beb',
  },
  liberty: {
    fromName: 'Liberty Estate Buyers',
    fromEmail: 'noreply@libertyestatebuyers.com',
    notifyColumn: 'notify_liberty',
  },
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const { to: requestedTo, dryRun, brand: bodyBrand } = body as { to?: string[]; dryRun?: boolean; brand?: Brand }
    const brand: Brand = bodyBrand === 'liberty' ? 'liberty' : 'beb'
    const bcfg = BRAND_FROM[brand]

    // Load email / keys from settings.value (apiKey + provider only — from address comes from the brand)
    const { data: cfgData } = await sb.from('settings').select('value').eq('key', 'email').maybeSingle()
    const cfg: any = cfgData?.value || {}

    if (cfg.provider !== 'resend' || !cfg.apiKey) {
      return NextResponse.json({ error: 'Resend not configured in Admin → Email Settings' }, { status: 400 })
    }

    // Resolve recipient IDs → emails. Body wins. Otherwise pull active admins
    // who opted in to this brand's report.
    let recipientEmails: string[] = []
    if (requestedTo && requestedTo.length > 0) {
      const { data: userRows } = await sb.from('users').select('email').in('id', requestedTo)
      recipientEmails = (userRows || [])
        .map((r: any) => r.email)
        .filter((e: any): e is string => typeof e === 'string' && e.includes('@'))
    } else {
      const { data: optedIn } = await sb.from('users')
        .select('email, alternate_emails')
        .in('role', ['admin', 'superadmin'])
        .eq('active', true)
        .eq(bcfg.notifyColumn, true)
      for (const u of optedIn || []) {
        if (u.email) recipientEmails.push(u.email)
        if (u.alternate_emails) recipientEmails.push(...u.alternate_emails)
      }
    }
    if (recipientEmails.length === 0) {
      return NextResponse.json({ error: `No recipients opted in for ${brand} morning briefing` }, { status: 400 })
    }

    // Today / yesterday
    const today = new Date()
    const todayMid = new Date(today); todayMid.setHours(12, 0, 0, 0)

    // Active events for THIS brand: today falls in start_date .. start_date+2
    const { data: allEvents } = await sb.from('events')
      .select('*, days:event_days(*)')
      .eq('brand', brand)
    const activeEvents = (allEvents || []).filter((e: any) => {
      if (!e.start_date) return false
      const start = new Date(e.start_date + 'T12:00:00')
      const end = new Date(start); end.setDate(end.getDate() + 2)
      return todayMid >= start && todayMid <= end
    })

    if (activeEvents.length === 0) {
      return NextResponse.json({ ok: true, skipped: `No active ${brand} events today.` })
    }

    // Hydrate stores for city/state
    const storeIds = Array.from(new Set(activeEvents.map((e: any) => e.store_id).filter(Boolean)))
    const { data: storeRows } = await sb.from('stores').select('id, city, state').in('id', storeIds)
    const storeById = new Map<string, { city: string; state: string }>()
    for (const s of storeRows || []) storeById.set(s.id, { city: s.city || '', state: s.state || '' })

    // Build per-event summary
    let anyHasYesterday = false
    const eventSummaries: EventSummary[] = activeEvents.map((e: any) => {
      const start = new Date(e.start_date + 'T12:00:00')
      const daysSinceStart = Math.round((todayMid.getTime() - start.getTime()) / 86400000)
      const dayNumber = Math.max(1, Math.min(3, daysSinceStart + 1))
      const yesterdayDay = dayNumber - 1
      const days: any[] = e.days || []
      const yRow = yesterdayDay > 0 ? days.find(d => d.day_number === yesterdayDay) : null
      const cumRows = yesterdayDay > 0 ? days.filter(d => d.day_number <= yesterdayDay) : []
      const yDollars = yRow ? (Number(yRow.dollars10) || 0) + (Number(yRow.dollars5) || 0) : 0
      const yPurch = yRow ? (Number(yRow.purchases) || 0) : 0
      const cumDollars = cumRows.reduce((s, d) => s + (Number(d.dollars10) || 0) + (Number(d.dollars5) || 0), 0)
      const cumPurch = cumRows.reduce((s, d) => s + (Number(d.purchases) || 0), 0)
      const hasYesterday = yRow != null && (yPurch > 0 || yDollars > 0)
      if (hasYesterday) anyHasYesterday = true
      const store = storeById.get(e.store_id) || { city: '', state: '' }
      return {
        store: e.store_name || 'Event',
        city: store.city,
        state: store.state,
        dayNumber,
        yesterdayPurchases: yPurch,
        yesterdayDollars: yDollars,
        cumulativePurchases: cumPurch,
        cumulativeDollars: cumDollars,
        cumulativeDays: cumRows.length,
        hasYesterday,
      }
    })

    if (!anyHasYesterday) {
      return NextResponse.json({ ok: true, skipped: "No yesterday data entered yet — nothing to report." })
    }

    // Hero totals
    const totalPurchases = eventSummaries.reduce((s, e) => s + e.yesterdayPurchases, 0)
    const totalDollars = eventSummaries.reduce((s, e) => s + e.yesterdayDollars, 0)

    // First names of workers across active events
    const firstNames = Array.from(new Set(
      activeEvents.flatMap((e: any) => (e.workers || [])
        .map((w: any) => String(w?.name || '').trim().split(/\s+/)[0])
        .filter(Boolean)
      )
    ))

    // Weather per unique city
    const uniqueCities = Array.from(new Set(eventSummaries.map(e => e.city).filter(Boolean)))
    const weatherResults = await Promise.all(uniqueCities.map(c => fetchWeather(cfg.weatherApiKey, c)))
    const weather = weatherResults.filter((w): w is { city: string; temp: number } => w != null)

    // Editable template fields (subject + greeting + footer + shoutout
    // fallback). Fall back to hardcoded defaults if the row was deleted.
    const { data: tpl } = await sb
      .from('report_templates')
      .select('subject, greeting, header_subtitle, footer, shoutout_fallback')
      .eq('id', 'morning-briefing')
      .maybeSingle()
    const dateStr = fmtDate(today)
    const tplVars: Record<string, string> = { date: dateStr }
    const subPlaceholders = (s: string) =>
      (s || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => tplVars[k] ?? '')
    const greeting       = subPlaceholders(tpl?.greeting          || 'Good morning!')
    const headerSubtitle = subPlaceholders(tpl?.header_subtitle   || `${dateStr} · Daily recap`)
    const footer         = subPlaceholders(tpl?.footer            || 'BEB Portal · Have a great day!')
    const shoutoutFallback = subPlaceholders(tpl?.shoutout_fallback || '')

    // Shoutout via Claude (uses the editable fallback when AI is off / fails)
    const shoutout = await generateShoutout(
      cfg.anthropicApiKey, firstNames, totalPurchases, totalDollars,
      shoutoutFallback || undefined,
    )

    // Final HTML
    const html = buildHTML({
      today, weather, shoutout, firstNames,
      totalPurchases, totalDollars, events: eventSummaries,
      greeting, headerSubtitle, footer,
    })

    const brandLabel = brand === 'liberty' ? 'Liberty' : 'BEB'
    const subject = subPlaceholders(tpl?.subject || `${brandLabel} Morning briefing — ${dateStr}`)

    if (dryRun) {
      return NextResponse.json({
        ok: true, dryRun: true, brand,
        to: recipientEmails,
        subject,
        html,
      })
    }

    // Send via Resend, one email per recipient (keeps blind-cc off for clarity).
    const fromHeader = `${bcfg.fromName} <${bcfg.fromEmail}>`
    const sendErrors: string[] = []
    for (const to of recipientEmails) {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: fromHeader,
          to: [to],
          subject,
          html,
        }),
      })
      if (!r.ok) sendErrors.push(`${to}: ${await r.text()}`)
    }

    if (sendErrors.length) {
      return NextResponse.json({
        ok: false,
        sent: recipientEmails.length - sendErrors.length,
        errors: sendErrors,
      }, { status: 207 })
    }

    return NextResponse.json({ ok: true, sent: recipientEmails.length, to: recipientEmails, subject })
  } catch (err: any) {
    console.error('[morning-briefing] error:', err)
    return NextResponse.json({ error: err?.message || 'Unknown error' }, { status: 500 })
  }
}
