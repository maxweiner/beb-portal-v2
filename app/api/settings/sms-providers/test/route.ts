// POST /api/settings/sms-providers/test — fires a single SMS via the
// dispatcher so the operator can verify the active provider for either
// purpose slot. Same admin / superadmin / partner gate as the parent
// settings route.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { dispatchSms, type SmsPurpose } from '@/lib/sms/dispatch'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

export async function POST(req: Request) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const sb = admin()
  const { data: { user } } = await sb.auth.getUser(token)
  if (!user) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const { data: row } = await sb
    .from('users')
    .select('role, is_partner')
    .eq('auth_id', user.id)
    .maybeSingle()
  const allowed = row && (row.role === 'admin' || row.role === 'superadmin' || row.is_partner)
  if (!allowed) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }) }
  const to = String(body.to || '').trim()
  if (!to) return NextResponse.json({ error: 'to_required' }, { status: 400 })
  const purpose: SmsPurpose = body.purpose === 'marketing' ? 'marketing' : 'internal'
  const text = String(body.body || '✅ BEB Portal SMS test')

  const result = await dispatchSms({ sb, to, body: text, purpose })
  if (!result.ok) {
    return NextResponse.json({ error: result.error, provider: result.provider }, { status: 502 })
  }
  return NextResponse.json({ ok: true, provider: result.provider, sid: result.sid || null })
}
