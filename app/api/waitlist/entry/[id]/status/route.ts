// GET /api/waitlist/entry/[id]/status
//
// Public — no auth. Used by the customer-facing post-signup page
// to poll their queue position. Returns:
//
//   {
//     id, status,           // 'waiting' | 'called' | 'served' | 'no_show' | 'expired' | 'unknown'
//     position, total,      // 1-based position among 'waiting' rows; total queue size
//     queue: [              // every entry currently active, in arrival order
//       { id, displayName, isYou, status }
//     ],
//   }
//
// `displayName` for everyone EXCEPT the requester is obscured to
// "First L." (first name + last initial). The requester sees their
// own real name + "(you)".
//
// We accept the entry id directly in the URL — the id is a UUID,
// not guessable, and it's only revealed once at signup time, so
// it doubles as a soft access token. Anyone who has the id can see
// the queue for that event with peer names obscured. That's
// acceptable for this use case.

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

function obscure(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 0 || !parts[0]) return '—'
  if (parts.length === 1) return parts[0]
  const last = parts[parts.length - 1]
  return `${parts[0]} ${last[0].toUpperCase()}.`
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const sb = admin()

  const { data: me } = await sb
    .from('event_waitlist')
    .select('id, event_id, name, status, expires_at')
    .eq('id', params.id)
    .maybeSingle()
  if (!me) {
    return NextResponse.json({ status: 'unknown', error: 'Entry not found' }, { status: 404 })
  }

  // Expired? Past today's 7pm cutoff.
  if (new Date(me.expires_at) < new Date() && me.status === 'waiting') {
    return NextResponse.json({
      id: me.id, status: 'expired', position: null, total: 0, queue: [],
    })
  }

  // If they've already been served / no-shown, just report that.
  if (me.status === 'served' || me.status === 'no_show') {
    return NextResponse.json({
      id: me.id, status: me.status, position: null, total: 0, queue: [],
    })
  }

  // Pull the active queue for this event, in arrival order.
  const { data: queueRows } = await sb
    .from('event_waitlist')
    .select('id, name, status, created_at, expires_at')
    .eq('event_id', me.event_id)
    .gt('expires_at', new Date().toISOString())
    .in('status', ['waiting', 'called'])
    .order('created_at', { ascending: true })

  const queue = (queueRows || []).map(r => ({
    id: r.id,
    displayName: r.id === me.id ? `${r.name} (you)` : obscure(r.name),
    isYou: r.id === me.id,
    status: r.status as 'waiting' | 'called',
  }))

  // Position = 1-based rank among 'waiting' entries up to and
  // including this one. 'called' rows are special — they're ahead
  // of the line but not technically counted as a position.
  const waitingOnly = queue.filter(q => q.status === 'waiting')
  const myIdx = waitingOnly.findIndex(q => q.id === me.id)
  const position = myIdx >= 0 ? myIdx + 1 : null

  return NextResponse.json({
    id: me.id,
    status: me.status,
    position,
    total: waitingOnly.length,
    queue,
  })
}
