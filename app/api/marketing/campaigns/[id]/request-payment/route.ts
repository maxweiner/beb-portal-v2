// POST /api/marketing/campaigns/[id]/request-payment
//
// Collected requests payment authorization. Clears any prior auth
// (lock-on-decline reset) and notifies all approvers.
//
// Auth: marketing_access required.
// Pre-condition: campaign.status = 'payment' (proof was approved).

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { resolveMarketingActor } from '@/lib/marketing/auth'
import { notifyApprovers, fmtDateRange, appBaseUrl } from '@/lib/marketing/notify'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const sb = admin()

  const auth = await resolveMarketingActor(req, params.id)
  if (auth.reason) {
    const status = auth.reason === 'no_auth' ? 401 : 403
    return NextResponse.json({ error: auth.reason }, { status })
  }

  const { data: campaign } = await sb.from('marketing_campaigns')
    .select('id, event_id, flow_type, status, sub_status, marketing_budget')
    .eq('id', params.id).maybeSingle()
  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
  if (campaign.status !== 'payment') {
    return NextResponse.json({ error: `Campaign is in ${campaign.status} — cannot request payment.` }, { status: 409 })
  }

  // Clear any prior authorization (lock-on-decline reset) and bump
  // sub_status back to awaiting_payment_method.
  await sb.from('marketing_campaigns').update({
    sub_status: 'awaiting_payment_method',
    payment_method_label: null,
    payment_method_note: null,
    payment_authorized_by: null,
    payment_authorized_at: null,
  }).eq('id', campaign.id)

  // Notify approvers
  const { data: event } = await sb.from('events')
    .select('store_id, store_name, start_date').eq('id', campaign.event_id).maybeSingle()
  const { data: store } = event?.store_id
    ? await sb.from('stores').select('name').eq('id', event.store_id).maybeSingle()
    : { data: null as any }
  const storeName = store?.name || event?.store_name || '(unknown store)'
  const dateRange = event?.start_date ? fmtDateRange(event.start_date) : ''
  const campaignUrl = `${appBaseUrl()}/?nav=marketing&campaign=${campaign.id}`
  const budget = Number(campaign.marketing_budget || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })

  const notify = await notifyApprovers({
    sb,
    templateId: 'marketing-approver-payment',
    vars: {
      store_name: storeName,
      date_range: dateRange,
      flow_type: campaign.flow_type,
      campaign_url: campaignUrl,
      budget_amount: budget,
    },
    ctaLabel: 'Authorize Payment',
  })

  return NextResponse.json({
    ok: true,
    notified: notify.sent,
    notify_failed: notify.failed,
    notify_errors: notify.errors.length > 0 ? notify.errors : undefined,
  })
}
