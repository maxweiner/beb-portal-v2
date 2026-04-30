// POST /api/marketing/users/invite-partner
//
// Body: { email: string, name: string }
//
// Superadmin-only. Creates a Supabase Auth user via the admin invite
// flow (sends a magic-link "set your password" email) AND ensures
// the public.users row has role='marketing', marketing_access
// = true, active=true. The two together = an external Collected
// account that only sees the Marketing module.

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

export async function POST(req: Request) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (me.role !== 'superadmin') {
    return NextResponse.json({ error: 'Superadmin required' }, { status: 403 })
  }

  let body: any
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const email = ((body?.email || '').toString().trim().toLowerCase())
  const name = ((body?.name || '').toString().trim())
  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'Valid email required' }, { status: 400 })
  }
  if (!name) {
    return NextResponse.json({ error: 'Name required' }, { status: 400 })
  }

  const sb = admin()

  // Send the Supabase invite. If the auth user already exists, fall
  // through and just upsert our public.users row.
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://beb-portal-v2.vercel.app'
  let alreadyExisted = false
  try {
    const { error } = await sb.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${baseUrl}/auth/callback`,
    })
    if (error) {
      // "User already registered" — non-fatal, we still want to flip
      // their role/flag.
      if (/registered|exists/i.test(error.message)) {
        alreadyExisted = true
      } else {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Invite failed' }, { status: 500 })
  }

  // Upsert the public.users row by email so a subsequent invite to the
  // same address doesn't duplicate. Mirrors the columns used elsewhere.
  const { data: existing } = await sb.from('users').select('id').eq('email', email).maybeSingle()
  if (existing) {
    await sb.from('users').update({
      name,
      role: 'marketing',
      marketing_access: true,
      active: true,
    }).eq('id', existing.id)
  } else {
    await sb.from('users').insert({
      email,
      name,
      role: 'marketing',
      marketing_access: true,
      active: true,
      // The auth_id link is established when the user actually signs up
      // via the magic link. The existing auth flow joins users via email.
    })
  }

  return NextResponse.json({
    ok: true,
    invited: !alreadyExisted,
    upgraded: alreadyExisted,
    email,
    name,
  })
}
