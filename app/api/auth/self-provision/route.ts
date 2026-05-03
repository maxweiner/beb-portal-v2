// POST /api/auth/self-provision
//
// Called by lib/context.tsx after a fresh sign-in if no public.users row
// exists for the auth.users email. Creates a row with role='pending' and
// active=false so the user lands on the Pending Approval screen instead
// of being silently bounced back to Login.
//
// The 'pending' role has no role_modules entries (see role-management
// migration), so even though the row exists, the user can't see any
// data until an admin promotes them to a real role + flips active=true.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export async function POST(req: Request) {
  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = admin()
  const { data: { user: authUser }, error: getUserErr } = await sb.auth.getUser(token)
  if (getUserErr || !authUser?.email) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
  }

  const email = authUser.email.toLowerCase()
  const auth_id = authUser.id

  // Case-insensitive primary OR alternate_emails match. Mirrors
  // lib/context.tsx so a user whose row stores mixed-case email,
  // or whose Google address is in alternate_emails, doesn't get
  // a duplicate pending stub created. Fetches with service-role
  // and filters in JS — the user count is small enough that the
  // round-trip cost beats fighting PostgREST's array-contains
  // syntax on a one-off lookup.
  const { data: allUsers } = await sb.from('users')
    .select('id, role, active, email, alternate_emails')
  const existing = (allUsers || []).find(u =>
    (u.email || '').toLowerCase() === email ||
    (u.alternate_emails || []).some((a: string) => (a || '').toLowerCase() === email)
  )
  if (existing) {
    return NextResponse.json({ ok: true, status: 'existing', userId: existing.id })
  }

  const meta = (authUser.user_metadata || {}) as Record<string, any>
  const defaultName = String(
    meta.full_name || meta.name || meta.preferred_username || email.split('@')[0]
  ).slice(0, 80)

  const { data: created, error: insertErr } = await sb.from('users').insert({
    auth_id,
    email,
    name: defaultName,
    role: 'pending',
    active: false,
    notify: false,
    phone: '',
  }).select('id').single()

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://portal.bebllp.com'
    await sendEmail({
      to: 'max@bebllp.com',
      subject: `[BEB Portal] New signup pending approval — ${email}`,
      html: `
        <p>A new user signed in to the BEB Portal and is awaiting approval:</p>
        <ul>
          <li><strong>Name:</strong> ${escapeHtml(defaultName)}</li>
          <li><strong>Email:</strong> ${escapeHtml(email)}</li>
        </ul>
        <p>To approve, open the <a href="${baseUrl}/">Admin Panel → Users &amp; Roles</a>, find the user (current role: <em>pending</em>), and:</p>
        <ol>
          <li>Change their role from <em>pending</em> to whatever fits.</li>
          <li>Toggle their account to <strong>Active</strong>.</li>
        </ol>
        <p>Until you do, they'll see a "pending approval" screen and have no data access.</p>
      `,
    })
  } catch { /* email failure shouldn't block signup */ }

  return NextResponse.json({ ok: true, status: 'created', userId: created.id })
}
