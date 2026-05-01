// POST /api/customers/lookalike/run
//
// Body: ExportFilters (the source segment) + optional eventId,
// marketingCampaignId, mailingType.
// Returns: text/csv attachment.
// Side effect: inserts a customer_mailings row per recipient.
// Admin-only.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser, isAdminLike } from '@/lib/expenses/serverAuth'
import { runLookalike } from '@/lib/customers/lookalike'
import { POSTCARD_CSV_COLUMNS, type ExportFilters } from '@/lib/customers/exportFilters'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

interface Body extends ExportFilters {
  eventId?: string | null
  marketingCampaignId?: string | null
  mailingType?: 'postcard' | 'vdp' | 'other'
}

function csvEscape(v: unknown): string {
  if (v == null) return ''
  const s = String(v)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export async function POST(req: Request) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAdminLike(me)) return NextResponse.json({ error: 'Admin required' }, { status: 403 })

  let body: Body
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (!body?.storeId) return NextResponse.json({ error: 'storeId required' }, { status: 400 })

  const sb = admin()
  let result
  try {
    result = await runLookalike({ sb, sourceFilters: body, loadRows: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Lookalike failed' }, { status: 500 })
  }
  const rows = result.rows ?? []
  if (rows.length === 0) {
    return NextResponse.json({ error: 'No lookalike candidates match.' }, { status: 400 })
  }

  // Log mailings
  const mailingType = body.mailingType ?? 'postcard'
  const mailings = rows.map(r => ({
    customer_id: r.id as string,
    event_id: body.eventId ?? null,
    marketing_campaign_id: body.marketingCampaignId ?? null,
    mailed_at: new Date().toISOString(),
    mailing_type: mailingType,
  }))
  const BATCH = 1000
  for (let i = 0; i < mailings.length; i += BATCH) {
    const slice = mailings.slice(i, i + BATCH)
    const { error } = await sb.from('customer_mailings').insert(slice)
    if (error) return NextResponse.json({ error: `Mailing log insert failed: ${error.message}` }, { status: 500 })
  }

  const lines = [
    POSTCARD_CSV_COLUMNS.join(','),
    ...rows.map(r => POSTCARD_CSV_COLUMNS.map(col => csvEscape(r[col])).join(',')),
  ]
  const csv = lines.join('\n') + '\n'

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="lookalike-export-${new Date().toISOString().slice(0, 10)}.csv"`,
      'X-Exported-Count': String(rows.length),
    },
  })
}
