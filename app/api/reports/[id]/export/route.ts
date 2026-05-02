// GET /api/reports/[id]/export?format=xlsx&brand=beb
//
// Re-runs a custom report under the caller's auth and streams the rendered
// file back as a download. Currently supports format=xlsx; CSV continues
// to render client-side (no server roundtrip needed for that).

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { runReport } from '@/lib/reports/runQuery'
import { buildXlsx } from '@/lib/reports/excel'
import type { ReportConfig } from '@/lib/reports/schema'

export const dynamic = 'force-dynamic'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const auth = req.headers.get('authorization') || ''
  const m = auth.match(/^Bearer\s+(.+)$/i)
  if (!m) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const token = m[1]

  const url = new URL(req.url)
  const format = url.searchParams.get('format') || 'xlsx'
  if (format !== 'xlsx') {
    return NextResponse.json({ error: `Unsupported format: ${format}` }, { status: 400 })
  }
  const brand = url.searchParams.get('brand') === 'liberty' ? 'liberty' : 'beb'

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  )

  const { data: report, error: rErr } = await sb
    .from('custom_reports').select('id, name, source, config').eq('id', params.id).maybeSingle()
  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 })
  if (!report) return NextResponse.json({ error: 'Report not found or access denied' }, { status: 404 })

  const config = (report.config || {}) as ReportConfig
  const result = await runReport(report.source, config, brand, sb)
  if (result.error) return NextResponse.json({ error: `Run failed: ${result.error}` }, { status: 500 })

  const buf = await buildXlsx(report.source, config, result.rows, report.name)
  const slug = String(report.name || 'report').replace(/[^a-z0-9-_]+/gi, '_').slice(0, 60) || 'report'
  const filename = `${slug}_${new Date().toISOString().slice(0, 10)}.xlsx`

  // Buffer is a runtime-valid BodyInit in Node, but the strict TS lib
  // here narrows BodyInit to exclude SharedArrayBuffer-backed views.
  // Cast through unknown — bytes go through unchanged.
  return new Response(buf as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': XLSX_MIME,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buf.length),
      'Cache-Control': 'no-store',
    },
  })
}
