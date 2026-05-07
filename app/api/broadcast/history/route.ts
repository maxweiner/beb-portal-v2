// GET /api/broadcast/history
//
// Lists past broadcasts for the history view. Each row includes
// rolled-up engagement stats (sent / opened / clicked).

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

export async function GET(req: Request) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = admin()
  const { data: caller } = await sb.from('users').select('role, is_partner').eq('id', me.id).maybeSingle()
  const allowed = caller?.role === 'admin' || caller?.role === 'superadmin' || !!caller?.is_partner
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: rows, error } = await sb
    .from('broadcasts')
    .select(`
      id, sender_id, brand, subject, scope_kind, scope_role, scope_user_ids,
      show_in_app, recipient_count, sent_at,
      sender:users!broadcasts_sender_id_fkey(name)
    `)
    .order('sent_at', { ascending: false })
    .limit(100)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Aggregate engagement stats per broadcast.
  const ids = (rows || []).map((r: any) => r.id)
  const stats = new Map<string, { sent: number; opened: number; clicked: number; failed: number }>()
  if (ids.length > 0) {
    const { data: recs } = await sb
      .from('broadcast_recipients')
      .select('broadcast_id, status, opened_at, clicked_at')
      .in('broadcast_id', ids)
    for (const r of (recs || []) as any[]) {
      const cur = stats.get(r.broadcast_id) || { sent: 0, opened: 0, clicked: 0, failed: 0 }
      if (r.status === 'sent' || r.status === 'bounced' || r.status === 'complained') cur.sent++
      if (r.status === 'failed') cur.failed++
      if (r.opened_at)  cur.opened++
      if (r.clicked_at) cur.clicked++
      stats.set(r.broadcast_id, cur)
    }
  }

  const out = (rows || []).map((r: any) => ({
    ...r,
    sender_name: r.sender?.name || '(unknown)',
    stats: stats.get(r.id) || { sent: 0, opened: 0, clicked: 0, failed: 0 },
  }))
  return NextResponse.json({ broadcasts: out })
}
