import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendDailyBriefing, fetchLegacyRecipients, type Brand } from '@/lib/reports/dailyBriefing'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

// Cron previously fired GET on this path. The cron now lives at
// /api/cron/process-scheduled-reports — this GET stays for backward
// compat / manual triggering with the same semantics (per-brand,
// recipients from legacy notify_* columns).

export async function GET(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret') || request.nextUrl.searchParams.get('secret')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const brandParam = request.nextUrl.searchParams.get('brand') as Brand | null
    const brands: Brand[] = brandParam === 'beb' || brandParam === 'liberty' ? [brandParam] : ['beb', 'liberty']

    const results = []
    for (const brand of brands) {
      const recipients = await fetchLegacyRecipients(brand)
      results.push(await sendDailyBriefing({ brand, recipients }))
    }
    return NextResponse.json({ ok: true, results })
  } catch (err: any) {
    console.error('daily-report GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// Manual send path used by Reports → Daily Briefing → Send. Body shape
// matches the rest of the report-tile send buttons: { to: [user_id, ...] }.
// Brand defaults to 'beb' but can be overridden via ?brand=liberty.

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as { to?: string[] }
    const userIds = (body.to || []).filter(s => typeof s === 'string')
    if (userIds.length === 0) {
      return NextResponse.json({ error: 'No recipients selected' }, { status: 400 })
    }

    const brandParam = request.nextUrl.searchParams.get('brand') as Brand | null
    const brand: Brand = brandParam === 'liberty' ? 'liberty' : 'beb'

    const { data: userRows } = await sb.from('users')
      .select('email, alternate_emails')
      .in('id', userIds)
    const recipients: string[] = []
    for (const u of (userRows || []) as { email?: string; alternate_emails?: string[] }[]) {
      if (u.email) recipients.push(u.email)
      if (u.alternate_emails) recipients.push(...u.alternate_emails)
    }
    if (recipients.length === 0) {
      return NextResponse.json({ error: 'No valid emails for selected users' }, { status: 400 })
    }

    // Pull the editable template overrides for this brand
    const { data: tpl } = await sb.from('report_templates')
      .select('subject, greeting, header_subtitle, footer')
      .eq('id', 'daily-briefing')
      .maybeSingle()

    const result = await sendDailyBriefing({
      brand,
      recipients,
      template: tpl as any,
    })
    return NextResponse.json({ ok: true, sent: result.sent ?? 0, ...result })
  } catch (err: any) {
    console.error('daily-report POST error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
