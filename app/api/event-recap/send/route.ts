// POST /api/event-recap/send
//
// Body: { event_id: string, to: string[] (user ids) }
//
// Builds the recap HTML for the picked event and sends it to each
// recipient via Resend.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email'
import { buildEventRecap } from '@/lib/reports/eventRecap'

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
  const { event_id, to } = body ?? {}
  if (!event_id) return NextResponse.json({ error: 'Missing event_id' }, { status: 400 })
  if (!Array.isArray(to) || to.length === 0) {
    return NextResponse.json({ error: 'No recipients' }, { status: 400 })
  }

  const sb = admin()

  // Resolve recipient emails from user ids
  const { data: users } = await sb.from('users').select('email').in('id', to)
  const emails = (users || []).map(u => u.email).filter((e: any): e is string => typeof e === 'string' && e.includes('@'))
  if (emails.length === 0) return NextResponse.json({ error: 'No valid recipient emails' }, { status: 400 })

  // Pull the editable template fields for the event-recap report
  const { data: tpl } = await sb.from('report_templates')
    .select('subject, greeting, header_subtitle, footer')
    .eq('id', 'event-recap').maybeSingle()

  const recap = await buildEventRecap({
    eventId: event_id,
    templateSubject: tpl?.subject ?? undefined,
    templateGreeting: tpl?.greeting ?? undefined,
    templateHeaderSubtitle: tpl?.header_subtitle ?? undefined,
    templateFooter: tpl?.footer ?? undefined,
  })
  if (!recap.found) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

  // The standalone HTML is print-styled. Strip the <html>/<body> wrapper and
  // send just the content so it nests cleanly in an email.
  const m = recap.html.match(/<div class="page">([\s\S]*?)<\/div>\s*<\/body>/)
  const innerHtml = m ? m[1] : recap.html

  let sent = 0
  let failed = 0
  for (const email of emails) {
    try {
      await sendEmail({
        to: email,
        subject: recap.subject,
        html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f0e8;padding:20px;">${innerHtml}</div>`,
      })
      sent++
    } catch (err: any) {
      console.error('event-recap send failed', email, err)
      failed++
    }
  }

  return NextResponse.json({ ok: true, sent, failed, recipients: emails.length })
}
