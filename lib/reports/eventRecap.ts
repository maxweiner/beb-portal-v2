// Server-side builder for the Event Recap report. Pulls the event +
// event_days + buyer_entries from Supabase and renders a print-ready
// HTML document. The same HTML powers:
//   - the editor's preview iframe
//   - the standalone /event-recap/[event_id] page (served for printing)
//   - the email body sent via /api/event-recap/send

import { createClient } from '@supabase/supabase-js'

interface DayRow {
  day_number: number
  customers: number | null
  purchases: number | null
  dollars10: number | null
  dollars5: number | null
}

interface BuyerEntryRow {
  buyer_id: string
  day_number: number
  purchases: number | null
  dollars: number | null
  buyer_name?: string | null
}

interface BuildOpts {
  eventId: string
  templateSubject?: string
  templateGreeting?: string
  templateHeaderSubtitle?: string
  templateFooter?: string
}

export interface EventRecapResult {
  found: boolean
  storeName: string
  eventDate: string
  html: string
  subject: string
}

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

const money = (n: number) => '$' + Math.round(n || 0).toLocaleString('en-US')

function fmtDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

function sub(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? '')
}

export async function buildEventRecap(opts: BuildOpts): Promise<EventRecapResult> {
  const sb = admin()

  const { data: event } = await sb
    .from('events')
    .select('id, store_id, start_date, store_name, days:event_days(*), buyer_entries(*)')
    .eq('id', opts.eventId)
    .maybeSingle()
  if (!event) {
    return {
      found: false,
      storeName: '(unknown)', eventDate: '', subject: 'Event recap (not found)',
      html: standalonePage('<p>Event not found.</p>'),
    }
  }

  // Resolve store name (events.store_name can be a snapshot; prefer joined store name)
  let storeName: string = event.store_name || ''
  if (event.store_id) {
    const { data: store } = await sb.from('stores').select('name').eq('id', event.store_id).maybeSingle()
    if (store?.name) storeName = store.name
  }

  // Buyer names — buyer_entries has buyer_id but no name; join to users
  const days = (event.days || []) as DayRow[]
  const entries = (event.buyer_entries || []) as BuyerEntryRow[]
  const buyerIds = Array.from(new Set(entries.map(e => e.buyer_id).filter(Boolean)))
  const nameById = new Map<string, string>()
  if (buyerIds.length > 0) {
    const { data: users } = await sb.from('users').select('id, name, email').in('id', buyerIds)
    for (const u of users || []) nameById.set(u.id, u.name || u.email || '(unknown)')
  }

  // Aggregate per day + per buyer + grand totals
  days.sort((a, b) => (a.day_number || 0) - (b.day_number || 0))
  const grand = {
    customers: 0,
    purchases: 0,
    dollars: 0,
  }
  const perDay = days.map(d => {
    const dollars = (d.dollars10 || 0) + (d.dollars5 || 0)
    grand.customers += d.customers || 0
    grand.purchases += d.purchases || 0
    grand.dollars += dollars
    return { day: d.day_number, customers: d.customers || 0, purchases: d.purchases || 0, dollars }
  })

  const perBuyer = new Map<string, { name: string; purchases: number; dollars: number; days: number }>()
  for (const e of entries) {
    const key = e.buyer_id || 'unknown'
    const cur = perBuyer.get(key) || {
      name: nameById.get(key) || '(unknown buyer)',
      purchases: 0, dollars: 0, days: 0,
    }
    cur.purchases += e.purchases || 0
    cur.dollars += e.dollars || 0
    cur.days += 1
    perBuyer.set(key, cur)
  }
  const buyerRows = [...perBuyer.values()].sort((a, b) => b.dollars - a.dollars)

  const eventDateStr = fmtDate(event.start_date)
  const vars = { storeName, eventDate: eventDateStr, date: eventDateStr }
  const greeting = opts.templateGreeting ? sub(opts.templateGreeting, vars) : 'Event recap'
  const headerSubtitle = opts.templateHeaderSubtitle ? sub(opts.templateHeaderSubtitle, vars) : `${storeName} · ${eventDateStr}`
  const footer = opts.templateFooter ? sub(opts.templateFooter, vars) : 'BEB Portal · Event Recap'
  const subject = opts.templateSubject ? sub(opts.templateSubject, vars) : `Event recap — ${storeName} · ${eventDateStr}`

  const inner = recapBody({
    greeting, headerSubtitle, footer,
    storeName, eventDateStr,
    perDay, grand, buyerRows,
  })

  return {
    found: true,
    storeName,
    eventDate: eventDateStr,
    subject,
    html: standalonePage(inner),
  }
}

