// POST /api/marketing/campaigns/[id]/review-planning
//
// Body: { decision: 'approve' | 'request_changes', comment?: string }
//
// Approver-only (must be in marketing_approvers AND have
// marketing_access). Single-approver quorum — first responder wins.
//
// approve → details.approved_at/_by set, campaign.status='proofing',
// sub_status='awaiting_proofs'.
//
// request_changes → details.last_review_comment(_at/_by) updated,
// campaign.sub_status='awaiting_planning_submission'. (Status stays
// 'planning' since the campaign hasn't moved forward.)

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
  // Caller must (a) have marketing_access AND (b) be an active approver.
  const { data: meRow } = await sb.from('users').select('marketing_access').eq('id', me.id).maybeSingle()
  if (!(meRow as any)?.marketing_access) {
    return NextResponse.json({ error: 'Marketing access required' }, { status: 403 })
  }
  const { data: approver } = await sb.from('marketing_approvers')
    .select('id, is_active').eq('user_id', me.id).maybeSingle()
  if (!approver || !approver.is_active) {
    return NextResponse.json({ error: 'Only active approvers can review planning.' }, { status: 403 })
  }

  let body: any
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const decision = (body?.decision || '').toString()
  const comment = (body?.comment ?? '').toString().trim() || null
  if (decision !== 'approve' && decision !== 'request_changes') {
    return NextResponse.json({ error: 'decision must be "approve" or "request_changes"' }, { status: 400 })
  }
  if (decision === 'request_changes' && !comment) {
    return NextResponse.json({ error: 'A comment is required when requesting changes.' }, { status: 400 })
  }

  const { data: campaign } = await sb.from('marketing_campaigns')
    .select('id, flow_type, status, sub_status').eq('id', params.id).maybeSingle()
  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
  if (campaign.status !== 'planning' || campaign.sub_status !== 'awaiting_planning_approval') {
    return NextResponse.json({ error: 'Campaign is not awaiting planning approval.' }, { status: 409 })
  }

  const detailsTable =
    campaign.flow_type === 'vdp'       ? 'vdp_campaign_details'
    : campaign.flow_type === 'postcard'  ? 'postcard_campaign_details'
    : campaign.flow_type === 'newspaper' ? 'newspaper_campaign_details'
    : null
  if (!detailsTable) {
    return NextResponse.json({ error: `Unsupported flow_type=${campaign.flow_type}` }, { status: 400 })
  }

  const nowIso = new Date().toISOString()

  if (decision === 'approve') {
    await sb.from(detailsTable).update({
      approved_at: nowIso,
      approved_by: me.id,
      last_review_comment: comment,
      last_review_comment_at: comment ? nowIso : null,
      last_review_by: comment ? me.id : null,
    }).eq('campaign_id', campaign.id)
    await sb.from('marketing_campaigns').update({
      status: 'proofing',
      sub_status: 'awaiting_proofs',
    }).eq('id', campaign.id)
    return NextResponse.json({ ok: true, decision })
  }

  // request_changes
  await sb.from(detailsTable).update({
    last_review_comment: comment,
    last_review_comment_at: nowIso,
    last_review_by: me.id,
  }).eq('campaign_id', campaign.id)
  await sb.from('marketing_campaigns').update({
    sub_status: 'awaiting_planning_submission',
  }).eq('id', campaign.id)
  return NextResponse.json({ ok: true, decision })
}
