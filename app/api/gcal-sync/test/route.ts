// POST /api/gcal-sync/test
// Body: { brand: 'beb' | 'liberty' }
//
// Loads the brand's calendar_id and runs testCalendarAccess (creates + deletes
// a tiny dummy event). Returns { ok, error }.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { testCalendarAccess } from '@/lib/gcal/client'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

export async function POST(req: Request) {
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const brand = body?.brand
  if (brand !== 'beb' && brand !== 'liberty') {
    return NextResponse.json({ error: 'brand must be beb or liberty' }, { status: 400 })
  }

  const sb = admin()
  const { data: settings } = await sb.from('gcal_integration_settings')
    .select('calendar_id').eq('brand', brand).maybeSingle()
  if (!settings?.calendar_id) {
    return NextResponse.json({ ok: false, error: 'No calendar_id configured for this brand' }, { status: 400 })
  }

  const result = await testCalendarAccess(settings.calendar_id)
  return NextResponse.json(result)
}
