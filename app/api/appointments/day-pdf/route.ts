// GET /api/appointments/day-pdf?store_id=…&date=YYYY-MM-DD
//
// Streams the daily-appointments PDF. Used by the iframe preview in
// the modal and by the "⬇ Download" button (?download=1).

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { generateAppointmentsDayPdfBuffer } from '@/lib/appointments/generateAppointmentsDayPdf'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: Request) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const storeId = url.searchParams.get('store_id') || ''
  const date    = url.searchParams.get('date') || ''
  const download = url.searchParams.get('download') === '1'
  const includeCancelled = url.searchParams.get('include_cancelled') !== '0'

  if (!storeId) return NextResponse.json({ error: 'Missing store_id' }, { status: 400 })
  if (!DATE_RE.test(date)) return NextResponse.json({ error: 'Invalid or missing date (YYYY-MM-DD)' }, { status: 400 })

  const result = await generateAppointmentsDayPdfBuffer({ sb: admin(), storeId, date, includeCancelled })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  return new Response(result.buffer as any, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${result.filename}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
