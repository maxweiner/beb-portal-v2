// POST /api/broadcast/send
//
// Body: {
//   subject: string
//   body_html: string
//   brand: 'beb' | 'liberty'
//   scope: { kind: 'all' | 'role' | 'individual', role?: string, user_ids?: string[] }
//   cta_label?: string
//   cta_url?: string
//   show_in_app?: boolean
// }
//
// Resolves the recipient list, inserts a broadcasts row + per-recipient
// rows, sends via Resend (with reply-to set to the sender), updates
// the recipient row status as each send completes. Returns counts.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { blockIfImpersonating } from '@/lib/impersonation/server'
import { buildBroadcastHtml, brandConfig, type BroadcastBrand } from '@/lib/broadcast/buildHtml'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

const RESEND_KEY_SETTING = 'resend_api_key'

async function loadResendKey(sb: ReturnType<typeof admin>): Promise<string | null> {
  const { data } = await sb.from('settings').select('value').eq('key', RESEND_KEY_SETTING).maybeSingle()
  return data?.value || null
}

export async function POST(req: Request) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const blocked = await blockIfImpersonating(req)
  if (blocked) return blocked

  const sb = admin()
  const { data: caller } = await sb.from('users').select('role, is_partner, name, email').eq('id', me.id).maybeSingle()
  const allowed = caller?.role === 'admin' || caller?.role === 'superadmin' || !!caller?.is_partner
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const subject = String(body?.subject || '').trim()
  const bodyHtml = String(body?.body_html || '').trim()
  const brand: BroadcastBrand = body?.brand === 'liberty' ? 'liberty' : 'beb'
  const ctaLabel = body?.cta_label ? String(body.cta_label).trim() : null
  const ctaUrl   = body?.cta_url ? String(body.cta_url).trim() : null
  const showInApp = body?.show_in_app === true

  if (!subject) return NextResponse.json({ error: 'Subject is required' }, { status: 400 })
  if (!bodyHtml || bodyHtml === '<br>' || bodyHtml === '<p></p>') {
    return NextResponse.json({ error: 'Body is required' }, { status: 400 })
  }

  const scopeKind = body?.scope?.kind === 'role' || body?.scope?.kind === 'individual' ? body.scope.kind : 'all'
  const scopeRole: string | null = scopeKind === 'role' ? String(body?.scope?.role || '') : null
  const scopeUserIds: string[] = scopeKind === 'individual'
    ? (Array.isArray(body?.scope?.user_ids) ? body.scope.user_ids.map((x: any) => String(x)) : [])
    : []

  // Resolve recipients server-side (don't trust the client to have
  // pre-filtered correctly).
  let q = sb.from('users')
    .select('id, name, email, role, liberty_access, active')
    .eq('active', true)
  if (brand === 'liberty') q = q.eq('liberty_access', true)
  if (scopeKind === 'role') q = q.eq('role', scopeRole)
  if (scopeKind === 'individual') {
    if (scopeUserIds.length === 0) return NextResponse.json({ error: 'Pick at least one user' }, { status: 400 })
    q = q.in('id', scopeUserIds)
  }
  const { data: users, error: usersErr } = await q
  if (usersErr) return NextResponse.json({ error: usersErr.message }, { status: 500 })

  const recipients = (users || [])
    .map((u: any) => ({ user_id: u.id, name: u.name, email: (u.email || '').trim().toLowerCase() }))
    .filter(r => r.email && r.email.includes('@') && !/placeholder\.bebllp\.local$/i.test(r.email))

  if (recipients.length === 0) {
    return NextResponse.json({ error: 'No valid recipients' }, { status: 400 })
  }

  // Insert the broadcast row first so we can FK the recipients to it.
  const { data: bc, error: bcErr } = await sb
    .from('broadcasts')
    .insert({
      sender_id: me.id,
      brand,
      subject,
      body_html: bodyHtml,
      cta_label: ctaLabel,
      cta_url: ctaUrl,
      scope_kind: scopeKind,
      scope_role: scopeRole,
      scope_user_ids: scopeUserIds,
      show_in_app: showInApp,
      recipient_count: recipients.length,
    })
    .select('id')
    .single()
  if (bcErr || !bc) return NextResponse.json({ error: `Insert failed: ${bcErr?.message}` }, { status: 500 })

  // Stage recipient rows (status='queued').
  await sb.from('broadcast_recipients').insert(
    recipients.map(r => ({
      broadcast_id: bc.id,
      user_id: r.user_id,
      email: r.email,
      status: 'queued' as const,
    })),
  )

  // Build the email + send via Resend.
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

  const resendKey = await loadResendKey(sb)
  if (!resendKey) {
    // Mark every recipient as failed so the UI surfaces the gap.
    await sb.from('broadcast_recipients').update({ status: 'failed', error_text: 'Resend API key not configured' }).eq('broadcast_id', bc.id)
    return NextResponse.json({ error: 'Resend API key not configured. Set it in Admin → Email Settings.', broadcast_id: bc.id }, { status: 500 })
  }

  const senderEmail = caller?.email || me.email
  let sent = 0, failed = 0
  for (const r of recipients) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: `${cfg.fromName} <${cfg.fromAddress}>`,
          to: r.email,
          subject,
          html,
          reply_to: senderEmail,
          tags: [{ name: 'broadcast_id', value: bc.id }],
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        failed++
        await sb.from('broadcast_recipients').update({
          status: 'failed',
          error_text: (j?.message || res.statusText || '').toString().slice(0, 300),
        }).eq('broadcast_id', bc.id).eq('email', r.email)
        continue
      }
      sent++
      const resendId = (j?.id as string | undefined) || null
      await sb.from('broadcast_recipients').update({
        status: 'sent',
        resend_id: resendId,
        sent_at: new Date().toISOString(),
      }).eq('broadcast_id', bc.id).eq('email', r.email)
    } catch (err: any) {
      failed++
      await sb.from('broadcast_recipients').update({
        status: 'failed',
        error_text: (err?.message || 'send error').toString().slice(0, 300),
      }).eq('broadcast_id', bc.id).eq('email', r.email)
    }
  }

  return NextResponse.json({
    ok: true,
    broadcast_id: bc.id,
    sent_count: sent,
    failed_count: failed,
    total: recipients.length,
  })
}
