// POST /api/trunk-shows/[id]/special-requests
//
// Inserts the special_request row + fans out email notifications
// to every active recipient in office_staff_notification_recipients.
// Service role for the table writes; uses the existing sendEmail
// helper from lib/email.ts. In-app notifications via the existing
// notification_templates / scheduled_notifications system are
// intentionally deferred — we'll add a new trigger_type in a
// follow-up if the email-only path proves insufficient.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { sendEmail } from '@/lib/email'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

function fmtRange(start: string, end: string): string {
  const s = new Date(start + 'T12:00:00')
  const e = new Date(end + 'T12:00:00')
  if (start === end) return s.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) {
    return `${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}–${e.getDate()}, ${e.getFullYear()}`
  }
  return `${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${e.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const text = (body?.request_text || '').toString().trim()
  if (!text) return NextResponse.json({ error: 'Missing request_text' }, { status: 400 })

  const sb = admin()

  // Confirm the trunk show exists + load context for the email.
  const { data: show } = await sb.from('trunk_shows')
    .select('id, store_id, start_date, end_date, assigned_rep_id')
    .eq('id', params.id).is('deleted_at', null).maybeSingle()
  if (!show) return NextResponse.json({ error: 'Trunk show not found' }, { status: 404 })

  const { data: store } = await sb.from('stores').select('name, city, state').eq('id', show.store_id).maybeSingle()
  const { data: rep }   = await sb.from('users').select('name, email').eq('id', show.assigned_rep_id).maybeSingle()

  // Insert request.
  const { data: created, error: insErr } = await sb
    .from('trunk_show_special_requests').insert({
      trunk_show_id: show.id,
      request_text: text,
      created_by: me.id,
      status: 'open',
    })
    .select('id, trunk_show_id, request_text, created_by, created_at, status, acknowledged_by, acknowledged_at')
    .single()
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })

  // Fan out to active recipients. Pull both user-linked (need to
  // resolve their email via public.users) and email-only rows.
  const { data: recipients } = await sb
    .from('office_staff_notification_recipients')
    .select('user_id, email, is_active')
    .eq('is_active', true)

  const userIds = (recipients || []).map(r => r.user_id).filter(Boolean) as string[]
  const userEmailMap = new Map<string, string>()
  if (userIds.length > 0) {
    const { data: us } = await sb.from('users').select('id, email').in('id', userIds)
    for (const u of (us || [])) if (u.id && u.email) userEmailMap.set(u.id as string, u.email as string)
  }
  const toAddrs = Array.from(new Set(
    (recipients || []).map(r => r.user_id ? userEmailMap.get(r.user_id) : r.email)
                       .filter(Boolean) as string[]
  ))

  // Best-effort: don't fail the request insert if emails throw.
  if (toAddrs.length > 0) {
    const repName  = (rep?.name || me.name || 'A trunk rep')
    const storeName = store?.name || 'a store'
    const dates = fmtRange(show.start_date, show.end_date)
    const subject = `Special request from ${repName} for ${storeName} trunk show (${dates})`
    const portalBase = process.env.NEXT_PUBLIC_APP_URL || 'https://beb-portal-v2.vercel.app'
    const html = `
      <p><strong>${repName}</strong> just added a special request for the
      <strong>${storeName}</strong> trunk show (${dates}):</p>
      <blockquote style="border-left: 3px solid #1d6b44; padding: 6px 12px; margin: 12px 0; color: #14532d;">
        ${escapeHtml(text)}
      </blockquote>
      <p>Open it in BEB Portal: <a href="${portalBase}">${portalBase}</a></p>
    `.trim()
    await Promise.allSettled(toAddrs.map(addr => sendEmail({ to: addr, subject, html })))
  }

  return NextResponse.json({ ok: true, request: created, notified: toAddrs.length })
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
