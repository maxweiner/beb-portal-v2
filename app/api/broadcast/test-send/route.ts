// POST /api/broadcast/test-send
//
// Sends the rendered broadcast email to ONLY the calling operator's
// email so they can preview it in their real inbox. Doesn't write a
// broadcasts row, doesn't track recipients, doesn't increment any
// counter — purely a sanity-check button.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { sendEmail } from '@/lib/email'
import { buildBroadcastHtml, brandConfig, type BroadcastBrand } from '@/lib/broadcast/buildHtml'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

export async function POST(req: Request) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = admin()
  const { data: caller } = await sb.from('users').select('role, is_partner, email').eq('id', me.id).maybeSingle()
  const allowed = caller?.role === 'admin' || caller?.role === 'superadmin' || !!caller?.is_partner
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const subject = String(body?.subject || '').trim() || '[TEST] Broadcast preview'
  const bodyHtml = String(body?.body_html || '').trim() || '<p>(empty body)</p>'
  const brand: BroadcastBrand = body?.brand === 'liberty' ? 'liberty' : 'beb'
  const ctaLabel = body?.cta_label ? String(body.cta_label).trim() : null
  const ctaUrl   = body?.cta_url ? String(body.cta_url).trim() : null

  const url = new URL(req.url)
  const portalBaseUrl = `${url.protocol}//${url.host}`
  const cfg = brandConfig(brand)
  const html = buildBroadcastHtml({
    brand,
    subject,
    bodyHtml,
    ctaLabel,
    ctaUrl,
    logoAbsoluteUrl: `${portalBaseUrl}/beb-wordmark.png`,
  })

  const to = caller?.email || me.email
  if (!to) return NextResponse.json({ error: 'No email on your account' }, { status: 400 })

  try {
    await sendEmail({
      to,
      from: `${cfg.fromName} <${cfg.fromAddress}>`,
      subject: `[TEST] ${subject}`,
      html,
    })
    return NextResponse.json({ ok: true, sent_to: to })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Test send failed' }, { status: 500 })
  }
}
