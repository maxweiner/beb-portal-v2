// POST /api/admin/comms-test-send
//
// Admin-only diagnostic for Trunk Communications (phase 2).
// Sends a tiny test email FROM the calling user's @bebllp.com
// address TO an admin-supplied recipient, so we can verify Resend
// is willing to send from the apex bebllp.com domain (which
// requires DKIM + SPF records on GoDaddy beyond the existing
// updates.bebllp.com subdomain verification).
//
// Body: { to: string }   — recipient email
// Auth: admin / superadmin / partner only.
// On Resend rejection (typically a 403 with "domain not verified"),
// the error string is bubbled up so the operator can see exactly
// what's missing.

import { NextResponse } from 'next/server'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { blockIfImpersonating } from '@/lib/impersonation/server'
import { sendEmail } from '@/lib/email'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const isAdmin = me.role === 'admin' || me.role === 'superadmin' || !!me.is_partner
  if (!isAdmin) return NextResponse.json({ error: 'Admin or partner required' }, { status: 403 })

  const blocked = await blockIfImpersonating(req)
  if (blocked) return blocked

  if (!me.email || !/@bebllp\.com$/i.test(me.email)) {
    return NextResponse.json({
      error: `Your account email (${me.email}) is not @bebllp.com — change your email or sign in as someone whose is, then retry.`,
    }, { status: 400 })
  }

  const body = await req.json().catch(() => ({}))
  const to = String(body.to || '').trim()
  if (!to || !to.includes('@')) {
    return NextResponse.json({ error: 'Provide a valid recipient email' }, { status: 400 })
  }

  const fromHeader = `${me.name || me.email} <${me.email}>`
  const html = `
    <p>Hi —</p>
    <p>This is a Trunk Communications domain-verification test from
       <strong>${escapeHtml(me.name || me.email)}</strong>
       (<a href="mailto:${escapeHtml(me.email)}">${escapeHtml(me.email)}</a>).</p>
    <p>If you received this, Resend is willing to send from the
       <code>bebllp.com</code> apex and the trunk-comms send pipeline
       (phase 5) will work. Please reply <em>received</em> to confirm.</p>
    <p>— BEB Portal</p>
  `

  try {
    const id = await sendEmail({
      from: fromHeader,
      to,
      subject: `BEB Portal — domain verification test (${me.email})`,
      html,
    })
    if (!id) {
      return NextResponse.json({
        error: 'Resend API key is not configured (settings.resend_api_key is empty).',
      }, { status: 503 })
    }
    return NextResponse.json({ ok: true, message_id: id, from: fromHeader, to })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Send failed' }, { status: 502 })
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
