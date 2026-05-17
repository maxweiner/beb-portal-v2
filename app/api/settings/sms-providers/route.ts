// GET  /api/settings/sms-providers — read provider selection + creds
// PUT  /api/settings/sms-providers — update provider selection + creds
//
// Admin / superadmin / partner only. We never return Twilio authToken
// or Telnyx apiKey in plaintext — the response masks them to a
// "•••• last4" hint so the UI can show "set / not set" without leaking.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

function mask(v: string | undefined | null): string {
  if (!v) return ''
  if (v.length <= 4) return '••••'
  return `•••• ${v.slice(-4)}`
}

async function authorize(req: Request) {
  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) return null
  const sb = admin()
  const { data: { user } } = await sb.auth.getUser(token)
  if (!user) return null
  const { data: row } = await sb
    .from('users')
    .select('role, is_partner')
    .eq('auth_id', user.id)
    .maybeSingle()
  if (!row) return null
  const ok = row.role === 'admin' || row.role === 'superadmin' || row.is_partner
  return ok ? { sb, user } : null
}

export async function GET(req: Request) {
  const session = await authorize(req)
  if (!session) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const sb = session.sb

  const [providersRow, telnyxRow, twilioRow, smsRow] = await Promise.all([
    sb.from('settings').select('value').eq('key', 'sms_providers').maybeSingle(),
    sb.from('settings').select('value').eq('key', 'telnyx').maybeSingle(),
    sb.from('settings').select('value').eq('key', 'twilio').maybeSingle(),
    sb.from('settings').select('value').eq('key', 'sms').maybeSingle(),
  ])

  const providers: any = providersRow.data?.value || { internal: 'twilio', marketing: 'twilio' }
  const telnyx: any = telnyxRow.data?.value || {}
  const twilio: any = twilioRow.data?.value || smsRow.data?.value || {}

  return NextResponse.json({
    providers: {
      internal: providers.internal === 'telnyx' ? 'telnyx' : 'twilio',
      marketing: providers.marketing === 'telnyx' ? 'telnyx' : 'twilio',
    },
    telnyx: {
      apiKeyMasked: mask(telnyx.apiKey),
      apiKeySet: Boolean(telnyx.apiKey),
      publicKeyMasked: mask(telnyx.publicKey),
      publicKeySet: Boolean(telnyx.publicKey),
      fromNumber: telnyx.fromNumber || '',
      messagingProfileId: telnyx.messagingProfileId || '',
    },
    twilio: {
      accountSidMasked: mask(twilio.accountSid),
      accountSidSet: Boolean(twilio.accountSid),
      authTokenMasked: mask(twilio.authToken),
      authTokenSet: Boolean(twilio.authToken),
      fromNumber: twilio.fromNumber || '',
    },
  })
}

export async function PUT(req: Request) {
  const session = await authorize(req)
  if (!session) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const sb = session.sb

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }) }

  if (body.providers) {
    const internal = body.providers.internal === 'telnyx' ? 'telnyx' : 'twilio'
    const marketing = body.providers.marketing === 'telnyx' ? 'telnyx' : 'twilio'
    const { error } = await sb.from('settings').upsert(
      { key: 'sms_providers', value: { internal, marketing } },
      { onConflict: 'key' },
    )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (body.telnyx) {
    // Merge — never wipe a field by omission. Only set fields the
    // client actually sent. Empty string clears.
    const { data: existing } = await sb
      .from('settings').select('value').eq('key', 'telnyx').maybeSingle()
    const merged: any = { ...(existing?.value || {}) }
    for (const k of ['apiKey', 'publicKey', 'fromNumber', 'messagingProfileId']) {
      if (k in body.telnyx) merged[k] = body.telnyx[k] || ''
    }
    const { error } = await sb.from('settings').upsert(
      { key: 'telnyx', value: merged },
      { onConflict: 'key' },
    )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (body.twilio) {
    const { data: existing } = await sb
      .from('settings').select('value').eq('key', 'twilio').maybeSingle()
    const merged: any = { ...(existing?.value || {}) }
    for (const k of ['accountSid', 'authToken', 'fromNumber']) {
      if (k in body.twilio) merged[k] = body.twilio[k] || ''
    }
    const { error } = await sb.from('settings').upsert(
      { key: 'twilio', value: merged },
      { onConflict: 'key' },
    )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
