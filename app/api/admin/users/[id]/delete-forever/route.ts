// POST /api/admin/users/[id]/delete-forever
//
// Hard-deletes a user from public.users AND auth.users. Existing
// FKs in the public schema cascade or null per the existing
// schema definition. This is destructive; the gate below is
// intentionally narrow.
//
// Auth: caller MUST be either max@bebllp.com OR max.weiner@gmail.com
// (case-insensitive). Anyone else — including other superadmins —
// gets 403. The hardcoded list lives here as a single tight check;
// do NOT loosen to "superadmin" without an explicit ask.
//
// Refuses to delete:
//   - Yourself (you'd lock yourself out mid-request)
//   - The "other" allowed email (so neither Max can wipe the other
//     by accident)
//
// Body: { confirm: string } — must equal the target user's name
// or email exactly. Belt-and-suspenders against accidental fires.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { blockIfImpersonating } from '@/lib/impersonation/server'

export const dynamic = 'force-dynamic'

const ALLOWED_DELETERS = new Set([
  'max@bebllp.com',
  'max.weiner@gmail.com',
])

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!me.email || !ALLOWED_DELETERS.has(me.email.toLowerCase())) {
    return NextResponse.json({ error: 'Not authorized to permanently delete users' }, { status: 403 })
  }

  const blocked = await blockIfImpersonating(req)
  if (blocked) return blocked

  if (params.id === me.id) {
    return NextResponse.json({ error: "You can't delete yourself" }, { status: 400 })
  }

  const sb = admin()
  const { data: target, error: lookupErr } = await sb
    .from('users')
    .select('id, auth_id, name, email')
    .eq('id', params.id)
    .maybeSingle()
  if (lookupErr) return NextResponse.json({ error: lookupErr.message }, { status: 500 })
  if (!target)   return NextResponse.json({ error: 'User not found' }, { status: 404 })

  if (target.email && ALLOWED_DELETERS.has(target.email.toLowerCase())) {
    return NextResponse.json({
      error: 'This account is one of the two designated deleters and can\'t be hard-deleted from the UI.',
    }, { status: 400 })
  }

  // Belt-and-suspenders confirm: client must echo back the name
  // or email of the target user. Stops fat-finger fires.
  const body = await req.json().catch(() => ({}))
  const confirm = String(body?.confirm || '').trim()
  const expected = [target.name, target.email].filter(Boolean) as string[]
  const match = expected.some(s => s.toLowerCase() === confirm.toLowerCase())
  if (!match) {
    return NextResponse.json({
      error: `Type the user's name (${target.name || '—'}) or email (${target.email}) to confirm.`,
    }, { status: 400 })
  }

  // Delete the auth row first — irreversible. The DB-level FKs
  // on auth.users → public.users cascade to remove the public
  // row too. If for some reason the public row outlives, drop
  // it explicitly below.
  //
  // "Already gone" is treated as success — happens when a prior
  // delete killed the auth row but the public row got stuck on a
  // FK violation, leaving the user half-deleted. A retry would
  // otherwise abort here even though the auth side is done.
  if (target.auth_id) {
    const { error } = await sb.auth.admin.deleteUser(target.auth_id)
    if (error && !/not found|user.?not.?found|invalid user id/i.test(error.message)) {
      return NextResponse.json({ error: `Auth delete failed: ${error.message}` }, { status: 500 })
    }
  }

  // Defensive: if the public row is still around (unusual), drop it.
  const { data: stillThere } = await sb.from('users').select('id').eq('id', params.id).maybeSingle()
  if (stillThere) {
    const { error } = await sb.from('users').delete().eq('id', params.id)
    if (error) {
      return NextResponse.json({
        error: `Auth row deleted but public.users delete failed: ${error.message}`,
      }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true, deleted: { id: target.id, email: target.email, name: target.name } })
}
