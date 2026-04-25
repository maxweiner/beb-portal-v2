// POST /api/notifications/test-send
//
// Sends a one-off rendered template to a test recipient. Bypasses the
// scheduled_notifications queue (no DB row written). Subject/body are
// prefixed with [TEST]. Counts against the rate limit so a chatty
// editor session can't accidentally spam recipients.
//
// Body: {
//   template_id: string,
//   recipient_email?: string,
//   recipient_phone?: string,
//   sample_buyer_id?: string,    // if omitted, uses fixture data
//   sample_event_id?: string,    // if omitted, uses fixture data
// }

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email'
import { sendSMS } from '@/lib/sms'
import { buildMergeVars, substitute, type MergeVarsContext } from '@/lib/notifications/mergeVars'
import { checkRateLimit } from '@/lib/notifications/rateLimit'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

function fixtureCtx(brand: 'beb' | 'liberty'): MergeVarsContext {
  return {
    buyer: { id: 'fixture-buyer', name: 'Sam Sample', email: 'sam@example.com', phone: '5551234567' },
    event: {
      id: 'fixture-event',
      name: 'Sample Estate Buying Event',
      start_date: new Date().toISOString().slice(0, 10),
      city: 'Sample City',
      address: '123 Main St',
      travel_share_url: 'https://beb-portal-v2.vercel.app/?event=fixture-event&nav=travel',
    },
    store: { id: 'fixture-store', name: 'Sample Store', timezone: 'America/New_York' },
    brand,
    otherBuyers: [{ id: 'b1', name: 'Jane Doe' }, { id: 'b2', name: 'Mike Roe' }],
    portalUrl: 'https://beb-portal-v2.vercel.app',
  }
}

export async function POST(req: Request) {
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { template_id, recipient_email, recipient_phone, sample_buyer_id, sample_event_id } = body || {}
  if (!template_id) return NextResponse.json({ error: 'Missing template_id' }, { status: 400 })
  if (!recipient_email && !recipient_phone) {
    return NextResponse.json({ error: 'Need at least one of recipient_email / recipient_phone' }, { status: 400 })
  }

  const sb = admin()

  const { data: tpl, error: tplErr } = await sb.from('notification_templates')
    .select('id, brand, channels, email_subject, email_body_html, email_body_text, sms_body')
    .eq('id', template_id)
    .maybeSingle()
  if (tplErr) return NextResponse.json({ error: tplErr.message }, { status: 500 })
  if (!tpl) return NextResponse.json({ error: 'Template not found' }, { status: 404 })

  const brand = (tpl.brand === 'liberty' ? 'liberty' : 'beb') as 'beb' | 'liberty'

  // Build merge ctx — try real data first, fall back to fixture.
  let ctx: MergeVarsContext = fixtureCtx(brand)
  if (sample_buyer_id && sample_event_id) {
    try {
      const [buyerRes, evRes] = await Promise.all([
        sb.from('users').select('id, name, email, phone').eq('id', sample_buyer_id).maybeSingle(),
        sb.from('events').select('id, store_id, store_name, start_date, workers').eq('id', sample_event_id).maybeSingle(),
      ])
      const buyer = buyerRes.data as any
      const event = evRes.data as any
      if (buyer && event) {
        const storeRes = await sb.from('stores')
          .select('id, name, city, address, timezone')
          .eq('id', event.store_id).maybeSingle()
        const store = (storeRes.data as any) || { id: event.store_id, name: event.store_name }
        ctx = {
          buyer: { id: buyer.id, name: buyer.name, email: buyer.email, phone: buyer.phone },
          event: {
            id: event.id, name: event.store_name, start_date: event.start_date,
            city: store.city, address: store.address,
            travel_share_url: `https://beb-portal-v2.vercel.app/?event=${event.id}&nav=travel`,
          },
          store: { id: store.id, name: store.name, timezone: store.timezone },
          brand,
          otherBuyers: ((event.workers || []) as any[]).filter(w => w.id !== buyer.id),
          portalUrl: 'https://beb-portal-v2.vercel.app',
        }
      }
    } catch { /* fall back to fixture */ }
  }

  const vars = buildMergeVars(ctx)
  const channels = (tpl.channels || []) as string[]
  const results: { channel: string; ok: boolean; error?: string; skipped?: string }[] = []

  if (recipient_email && channels.includes('email')) {
    const gate = await checkRateLimit('email')
    if (!gate.allowed) {
      results.push({ channel: 'email', ok: false, skipped: 'rate_limited' })
    } else {
      try {
        const subject = '[TEST] ' + substitute(tpl.email_subject || '(no subject)', vars)
        const html = substitute(tpl.email_body_html || tpl.email_body_text || '(no body)', vars)
        // sendEmail returns null when no Resend key is configured. That's a
        // silent no-op in production paths but here we want to surface it.
        const id = await sendEmail({ to: recipient_email, subject, html })
        if (id === null) {
          results.push({ channel: 'email', ok: false, error: 'Resend not configured (missing settings.resend_api_key)' })
        } else {
          results.push({ channel: 'email', ok: true })
        }
      } catch (e: any) {
        results.push({ channel: 'email', ok: false, error: e?.message || 'send_failed' })
      }
    }
  }

  if (recipient_phone && channels.includes('sms')) {
    const gate = await checkRateLimit('sms')
    if (!gate.allowed) {
      results.push({ channel: 'sms', ok: false, skipped: 'rate_limited' })
    } else {
      // Pre-flight: sendSMS silently no-ops if Twilio creds missing — check
      // directly so we can report it instead of pretending we sent.
      const cfgRes = await sb.from('settings').select('value').eq('key', 'sms').maybeSingle()
      const cfg = (cfgRes.data?.value || {}) as { accountSid?: string; authToken?: string; fromNumber?: string }
      if (!cfg.accountSid || !cfg.authToken || !cfg.fromNumber) {
        results.push({ channel: 'sms', ok: false, error: 'Twilio not configured (missing settings.sms accountSid/authToken/fromNumber)' })
      } else {
        try {
          const body = '[TEST] ' + substitute(tpl.sms_body || '(no body)', vars)
          await sendSMS(recipient_phone, body)
          results.push({ channel: 'sms', ok: true })
        } catch (e: any) {
          results.push({ channel: 'sms', ok: false, error: e?.message || 'send_failed' })
        }
      }
    }
  }

  const ok = results.length > 0 && results.every(r => r.ok)
  return NextResponse.json({ ok, results })
}
