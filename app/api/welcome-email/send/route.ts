// POST /api/welcome-email/send
//
// Body: {
//   store_id: string,
//   recipients: [{ email: string, name?: string, employee_id?: string }]
// }
//
// Loads the email_welcome template, substitutes {{employee_name}},
// {{store_name}}, {{portal_link}} per recipient, sends via Resend, and
// records each send in welcome_email_log.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email'
import { blockIfImpersonating } from '@/lib/impersonation/server'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

function bookingBaseUrl(): string {
  return process.env.NEXT_PUBLIC_BOOKING_BASE_URL
    || process.env.NEXT_PUBLIC_APP_URL
    || 'https://beb-portal-v2.vercel.app'
}

function sub(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? '')
}

function shellHtml(inner: string): string {
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1f2937;">
      ${inner}
      <p style="font-size:12px;color:#6b7280;margin-top:32px;border-top:1px solid #e5e7eb;padding-top:16px;">
        Beneficial Estate Buyers
      </p>
    </div>
  `
}

interface RecipientIn {
  email: string
  name?: string
  employee_id?: string
}

export async function POST(req: Request) {
  const blocked = await blockIfImpersonating(req)
  if (blocked) return blocked

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const { store_id, recipients } = body ?? {}
  if (!store_id) return NextResponse.json({ error: 'Missing store_id' }, { status: 400 })
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return NextResponse.json({ error: 'recipients must be a non-empty array' }, { status: 400 })
  }

  const sb = admin()

  // Load store + active portal token (start_url for the welcome link)
  const { data: store } = await sb
    .from('stores')
    .select('id, name')
    .eq('id', store_id)
    .maybeSingle()
  if (!store) return NextResponse.json({ error: 'Store not found' }, { status: 404 })

  const { data: tokenRow } = await sb
    .from('store_portal_tokens')
    .select('token')
    .eq('store_id', store_id)
    .eq('active', true)
    .maybeSingle()
  if (!tokenRow) {
    return NextResponse.json({
      error: 'No active store portal token. Generate one in the store config first so the welcome email has a working link.',
    }, { status: 400 })
  }
  const portalLink = `${bookingBaseUrl()}/store-portal/${tokenRow.token}`

  // Load the editable welcome template (with hardcoded fallback)
  const { data: tpl } = await sb
    .from('notification_templates')
    .select('subject, body')
    .eq('id', 'email_welcome')
    .maybeSingle()
  const subject = tpl?.subject || 'Welcome to {{store_name}}'
  const bodyTpl = tpl?.body || `<p>Hi {{employee_name}},</p><p>Welcome to {{store_name}}.</p><p><a href="{{portal_link}}">Open the staff portal</a></p>`

  const sent: { email: string; ok: boolean; error?: string }[] = []
  for (const r of recipients as RecipientIn[]) {
    if (!r?.email) continue
    const vars: Record<string, string> = {
      employee_name: r.name || 'there',
      store_name: store.name,
      portal_link: portalLink,
    }
    try {
      const messageId = await sendEmail({
        to: r.email,
        subject: sub(subject, vars),
        html: shellHtml(sub(bodyTpl, vars)),
      })
      await sb.from('welcome_email_log').insert({
        store_id,
        store_employee_id: r.employee_id || null,
        recipient_email: r.email,
        sent_by: null,   // server route — no session passthrough yet; admin UI gates access
        resend_message_id: messageId,
      })
      sent.push({ email: r.email, ok: true })
    } catch (err: any) {
      console.error('welcome email send failed', r.email, err)
      sent.push({ email: r.email, ok: false, error: err?.message || 'unknown' })
    }
  }

  return NextResponse.json({
    ok: sent.every(s => s.ok),
    sent: sent.filter(s => s.ok).length,
    results: sent,
  })
}
