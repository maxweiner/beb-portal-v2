import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export async function POST(request: NextRequest) {
  try {
    const { to } = await request.json()
    if (!to) return NextResponse.json({ error: 'to is required' }, { status: 400 })

    const { data: cfgData } = await sb.from('settings').select('value').eq('key', 'email').maybeSingle()
    const cfg = cfgData?.value
    if (!cfg?.apiKey) return NextResponse.json({ error: 'Email not configured' }, { status: 400 })

    const html = `
    <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px;text-align:center">
      <div style="font-size:48px;margin-bottom:16px">✅</div>
      <div style="font-size:22px;font-weight:900;color:#1a1a16;margin-bottom:8px">Email is working!</div>
      <div style="color:#737368">Your BEB Buyer Portal email settings are configured correctly.</div>
      <div style="margin-top:20px;font-size:12px;color:#a8a89a">Sent via ${cfg.provider} · ${new Date().toLocaleString()}</div>
    </div>`

    if (cfg.provider === 'resend') {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: `${cfg.fromName || 'BEB Portal'} <${cfg.fromEmail}>`, to: [to], subject: '✅ BEB Portal — Test Email', html }),
      })
      if (!res.ok) throw new Error(await res.text())
    } else if (cfg.provider === 'sendgrid') {
      const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: { email: cfg.fromEmail, name: cfg.fromName || 'BEB Portal' },
          personalizations: [{ to: [{ email: to }] }],
          subject: '✅ BEB Portal — Test Email',
          content: [{ type: 'text/html', value: html }],
        }),
      })
      if (!res.ok) throw new Error(await res.text())
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
