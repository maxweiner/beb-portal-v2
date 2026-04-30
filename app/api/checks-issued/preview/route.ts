// GET /api/checks-issued/preview?event_id=X[&check_number=...][&amount=...][&print=1]
//
// Returns the checks-issued report as a full standalone HTML document so it
// can be embedded in an iframe (live preview) or opened in a new window for
// browser print → Save as PDF (?print=1 injects window.print() on load).

import { createClient } from '@supabase/supabase-js'
import { buildChecksIssued } from '@/lib/reports/checksIssued'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const eventId = url.searchParams.get('event_id') || ''
  const checkNumber = url.searchParams.get('check_number') || ''
  const amount = url.searchParams.get('amount') || ''
  const print = url.searchParams.get('print') === '1'

  if (!eventId) {
    return new Response(`<p>Missing event_id parameter.</p>`, {
      status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }

  const sb = admin()
  const { data: tpl } = await sb.from('report_templates')
    .select('subject, header_subtitle, footer')
    .eq('id', 'checks-issued').maybeSingle()

  const result = await buildChecksIssued({
    eventId,
    checkNumber,
    amount,
    templateSubject: tpl?.subject ?? undefined,
    templateHeaderSubtitle: tpl?.header_subtitle ?? undefined,
    templateFooter: tpl?.footer ?? undefined,
  })

  let html = result.html
  if (print) {
    const script = `<script>window.addEventListener('load', () => setTimeout(() => window.print(), 250))</script>`
    html = html.replace('</body>', `${script}</body>`)
  }

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
