// POST /api/w9/[id]/action
// Body: { action: 'resend' | 'revoke', reason? }
//
// resend → re-emails the existing /w9/[token] link (same token,
//          no rotation). Bumps send_count + last_sent_*.
// revoke → sets revoked_at + revoked_reason; the public form route
//          renders a "this link has been revoked" stub afterward.
//
// Both gated to admin / superadmin / partner / accounting.

import { NextResponse } from 'next/server'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { pdfAdmin } from '@/lib/wholesale/pdfHelpers'

export const dynamic = 'force-dynamic'

function isAllowed(me: any): boolean {
  if (!me) return false
  return me.role === 'superadmin' || me.role === 'admin' || me.role === 'accounting' || me.is_partner === true
}

function originFrom(req: Request): string {
  const host = req.headers.get('host')
  if (!host) return ''
  const proto = req.headers.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}

export async function POST(req: Request, ctx: { params: { id: string } }) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAllowed(me)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => null) as any
  if (!body?.action) return NextResponse.json({ error: 'Bad JSON' }, { status: 400 })

  const sb = pdfAdmin()
  const { data: w9, error } = await sb.from('w9_requests')
    .select('*').eq('id', ctx.params.id).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!w9) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (body.action === 'revoke') {
    if (w9.status === 'completed') {
      return NextResponse.json({ error: "Can't revoke — already completed." }, { status: 409 })
    }
    const { error: updErr } = await sb.from('w9_requests').update({
      status: 'revoked',
      revoked_at: new Date().toISOString(),
      revoked_reason: body.reason ? String(body.reason).trim() : null,
    }).eq('id', w9.id)
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'resend') {
    if (w9.status === 'completed' || w9.status === 'revoked') {
      return NextResponse.json({ error: `Can't resend — request is ${w9.status}.` }, { status: 409 })
    }

    // Resolve Resend key + brand from address.
    const { data: cfgRow } = await sb.from('settings').select('value').eq('key', 'email').maybeSingle()
    const apiKey = (cfgRow?.value as any)?.apiKey
    if (!apiKey) return NextResponse.json({ error: 'Resend API key missing in settings.email' }, { status: 500 })

    const FROM = w9.brand === 'liberty'
      ? { name: 'Liberty Estate Buyers', email: 'noreply@libertyestatebuyers.com' }
      : { name: 'BEB Portal',            email: 'noreply@updates.bebllp.com' }

    const url = `${originFrom(req)}/w9/${w9.token}`
    const fromName = w9.requested_by_name || me.name
    const subject = 'Reminder: please complete your W-9'
    const html = `<!DOCTYPE html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color:#1f2937; max-width:560px; margin:0 auto; padding:24px;">
  <p style="margin:0 0 12px;">Hi ${escapeHtml(w9.recipient_name)},</p>
  <p style="margin:0 0 16px;">Just a reminder — ${escapeHtml(fromName)} is waiting on your W-9. Open the link below to fill it out + sign.</p>
  <p style="margin:24px 0;">
    <a href="${url}" style="display:inline-block; background:#1D6B44; color:#fff; padding:12px 22px; border-radius:8px; text-decoration:none; font-weight:700;">
      Complete W-9
    </a>
  </p>
</body></html>`

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `${FROM.name} <${FROM.email}>`,
        to: [w9.recipient_email], subject, html,
      }),
    })
    if (!r.ok) {
      const errText = await r.text().catch(() => '')
      return NextResponse.json({ error: `Resend ${r.status}: ${errText || r.statusText}` }, { status: 502 })
    }

    await sb.from('w9_requests').update({
      last_sent_at: new Date().toISOString(),
      last_sent_to: w9.recipient_email,
      send_count: (w9.send_count || 0) + 1,
    }).eq('id', w9.id)

    return NextResponse.json({ ok: true, sentTo: w9.recipient_email })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
