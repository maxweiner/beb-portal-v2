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
import { resolveMarketingActor } from '@/lib/marketing/auth'
import { blockIfImpersonating } from '@/lib/impersonation/server'
import { sendMarketingReceiptForCampaign } from '@/lib/marketing/sendAccountantReceipt'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

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
  const actor = auth.actor

  const blocked = await blockIfImpersonating(req)
  if (blocked) return blocked

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
    // Magic-link Mark as Paid leaves paid_by null — we know who from
    // the token's email (captured at notify-team time) but not a
    // canonical user_id. The PDF receipt uses displayName fallback.
    paid_by: actor.userId ?? null,
  }).eq('id', campaign.id)

  // Best-effort: generate the accountant PDF + email it. Failure
  // doesn't block the Mark as Paid action — the user can re-fire from
  // the Done card via /send-receipt.
  let receiptResult: any = null
  try {
    receiptResult = await sendMarketingReceiptForCampaign(params.id)
  } catch (err: any) {
    console.error('marketing accountant receipt failed', err)
    receiptResult = { ok: false, error: err?.message || 'unknown' }
  }

  return NextResponse.json({ ok: true, receipt: receiptResult })
}