function recapBody(opts: {
  greeting: string
  headerSubtitle: string
  footer: string
  storeName: string
  eventDateStr: string
  perDay: { day: number; customers: number; purchases: number; dollars: number }[]
  grand: { customers: number; purchases: number; dollars: number }
  buyerRows: { name: string; purchases: number; dollars: number; days: number }[]
}): string {
  const dayRows = opts.perDay.map(d => `
    <tr>
      <td style="padding:8px 10px;font-weight:700">Day ${d.day}</td>
      <td style="padding:8px 10px;text-align:right">${d.customers}</td>
      <td style="padding:8px 10px;text-align:right">${d.purchases}</td>
      <td style="padding:8px 10px;text-align:right;font-weight:700;color:#1D6B44">${money(d.dollars)}</td>
    </tr>`).join('')

  const buyerRows = opts.buyerRows.length === 0
    ? `<tr><td colspan="4" style="padding:14px;text-align:center;color:#a8a89a">No buyer entries recorded.</td></tr>`
    : opts.buyerRows.map(b => `
        <tr>
          <td style="padding:8px 10px;font-weight:600">${escapeHtml(b.name)}</td>
          <td style="padding:8px 10px;text-align:right">${b.purchases}</td>
          <td style="padding:8px 10px;text-align:right">${b.days}</td>
          <td style="padding:8px 10px;text-align:right;font-weight:700;color:#1D6B44">${money(b.dollars)}</td>
        </tr>`).join('')

  return `
    <header style="margin-bottom:20px">
      <div style="font-size:11px;font-weight:800;color:#737368;text-transform:uppercase;letter-spacing:.06em">Event recap</div>
      <h1 style="font-size:26px;font-weight:900;color:#1a1a16;margin:4px 0 2px">${escapeHtml(opts.storeName)}</h1>
      <div style="font-size:13px;color:#737368">${escapeHtml(opts.headerSubtitle)}</div>
    </header>

    <section style="background:#fff;border:1px solid #d8d3ca;border-radius:12px;padding:16px;margin-bottom:14px">
      <div style="font-size:11px;font-weight:800;color:#737368;text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px">Per day</div>
      <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;border-collapse:collapse">
        <thead>
          <tr style="border-bottom:2px solid #d8d3ca">
            <th style="text-align:left;padding:6px 10px;color:#737368">Day</th>
            <th style="text-align:right;padding:6px 10px;color:#737368">Customers</th>
            <th style="text-align:right;padding:6px 10px;color:#737368">Purchases</th>
            <th style="text-align:right;padding:6px 10px;color:#737368">Spend</th>
          </tr>
        </thead>
        <tbody>
          ${dayRows}
          <tr style="border-top:2px solid #d8d3ca;background:#f5f0e8">
            <td style="padding:10px;font-weight:900">Total</td>
            <td style="padding:10px;text-align:right;font-weight:900">${opts.grand.customers}</td>
            <td style="padding:10px;text-align:right;font-weight:900">${opts.grand.purchases}</td>
            <td style="padding:10px;text-align:right;font-weight:900;color:#1D6B44">${money(opts.grand.dollars)}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section style="background:#fff;border:1px solid #d8d3ca;border-radius:12px;padding:16px;margin-bottom:14px">
      <div style="font-size:11px;font-weight:800;color:#737368;text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px">Per buyer</div>
      <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;border-collapse:collapse">
        <thead>
          <tr style="border-bottom:2px solid #d8d3ca">
            <th style="text-align:left;padding:6px 10px;color:#737368">Buyer</th>
            <th style="text-align:right;padding:6px 10px;color:#737368">Purchases</th>
            <th style="text-align:right;padding:6px 10px;color:#737368">Days worked</th>
            <th style="text-align:right;padding:6px 10px;color:#737368">Spend</th>
          </tr>
        </thead>
        <tbody>${buyerRows}</tbody>
      </table>
    </section>

    <footer style="margin-top:24px;text-align:center;font-size:12px;color:#a8a89a">${escapeHtml(opts.footer)}</footer>
  `
}

function standalonePage(inner: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Event Recap</title>
<style>
  @page { size: letter; margin: 0.6in; }
  body {
    margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    color: #1f2937; background: #f5f0e8; -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .page { max-width: 720px; margin: 0 auto; padding: 24px; }
  @media print {
    body { background: white; }
    .page { padding: 0; max-width: 100%; }
    .no-print { display: none !important; }
  }
</style>
</head>
<body>
  <div class="page">
    ${inner}
  </div>
</body>
</html>`
}

function escapeHtml(s: string): string {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
