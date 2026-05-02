// POST /api/shipping/manifests/[mid]/sign
//
// Issues a 1-hour signed URL for a manifest photo. Mirrors the
// expense-receipt / expense-pdf pattern: server uses the service role
// (so the storage RLS doesn't have to thread Supabase Auth through
// every browser session), and gates on app-level auth — admin/super
// OR a worker on the parent event.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser, isAdminLike } from '@/lib/expenses/serverAuth'

export const dynamic = 'force-dynamic'

const BUCKET = 'manifests'
const TTL_SECONDS = 3600

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

export async function POST(req: Request, { params }: { params: { mid: string } }) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = admin()
  const { data: row, error } = await sb
    .from('shipping_manifests')
    .select('id, event_id, file_path, deleted_at')
    .eq('id', params.mid)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!row || row.deleted_at) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: event } = await sb
    .from('events')
    .select('id, workers')
    .eq('id', row.event_id)
    .maybeSingle()
  if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

  const isAdmin = isAdminLike(me)
  const workers = ((event as any).workers || []) as Array<{ id: string }>
  const isWorker = workers.some(w => w.id === me.id)
  if (!isAdmin && !isWorker) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data, error: signErr } = await sb.storage
    .from(BUCKET)
    .createSignedUrl(row.file_path, TTL_SECONDS)
  if (signErr || !data) {
    return NextResponse.json({ error: signErr?.message || 'Sign failed' }, { status: 500 })
  }
  return NextResponse.json({ signedUrl: data.signedUrl })
}
