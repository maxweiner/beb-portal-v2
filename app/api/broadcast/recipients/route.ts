// GET /api/broadcast/recipients
//   ?scope=all|role|individual
//   &role=<role-id>            (when scope=role)
//   &user_ids=<csv-uuids>      (when scope=individual)
//   &brand=beb|liberty
//
// Returns the resolved recipient list — { count, sample } — so the
// editor can display "32 BEB users will receive this." Always
// excludes inactive users + @placeholder.bebllp.local (legacy
// trunk-rep stubs that have no real address).

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/expenses/serverAuth'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

async function checkAuth(req: Request) {
  const me = await getAuthedUser(req)
  if (!me) return { ok: false as const, status: 401, error: 'Unauthorized' }
  const sb = admin()
  const { data: caller } = await sb.from('users').select('role, is_partner').eq('id', me.id).maybeSingle()
  const allowed = caller?.role === 'admin' || caller?.role === 'superadmin' || !!caller?.is_partner
  if (!allowed) return { ok: false as const, status: 403, error: 'Forbidden' }
  return { ok: true as const, sb, me }
}

export async function GET(req: Request) {
  const auth = await checkAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { sb } = auth

  const url = new URL(req.url)
  const scope = (url.searchParams.get('scope') || 'all') as 'all' | 'role' | 'individual'
  const role = url.searchParams.get('role') || ''
  const userIdsCsv = url.searchParams.get('user_ids') || ''
  const brand = (url.searchParams.get('brand') || 'beb') as 'beb' | 'liberty'

  // Brand scoping: BEB users = users where (liberty_access != true OR
  // they have at least one BEB role). Liberty users = users where
  // liberty_access = true. The portal already gates pages by brand
  // via the `brand` context, but for emailing we treat the brand
  // dropdown as authoritative — pick whoever the operator chose.
  let q = sb.from('users')
    .select('id, name, email, role, alternate_emails, active, liberty_access')
    .eq('active', true)

  if (brand === 'liberty') {
    q = q.eq('liberty_access', true)
  }
  // For 'beb' we keep all active users — Liberty access is additive,
  // BEB is the default workspace.

  if (scope === 'role') {
    if (!role) return NextResponse.json({ error: 'Missing role' }, { status: 400 })
    q = q.eq('role', role)
  } else if (scope === 'individual') {
    const ids = userIdsCsv.split(',').map(s => s.trim()).filter(Boolean)
    if (ids.length === 0) return NextResponse.json({ count: 0, sample: [] })
    q = q.in('id', ids)
  }

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const recipients = (data || [])
    .map((u: any) => ({
      id: u.id,
      name: u.name,
      email: (u.email || '').trim().toLowerCase(),
    }))
    .filter(r => r.email && r.email.includes('@') && !/placeholder\.bebllp\.local$/i.test(r.email))

  return NextResponse.json({
    count: recipients.length,
    sample: recipients.slice(0, 10),
    total: recipients.length,
  })
}
