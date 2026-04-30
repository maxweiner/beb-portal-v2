// POST /api/admin/invite-user
//
// Body: { email: string, name: string, role: Role }
//
// Admin-or-superadmin only. Creates a Supabase Auth user via the
// admin invite flow (Supabase sends the magic-link "set your
// password" email) AND upserts the public.users row with the
// requested name + role.
//
// Mirrors the marketing invite-partner route (which was the only
// existing email-sending invite path); generalizes it so every
// invite from Admin → Invite User triggers a real onboarding email.
//
// Notes:
// - 'superadmin' role can only be set by another superadmin
// - 'marketing' role auto-grants marketing_access=true (matches the
//   marketing-invite behavior)

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/expenses/serverAuth'

export const dynamic = 'force-dynamic'

const ALLOWED_ROLES = ['buyer', 'admin', 'superadmin', 'pending', 'marketing', 'accounting'] as const
type AllowedRole = typeof ALLOWED_ROLES[number]

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
  if (me.role !== 'admin' && me.role !== 'superadmin') {
    return NextResponse.json({ error: 'Admin required' }, { status: 403 })
  }

  let body: any
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const email = (body?.email || '').toString().trim().toLowerCase()
  const name  = (body?.name  || '').toString().trim()
  const role  = (body?.role  || 'buyer').toString() as AllowedRole

  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'Valid email required' }, { status: 400 })
  }
  if (!name) return NextResponse.json({ error: 'Name required' }, { status: 400 })
  if (!ALLOWED_ROLES.includes(role)) {
    return NextResponse.json({ error: `Unknown role: ${role}` }, { status: 400 })
  }
  if (role === 'superadmin' && me.role !== 'superadmin') {
    return NextResponse.json({ error: 'Only a superadmin can invite a superadmin.' }, { status: 403 })
  }

  const sb = admin()
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://beb-portal-v2.vercel.app'
  let alreadyExisted = false

  try {
    const { error } = await sb.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${baseUrl}/auth/callback`,
    })
    if (error) {
      if (/registered|exists/i.test(error.message)) alreadyExisted = true
      else return NextResponse.json({ error: error.message }, { status: 500 })
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Invite failed' }, { status: 500 })
  }

  // Upsert the public.users row by email so re-inviting an existing
  // address just updates the name + role rather than duplicating.
  const grantsMarketingAccess = role === 'marketing'
  const { data: existing } = await sb.from('users').select('id').eq('email', email).maybeSingle()

  const baseFields: Record<string, unknown> = {
    name, role, active: true,
    ...(grantsMarketingAccess ? { marketing_access: true } : {}),
  }

  if (existing) {
    await sb.from('users').update(baseFields).eq('id', existing.id)
  } else {
    await sb.from('users').insert({
      ...baseFields, email, notify: false, phone: '',
    })
  }

  return NextResponse.json({
    ok: true,
    invited: !alreadyExisted,
    upgraded: alreadyExisted,
    email, name, role,
  })
}
