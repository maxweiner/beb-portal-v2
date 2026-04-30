// POST /api/marketing/campaigns/[id]/mark-paid
//
// Collected stamps the payment as completed. Locked to the approver-
// selected method — to switch cards, Collected must re-Request Payment
// and go through the approver flow again.
//
// Auth: marketing_access required. Pre-condition: sub_status =
// awaiting_paid_mark.
//
// On success: status='done', sub_status='complete', paid_at=now,
// paid_by=me. Phase 8 will hook in the accountant PDF + email.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/expenses/serverAuth'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = admin()
  const { data: meRow } = await sb.from('users').select('marketing_access').eq('id', me.id).maybeSingle()
  if (!(meRow as any)?.marketing_access) {
    return NextResponse.json({ error: 'Marketing access required' }, { status: 403 })
  }

  const { data: campaign } = await sb.from('marketing_campaigns')
    .select('id, status, sub_status, payment_method_label').eq('id', params.id).maybeSingle()
  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
  if (campaign.status !== 'payment' || campaign.sub_status !== 'awaiting_paid_mark') {
    return NextResponse.json({
      error: `Campaign is in ${campaign.status}/${campaign.sub_status} — Mark as Paid not allowed here.`,
    }, { status: 409 })
  }
  if (!campaign.payment_method_label) {
    return NextResponse.json({ error: 'No payment method authorized — Request Payment first.' }, { status: 400 })
  }

  await sb.from('marketing_campaigns').update({
    status: 'done',
    sub_status: 'complete',
    paid_at: new Date().toISOString(),
    paid_by: me.id,
  }).eq('id', campaign.id)

  return NextResponse.json({ ok: true })
}
