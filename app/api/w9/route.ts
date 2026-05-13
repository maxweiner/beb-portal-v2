// POST /api/w9        — create a new W-9 request
// GET  /api/w9        — list recent W-9 requests (history panel)
//
// Internal-user flow:    body = { recipient_user_id, send_email? }
// External flow:         body = { recipient_name, recipient_email, send_email? }
//
// `send_email: true` emails the recipient the /w9/[token] link.
// Otherwise the request is created in 'pending' state and the
// accountant can copy the link manually.

import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { pdfAdmin } from '@/lib/wholesale/pdfHelpers'
import { sendEmail } from '@/lib/email'

export const dynamic = 'force-dynamic'

function isAllowed(me: any): boolean {
  if (!me) return false
  return me.role === 'superadmin' || me.role === 'admin' || me.role === 'accounting' || me.is_partner === true
}

function mintToken(): string {
  return randomBytes(18)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function originFrom(req: Request): string {
  const fromHeader = req.headers.get('origin')
  if (fromHeader) return fromHeader
  const host = req.headers.get('host')
  if (host) {
    const proto = req.headers.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https')
    return `${proto}://${host}`
  }
  return ''
}

// ── POST: create ────────────────────────────────────────────────
export async function POST(req: Request) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAllowed(me)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => null) as any
  if (!body) return NextResponse.json({ error: 'Bad JSON' }, { status: 400 })

  const brand = String(body.brand || 'beb')
  if (brand !== 'beb' && brand !== 'liberty') return NextResponse.json({ error: 'Invalid brand' }, { status: 400 })
  // Local flag renamed from `sendEmail` to avoid shadowing the
  // imported sendEmail() helper used by emailW9Link() below.
  const shouldEmail = body.send_email !== false  // default true

  const sb = pdfAdmin()

  // Resolve recipient: internal user OR external name+email.
  let recipientUserId: string | null = null
  let recipientName: string
  let recipientEmail: string

  if (body.recipient_user_id) {
    const { data: u, error } = await sb.from('users')
      .select('id, name, email').eq('id', body.recipient_user_id).maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!u) return NextResponse.json({ error: 'User not found' }, { status: 404 })
    recipientUserId = u.id
    recipientName = (u as any).name || 'Recipient'
    recipientEmail = (u as any).email || ''
    if (!recipientEmail) {
      return NextResponse.json({ error: `User ${recipientName} has no email on file` }, { status: 422 })
    }
  } else {
    recipientName = String(body.recipient_name || '').trim()
    recipientEmail = String(body.recipient_email || '').trim().toLowerCase()
    if (!recipientName) return NextResponse.json({ error: 'Recipient name required' }, { status: 422 })
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipientEmail)) {
      return NextResponse.json({ error: 'Valid recipient email required' }, { status: 422 })
    }
  }

  // Mint token + insert.
  const token = mintToken()
  const { data: inserted, error: insErr } = await sb.from('w9_requests')
    .insert({
      brand,
      recipient_user_id: recipientUserId,
      recipient_name: recipientName,
      recipient_email: recipientEmail,
      token,
      requested_by: me.id,
      requested_by_email: me.email,
      requested_by_name: me.name,
    })
    .select('*').single()
  if (insErr) return NextResponse.json({ error: `Insert: ${insErr.message}` }, { status: 500 })

  // Optional send.
  const url = `${originFrom(req)}/w9/${token}`
  let sentTo: string | null = null
  if (shouldEmail) {
    const sent = await emailW9Link({
      brand: brand as 'beb' | 'liberty',
      toEmail: recipientEmail,
      toName: recipientName,
      fromName: me.name,
      url,
    })
    if (sent) {
      sentTo = recipientEmail
      await sb.from('w9_requests').update({
        last_sent_at: new Date().toISOString(),
        last_sent_to: recipientEmail,
        send_count: 1,
      }).eq('id', inserted.id)
    }
  }

  return NextResponse.json({ ok: true, request: inserted, url, sentTo })
}


// ── GET: list ───────────────────────────────────────────────────
export async function GET(req: Request) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAllowed(me)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const url = new URL(req.url)
  const brand = url.searchParams.get('brand') || 'beb'
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 200)

  const sb = pdfAdmin()
  const { data, error } = await sb.from('w9_requests')
    .select('*')
    .eq('brand', brand)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ requests: data || [] })
}


async function emailW9Link({
  brand, toEmail, toName, fromName, url,
}: {
  brand: 'beb' | 'liberty'
  toEmail: string
  toName: string
  fromName: string
  url: string
}): Promise<boolean> {
  // Use the shared sendEmail() helper rather than calling Resend
  // directly here — that way the W-9 send participates in the same
  // config-lookup, dev-recipient sender swap, and error surface as
  // every other transactional email in the app. Historically this
  // route had its own Resend fetch + a different settings key
  // ('email' with a nested .apiKey) which silently fell out of sync
  // with the rest of the codebase (which reads 'resend_api_key' as a
  // flat value), so emails appeared as "no API key" even when one
  // was configured.
  const fromAddr = brand === 'liberty'
    ? 'Liberty Estate Buyers <noreply@libertyestatebuyers.com>'
    : 'BEB Portal <noreply@updates.bebllp.com>'

  const subject = 'Please complete a W-9 tax form'
  const html = `<!DOCTYPE html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color:#1f2937; max-width:560px; margin:0 auto; padding:24px;">
  <p style="margin:0 0 12px;">Hi ${escapeHtml(toName)},</p>
  <p style="margin:0 0 16px;">${escapeHtml(fromName)} needs you to complete an IRS Form W-9 so we can pay you correctly. Open the link below to fill out the short form, sign, and submit — it takes ~2 minutes.</p>
  <p style="margin:24px 0;">
    <a href="${url}" style="display:inline-block; background:#1D6B44; color:#fff; padding:12px 22px; border-radius:8px; text-decoration:none; font-weight:700;">
      Complete W-9
    </a>
  </p>
  <p style="margin:16px 0 0; font-size:13px; color:#6b7280;">The link is valid for 30 days. Reply to this email with any questions.</p>
</body></html>`

  try {
    const id = await sendEmail({ to: toEmail, subject, html, from: fromAddr })
    // sendEmail returns null when no API key is configured (silent
    // no-op). The caller surfaces that as "Email not sent (no API
    // key)" in the UI — same as before, but now driven by the same
    // settings key the rest of the app uses.
    return !!id
  } catch (err) {
    console.warn(`[w9 create] sendEmail failed: ${err instanceof Error ? err.message : String(err)}`)
    return false
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
