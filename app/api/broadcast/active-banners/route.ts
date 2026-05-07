// GET /api/broadcast/active-banners
//
// Returns broadcasts the calling user should still see in-app
// (show_in_app=true, sent in the last 30 days, the user was a
// recipient, and they haven't dismissed it).

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

const MAX_AGE_DAYS = 30

export async function GET(req: Request) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ banners: [] })

  const sb = admin()
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - MAX_AGE_DAYS)

  // Pull broadcasts I was a recipient of, with show_in_app=true,
  // less than MAX_AGE_DAYS old, where I haven't already dismissed.
  const { data: recs } = await sb
    .from('broadcast_recipients')
    .select(`
      broadcast_id,
      broadcast:broadcasts!inner(
        id, brand, subject, body_html, cta_label, cta_url,
        sent_at, show_in_app
      )
    `)
    .eq('user_id', me.id)
    .gte('broadcast.sent_at', cutoff.toISOString())
    .eq('broadcast.show_in_app', true)

  const broadcastIds = Array.from(new Set((recs || []).map((r: any) => r.broadcast_id)))
  if (broadcastIds.length === 0) return NextResponse.json({ banners: [] })

  const { data: dismissals } = await sb
    .from('broadcast_dismissals')
    .select('broadcast_id')
    .eq('user_id', me.id)
    .in('broadcast_id', broadcastIds)
  const dismissed = new Set((dismissals || []).map((d: any) => d.broadcast_id))

  const banners = (recs || [])
    .filter((r: any) => !dismissed.has(r.broadcast_id))
    .map((r: any) => r.broadcast)
    .sort((a: any, b: any) => (b.sent_at || '').localeCompare(a.sent_at || ''))

  // De-dupe in case Postgres returned the same broadcast twice (shouldn't, but be safe).
  const seen = new Set<string>()
  const uniq = banners.filter((b: any) => {
    if (seen.has(b.id)) return false
    seen.add(b.id); return true
  })

  return NextResponse.json({ banners: uniq })
}
