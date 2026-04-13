import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

async function sendEmail(cfg: any, to: string[], subject: string, html: string) {
  if (cfg.provider === 'resend') {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: `${cfg.fromName || 'BEB Portal'} <${cfg.fromEmail}>`, to, subject, html }),
    })
    if (!res.ok) throw new Error(await res.text())
  } else if (cfg.provider === 'sendgrid') {
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: { email: cfg.fromEmail, name: cfg.fromName || 'BEB Portal' },
        personalizations: [{ to: to.map(e => ({ email: e })) }],
        subject, content: [{ type: 'text/html', value: html }],
      }),
    })
    if (!res.ok) throw new Error(await res.text())
  } else if (cfg.provider === 'smtp') {
    // For SMTP, use nodemailer via a simple relay
    // This requires nodemailer — handled in the Vercel function environment
    throw new Error('SMTP not supported in this route — use Resend or SendGrid')
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { event_id, day_number, entered_by_name } = body

    // Get email config
    const { data: cfgData } = await sb.from('settings').select('value').eq('key', 'email').maybeSingle()
    const cfg = cfgData?.value
    if (!cfg?.apiKey) return NextResponse.json({ ok: true, skipped: 'no email config' })

    // Get event and store
    const { data: ev } = await sb.from('events')
      .select('*, days:event_days(*)')
      .eq('id', event_id)
      .single()
    if (!ev) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

    const { data: store } = await sb.from('stores').select('*').eq('id', ev.store_id).single()
    const day = ev.days?.find((d: any) => d.day_number === day_number)
    if (!day) return NextResponse.json({ error: 'Day not found' }, { status: 404 })

    // Get admin recipients who have notifications enabled
    const { data: admins } = await sb.from('users')
      .select('email, name, alternate_emails')
      .in('role', ['admin', 'superadmin'])
      .eq('active', true)
      .eq('notify', true)

    if (!admins || admins.length === 0) return NextResponse.json({ ok: true, skipped: 'no recipients' })

    // Collect all recipient emails including alternates
    const recipients: string[] = []
    for (const a of admins) {
      recipients.push(a.email)
      if (a.alternate_emails) recipients.push(...a.alternate_emails)
    }

    const dollars = (day.dollars10 || 0) + (day.dollars5 || 0)
    const closeRate = day.customers > 0 ? Math.round(day.purchases / day.customers * 100) : 0

    const isDay3 = day_number === 3
    const allDays = ev.days || []
    const totalPurchases = allDays.reduce((s: number, d: any) => s + (d.purchases || 0), 0)
    const totalDollars = allDays.reduce((s: number, d: any) => s + (d.dollars10 || 0) + (d.dollars5 || 0), 0)

    const subject = isDay3
      ? `📊 ${store?.name} — 3-Day Summary`
      : `📋 ${store?.name} — Day ${day_number} Report`

    const summarySection = isDay3 ? `
      <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:16px;margin-top:16px">
        <div style="font-weight:900;font-size:15px;color:#14532d;margin-bottom:12px">📊 3-Day Totals</div>
        <table width="100%" cellpadding="6" cellspacing="0">
          <tr><td style="color:#555">Total Purchases</td><td style="font-weight:700;text-align:right">${totalPurchases}</td></tr>
          <tr><td style="color:#555">Total Revenue</td><td style="font-weight:700;text-align:right;color:#1D6B44">$${totalDollars.toLocaleString()}</td></tr>
        </table>
      </div>` : ''

    const html = `
    <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px">
      <div style="font-size:22px;font-weight:900;color:#1a1a16;margin-bottom:4px">${store?.name}</div>
      <div style="color:#737368;margin-bottom:20px">${store?.city}, ${store?.state} · Day ${day_number} of 3</div>

      <div style="background:#fff;border:1px solid #d8d3ca;border-radius:12px;padding:20px;margin-bottom:16px">
        <div style="font-weight:700;font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#737368;margin-bottom:12px">Day ${day_number} Results</div>
        <table width="100%" cellpadding="8" cellspacing="0">
          <tr style="border-bottom:1px solid #f0ece4"><td style="color:#555">Customers Seen</td><td style="font-weight:700;text-align:right">${day.customers || 0}</td></tr>
          <tr style="border-bottom:1px solid #f0ece4"><td style="color:#555">Purchases</td><td style="font-weight:700;text-align:right">${day.purchases || 0}</td></tr>
          <tr style="border-bottom:1px solid #f0ece4"><td style="color:#555">Close Rate</td><td style="font-weight:700;text-align:right">${closeRate}%</td></tr>
          <tr style="border-bottom:1px solid #f0ece4"><td style="color:#555">Revenue</td><td style="font-weight:700;text-align:right;color:#1D6B44">$${dollars.toLocaleString()}</td></tr>
        </table>
      </div>

      <div style="background:#fff;border:1px solid #d8d3ca;border-radius:12px;padding:20px;margin-bottom:16px">
        <div style="font-weight:700;font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#737368;margin-bottom:12px">Lead Sources</div>
        <table width="100%" cellpadding="4" cellspacing="0">
          ${[['VDP / Large Postcard', day.src_vdp], ['Store Postcard', day.src_postcard], ['Social Media', day.src_social],
             ['Word of Mouth', day.src_wordofmouth], ['Repeat Customer', day.src_repeat], ['Other', day.src_other]]
             .filter(([, v]) => v > 0)
             .map(([label, value]) => `<tr><td style="color:#555">${label}</td><td style="font-weight:700;text-align:right">${value}</td></tr>`)
             .join('')}
        </table>
      </div>

      ${summarySection}

      <div style="color:#a8a89a;font-size:12px;margin-top:20px;text-align:center">
        Entered by ${entered_by_name || 'Unknown'} · BEB Buyer Portal
      </div>
    </div>`

    await sendEmail(cfg, recipients, subject, html)
    return NextResponse.json({ ok: true, sent: recipients.length })
  } catch (err: any) {
    console.error('day-entry email error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
