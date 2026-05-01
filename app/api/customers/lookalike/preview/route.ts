// POST /api/customers/lookalike/preview
//
// Body: ExportFilters describing the source segment.
// Returns: { signature, lookalikeCount }.
// Admin-only. Read-only.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser, isAdminLike } from '@/lib/expenses/serverAuth'
import { runLookalike } from '@/lib/customers/lookalike'
import type { ExportFilters } from '@/lib/customers/exportFilters'

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
  if (!isAdminLike(me)) return NextResponse.json({ error: 'Admin required' }, { status: 403 })

  let body: ExportFilters
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (!body?.storeId) return NextResponse.json({ error: 'storeId required' }, { status: 400 })

  try {
    const result = await runLookalike({ sb: admin(), sourceFilters: body, loadRows: false })
    return NextResponse.json({ ok: true, ...result })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Lookalike failed' }, { status: 500 })
  }
}
