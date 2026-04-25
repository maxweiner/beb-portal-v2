// GET /api/event-recap/preview?event_id=X[&print=1]
//
// Returns the recap as a full standalone HTML document so it can be embedded
// in an iframe (preview) or opened in a new window (print → Save as PDF).
// When ?print=1 is appended, the response includes a tiny script that auto-
// invokes window.print() on load — the user's browser then shows the native
// print dialog with "Save as PDF" available.

import { createClient } from '@supabase/supabase-js'
import { buildEventRecap } from '@/lib/reports/eventRecap'

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
  const print = url.searchParams.get('print') === '1'

  if (!eventId) {
    return new Response(`<p>Missing event_id parameter.</p>`, {
      status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }

  const sb = admin()
  const { data: tpl } = await sb.from('report_templates')
    .select('subject, greeting, header_subtitle, footer')
    .eq('id', 'event-recap').maybeSingle()

  const result = await buildEventRecap({
    eventId,
    templateSubject: tpl?.subject ?? undefined,
    templateGreeting: tpl?.greeting ?? undefined,
    templateHeaderSubtitle: tpl?.header_subtitle ?? undefined,
    templateFooter: tpl?.footer ?? undefined,
  })

  let html = result.html
  if (print) {
    // Inject a print-on-load script before </body>
    const script = `<script>window.addEventListener('load', () => setTimeout(() => window.print(), 250))</script>`
    html = html.replace('</body>', `${script}</body>`)
  }

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
