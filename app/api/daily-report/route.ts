import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export async function GET(request: NextRequest) {
  // Verify cron secret
  const secret = request.headers.get('x-cron-secret') || request.nextUrl.searchParams.get('secret')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Get email config
    const { data: cfgData } = await sb.from('settings').select('value').eq('key', 'email').maybeSingle()
    const cfg = cfgData?.value
    if (!cfg?.apiKey) return NextResponse.json({ ok: true, skipped: 'no email config' })

    // Get active events (within ±1 week of today)
    const today = new Date().toISOString().slice(0, 10)
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
    const weekAhead = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)

    const { data: events } = await sb.from('events')
      .select('*, days:event_days(*)')
      .gte('start_date', weekAgo)
      .lte('start_date', weekAhead)
      .order('start_date')

    if (!events || events.length === 0) {
      return NextResponse.json({ ok: true, skipped: 'no active events' })
    }

    // Get store info
    const storeIds = Array.from(new Set(events.map((e: any) => e.store_id)))
    const { data: stores } = await sb.from('stores').select('*').in('id', storeIds)
    const storeMap = Object.fromEntries((stores || []).map((s: any) => [s.id, s]))

    // Get admin recipients
    const { data: admins } = await sb.from('users')
      .select('email, alternate_emails')
      .in('role', ['admin', 'superadmin'])
      .eq('active', true)
      .eq('notify', true)

    if (!admins || admins.length === 0) return NextResponse.json({ ok: true, skipped: 'no recipients' })

    const recipients: string[] = []
    for (const a of admins) {
      recipients.push(a.email)
      if (a.alternate_emails) recipients.push(...a.alternate_emails)
    }

    // Build email HTML
    const eventRows = events.map((ev: any) => {
      const store = storeMap[ev.store_id]
      const days = ev.days || []
      const totalPurchases = days.reduce((s: number, d: any) => s + (d.purchases || 0), 0)
      const totalDollars = days.reduce((s: number, d: any) => s + (d.dollars10 || 0) + (d.dollars5 || 0), 0)
      const isActive = ev.start_date <= today && today <= new Date(new Date(ev.start_date + 'T12:00:00').getTime() + 2 * 86400000).toISOString().slice(0, 10)

      return `
        <tr style="border-bottom:1px solid #f0ece4">
          <td style="padding:10px 8px;font-weight:700">${store?.name || ev.store_name}</td>
          <td style="padding:10px 8px;color:#737368">${store?.city}, ${store?.state}</td>
          <td style="padding:10px 8px;color:#737368">${ev.start_date}</td>
          <td style="padding:10px 8px;text-align:center">${days.length}/3</td>
          <td style="padding:10px 8px;text-align:right;font-weight:700">${totalPurchases}</td>
          <td style="padding:10px 8px;text-align:right;font-weight:700;color:#1D6B44">$${totalDollars.toLocaleString()}</td>
          <td style="padding:10px 8px;text-align:center">${isActive ? '<span style="background:#f0fdf4;color:#14532d;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700">ACTIVE</span>' : ''}</td>
        </tr>`
    }).join('')

    const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

    const html = `
    <div style="font-family:system-ui,sans-serif;max-width:680px;margin:0 auto;padding:24px">
      <div style="font-size:24px;font-weight:900;color:#1a1a16;margin-bottom:4px">🌅 Morning Report</div>
      <div style="color:#737368;margin-bottom:24px">${dateStr}</div>

      <div style="background:#fff;border:1px solid #d8d3ca;border-radius:12px;padding:20px">
        <div style="font-weight:700;font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#737368;margin-bottom:16px">
          Active & Upcoming Events
        </div>
        <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px">
          <thead>
            <tr style="border-bottom:2px solid #d8d3ca">
              <th style="text-align:left;padding:8px;color:#737368;font-weight:700">Store</th>
              <th style="text-align:left;padding:8px;color:#737368;font-weight:700">Location</th>
              <th style="text-align:left;padding:8px;color:#737368;font-weight:700">Start</th>
              <th style="text-align:center;padding:8px;color:#737368;font-weight:700">Days</th>
              <th style="text-align:right;padding:8px;color:#737368;font-weight:700">Purchases</th>
              <th style="text-align:right;padding:8px;color:#737368;font-weight:700">Revenue</th>
              <th style="text-align:center;padding:8px;color:#737368;font-weight:700">Status</th>
            </tr>
          </thead>
          <tbody>${eventRows}</tbody>
        </table>
      </div>

      <div style="color:#a8a89a;font-size:12px;margin-top:20px;text-align:center">
        BEB Buyer Portal · Daily Morning Report · 7:00 AM
      </div>
    </div>`

    // Send email
    if (cfg.provider === 'resend') {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: `${cfg.fromName || 'BEB Portal'} <${cfg.fromEmail}>`,
          to: recipients,
          subject: `🌅 Morning Report — ${dateStr}`,
          html,
        }),
      })
    } else if (cfg.provider === 'sendgrid') {
      await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: { email: cfg.fromEmail, name: cfg.fromName || 'BEB Portal' },
          personalizations: [{ to: recipients.map(e => ({ email: e })) }],
          subject: `🌅 Morning Report — ${dateStr}`,
          content: [{ type: 'text/html', value: html }],
        }),
      })
    }

    return NextResponse.json({ ok: true, sent: recipients.length, events: events.length })
  } catch (err: any) {
    console.error('morning report error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
