// GET /api/events/[id]/day-pdf/[day]
//
// Streams the buying-day PDF inline (so it loads in an <iframe>) for
// the preview modal. day=0 (or "recap") renders the full event recap
// instead of running totals through a specific day.
//
// Auth: any authenticated portal user. The PDF doesn't expose anything
// the user couldn't already see on the event page.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { generateDayPdfBuffer } from '@/lib/dayentry/generateDayPdf'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

export async function GET(req: Request, { params }: { params: { id: string; day: string } }) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const dayParam = params.day
  const throughDay = (dayParam === 'recap' || dayParam === '0') ? null : parseInt(dayParam, 10)
  if (throughDay !== null && (Number.isNaN(throughDay) || throughDay < 1)) {
    return NextResponse.json({ error: 'Invalid day' }, { status: 400 })
  }

  const url = new URL(req.url)
  const download = url.searchParams.get('download') === '1'

  const result = await generateDayPdfBuffer({ sb: admin(), eventId: params.id, throughDay })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return new Response(result.buffer as any, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${result.filename}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
