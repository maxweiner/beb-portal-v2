// POST /api/customers/marketing-export/preview
//
// Body: ExportFilters
// Returns: { count: number }
//
// Admin-only. Read-only — no writes, no mailings created.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser, isAdminLike } from '@/lib/expenses/serverAuth'
import { runExportQuery } from '@/lib/customers/exportQuery'
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
    const { count } = await runExportQuery({
      sb: admin(), filters: body, selectCols: 'id', countOnly: true,
    })
    return NextResponse.json({ ok: true, count })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Query failed' }, { status: 500 })
  }
}
