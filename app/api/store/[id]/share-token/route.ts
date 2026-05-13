// POST /api/store/[id]/share-token
// Body: { action: 'mint' | 'rotate' | 'revoke' | 'send', to?: string, reason?: string }
//
// Manages the per-STORE public share URL (`store_share_tokens` rows
// that drive the /e/[token] dashboard with the event picker).
//
//   - mint    : create a token if none active; otherwise return the
//               existing active one
//   - rotate  : revoke the current active token + create a fresh one
//               (the old URL stops working)
//   - revoke  : kill the current active token without replacement
//   - send    : ensure-or-create a token, then email the URL to the
//               store's owner_email (or `body.to` override) via Resend.
//               Persists last_sent_at + last_sent_to.
//
// Replaces /api/event/[id]/share-token from the previous architecture.
// Auth: admin / superadmin / partner — same gate as the event view.

import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { pdfAdmin } from '@/lib/wholesale/pdfHelpers'

export const dynamic = 'force-dynamic'

function isAllowed(me: any): boolean {
  if (!me) return false
  return me.role === 'superadmin' || me.role === 'admin' || me.is_partner === true
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
    const proto = req.headers.get('x-forwarded-proto') || 'https'
    return `${proto}://${host}`
  }
  return ''
}

async function loadActive(sb: ReturnType<typeof pdfAdmin>, storeId: string) {
  const { data } = await sb.from('store_share_tokens')
    .select('*')
    .eq('store_id', storeId)
    .is('revoked_at', null)
    .maybeSingle()
  return data as any
}

async function createNew(sb: ReturnType<typeof pdfAdmin>, storeId: string, me: any) {
  const token = mintToken()
  const { data, error } = await sb.from('store_share_tokens')
    .insert({
      store_id: storeId,
      token,
      created_by: me.id,
      created_by_email: me.email,
    })
    .select('*').single()
  if (error) throw new Error(error.message)
  return data as any
}

async function revokeRow(sb: ReturnType<typeof pdfAdmin>, id: string, reason: string | null) {
  const { error } = await sb.from('store_share_tokens')
    .update({ revoked_at: new Date().toISOString(), revoked_reason: reason })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

export async function POST(req: Request, ctx: { params: { id: string } }) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAllowed(me)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => null) as any
  if (!body || typeof body.action !== 'string') {
    return NextResponse.json({ error: 'Bad JSON' }, { status: 400 })
  }
  const action = body.action as 'mint' | 'rotate' | 'revoke' | 'send'

  const sb = pdfAdmin()
  const storeId = ctx.params.id

  const { data: store, error: storeErr } = await sb.from('stores')
    .select('id, name, brand, owner_email, owner_name')
    .eq('id', storeId).maybeSingle()
  if (storeErr) return NextResponse.json({ error: storeErr.message }, { status: 500 })
  if (!store) return NextResponse.json({ error: 'Store not found' }, { status: 404 })

  try {
    if (action === 'revoke') {
      const active = await loadActive(sb, storeId)
      if (!active) return NextResponse.json({ ok: true, message: 'No active token' })
      await revokeRow(sb, active.id, body.reason ? String(body.reason).trim() : null)
      return NextResponse.json({ ok: true })
    }

    if (action === 'mint') {
      const active = await loadActive(sb, storeId)
      if (active) return NextResponse.json({ ok: true, token: active })
      const fresh = await createNew(sb, storeId, me)
      return NextResponse.json({ ok: true, token: fresh })
    }

    if (action === 'rotate') {
      const active = await loadActive(sb, storeId)
      if (active) await revokeRow(sb, active.id, 'rotated')
      const fresh = await createNew(sb, storeId, me)
      return NextResponse.json({ ok: true, token: fresh })
    }

    if (action === 'send') {
      let active = await loadActive(sb, storeId)
      if (!active) active = await createNew(sb, storeId, me)

      const recipient = (typeof body.to === 'string' && body.to.trim())
        ? body.to.trim()
        : (store.owner_email || '')
      if (!recipient || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipient)) {
        return NextResponse.json({
          error: 'No recipient email — set the store\'s owner_email or pass `to` in the body.',
          token: active,
        }, { status: 400 })
      }

      const { data: cfgRow } = await sb.from('settings').select('value').eq('key', 'email').maybeSingle()
      const apiKey = (cfgRow?.value as any)?.apiKey
      if (!apiKey) {
        return NextResponse.json({ error: 'Resend API key missing in settings.email', token: active }, { status: 500 })
      }

      const brand: string = (store as any).brand || 'beb'
      const FROM = brand === 'liberty'
        ? { name: 'Liberty Estate Buyers', email: 'noreply@libertyestatebuyers.com' }
        : { name: 'BEB Portal', email: 'noreply@updates.bebllp.com' }

      const origin = originFrom(req)
      const url = `${origin}/e/${active.token}`

      const greeting = store.owner_name
        ? `Hi ${escapeHtml(store.owner_name as string)},`
        : 'Hi,'
      const subject = `Your live event dashboard — ${store.name || 'BEB event'}`
      const html = `<!DOCTYPE html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color:#1f2937; max-width:560px; margin:0 auto; padding:24px;">
  <p style="margin:0 0 12px;">${greeting}</p>
  <p style="margin:0 0 16px;">Here's your live event dashboard for <strong>${escapeHtml(store.name || '')}</strong>. Bookmark this — it always shows your current event (and switches automatically when the next one starts).</p>
  <p style="margin:24px 0;">
    <a href="${url}" style="display:inline-block; background:#1D6B44; color:#fff; padding:12px 22px; border-radius:8px; text-decoration:none; font-weight:700;">
      Open dashboard
    </a>
  </p>
  <p style="margin:16px 0 0; font-size:13px; color:#6b7280;">If this link ever stops working, reply to this email and we'll send a fresh one.</p>
</body></html>`

      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: `${FROM.name} <${FROM.email}>`,
          to: [recipient],
          subject,
          html,
        }),
      })
      if (!r.ok) {
        const errText = await r.text().catch(() => '')
        return NextResponse.json({ error: `Resend ${r.status}: ${errText || r.statusText}`, token: active }, { status: 502 })
      }
      const json = await r.json().catch(() => ({}))

      await sb.from('store_share_tokens')
        .update({ last_sent_at: new Date().toISOString(), last_sent_to: recipient })
        .eq('id', active.id)

      return NextResponse.json({ ok: true, token: active, sentTo: recipient, messageId: (json as any)?.id })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 })
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
