// POST /api/admin/users/[id]/change-email
//
// Updates a user's primary email. Superadmin-only.
//
// Two cases the endpoint handles:
//   1. User has auth_id (real login account) — update auth.users.email
//      via the admin SDK with email_confirm:true so they don't have to
//      click a verification link, then mirror the same email into
//      public.users.email.
//   2. User has no auth_id (legacy seed rows like the trunk-rep
//      backfill, which created placeholder @bebllp.local emails) —
//      just bump public.users.email. There is no auth row to keep
//      in sync.
//
// Validates: caller is superadmin; email is well-formed; the new
// email isn't already taken by another public.users row.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { blockIfImpersonating } from '@/lib/impersonation/server'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const blocked = await blockIfImpersonating(req)
  if (blocked) return blocked

  const sb = admin()
  const { data: caller } = await sb.from('users').select('role').eq('id', me.id).maybeSingle()
  if (caller?.role !== 'superadmin') {
    return NextResponse.json({ error: 'Superadmin only' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const newEmail = String(body?.email || '').trim().toLowerCase()
  if (!newEmail || !EMAIL_RE.test(newEmail)) {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400 })
  }

  const { data: target, error: lookupErr } = await sb
    .from('users')
    .select('id, auth_id, email, alternate_emails')
    .eq('id', params.id)
    .maybeSingle()
  if (lookupErr) return NextResponse.json({ error: lookupErr.message }, { status: 500 })
  if (!target)   return NextResponse.json({ error: 'User not found' }, { status: 404 })

  if ((target.email || '').toLowerCase() === newEmail) {
    return NextResponse.json({ ok: true, unchanged: true })
  }

  const { data: clash } = await sb
    .from('users')
    .select('id')
    .ilike('email', newEmail)
    .neq('id', params.id)
    .maybeSingle()
  if (clash) {
    return NextResponse.json({ error: 'Another user already has that email' }, { status: 409 })
  }

  if (target.auth_id) {
    const { error: authErr } = await sb.auth.admin.updateUserById(target.auth_id, {
      email: newEmail,
      email_confirm: true,
    })
    if (authErr) {
      return NextResponse.json({ error: `Auth update failed: ${authErr.message}` }, { status: 500 })
    }
  }

  const { error: pubErr } = await sb.from('users').update({ email: newEmail }).eq('id', params.id)
  if (pubErr) {
    return NextResponse.json({ error: `public.users update failed: ${pubErr.message}` }, { status: 500 })
  }

  return NextResponse.json({ ok: true, email: newEmail, had_auth: !!target.auth_id })
}
