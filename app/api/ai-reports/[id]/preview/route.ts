// Preview endpoint — runs the AI report against current data and
// returns the generated body/html WITHOUT emailing anyone. Used by
// the Reports tab editor to let the author see what an actual send
// would look like before saving the schedule.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { runReport } from '@/lib/ai-reports/runReport'
import type { AiReportRow } from '@/lib/ai-reports/types'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = req.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // Validate caller via their JWT (RLS will then gate the SELECT).
  const userClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: auth } } },
  )
  const { data: row, error } = await userClient
    .from('ai_reports')
    .select('*')
    .eq('id', params.id)
    .maybeSingle()
  if (error || !row) {
    return NextResponse.json({ error: 'not_found', detail: error?.message }, { status: 404 })
  }

  try {
    const { body, html, recipients } = await runReport(row as AiReportRow)
    return NextResponse.json({ body, html, recipientCount: recipients.length })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: 'run_failed', detail: msg.slice(0, 500) }, { status: 500 })
  }
}
