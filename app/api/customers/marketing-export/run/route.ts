// POST /api/customers/marketing-export/run
//
// Body: ExportFilters + { eventId?: string, marketingCampaignId?: string,
//                         mailingType?: 'postcard'|'vdp'|'other' }
//
// Returns the CSV (text/csv) directly so the browser saves it.
// Side effect: inserts a customer_mailings row per exported customer
// recording the event_id + marketing_campaign_id + mailed_at = now.
//
// Admin-only.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser, isAdminLike } from '@/lib/expenses/serverAuth'
import { runExportQuery } from '@/lib/customers/exportQuery'
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
  let result: { rows: Record<string, unknown>[]; count: number }
  try {
    result = await runExportQuery({
      sb, filters: body,
      selectCols: 'id, ' + POSTCARD_CSV_COLUMNS.join(', '),
      countOnly: false,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Query failed' }, { status: 500 })
  }

  if (result.rows.length === 0) {
    return NextResponse.json({ error: 'No customers match these filters.' }, { status: 400 })
  }

  // Insert customer_mailings rows (one per exported customer).
  const mailingType = body.mailingType ?? 'postcard'
  const mailings = result.rows.map(r => ({
    customer_id: r.id as string,
    event_id: body.eventId ?? null,
    marketing_campaign_id: body.marketingCampaignId ?? null,
    mailed_at: new Date().toISOString(),
    mailing_type: mailingType,
  }))
  // Batch insert to avoid hitting parameter limits on huge exports
  const BATCH = 1000
  for (let i = 0; i < mailings.length; i += BATCH) {
    const slice = mailings.slice(i, i + BATCH)
    const { error } = await sb.from('customer_mailings').insert(slice)
    if (error) return NextResponse.json({ error: `Mailing log insert failed: ${error.message}` }, { status: 500 })
  }

  // Build CSV: header + one row per customer
  const lines = [
    POSTCARD_CSV_COLUMNS.join(','),
    ...result.rows.map(r => POSTCARD_CSV_COLUMNS.map(col => csvEscape(r[col])).join(',')),
  ]
  const csv = lines.join('\n') + '\n'

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="customers-export-${new Date().toISOString().slice(0, 10)}.csv"`,
      'X-Exported-Count': String(result.rows.length),
    },
  })
}
