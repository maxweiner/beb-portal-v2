import { NextRequest, NextResponse } from 'next/server'
import { sendDailyBriefing, fetchLegacyRecipients, type Brand } from '@/lib/reports/dailyBriefing'

// Backward-compat endpoint: same URL the existing vercel.json cron hits.
// Recipient pool comes from the legacy users.notify_* columns until the
// dispatcher in /api/cron/process-scheduled-reports takes over (PR 3).

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
    console.error('daily-report error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
