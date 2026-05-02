// POST /api/marketing/proofs/[id]/review
//
// Body: { decision: 'approve' | 'comment', comment?: string }
//
// Approver-only.
//
// approve → marks proof status='approved', stamps approved_by/_at,
// advances campaign to status='payment' / sub_status='awaiting_payment_request'.
// Per spec: single approval is sufficient. First responder wins.
//
// comment → just appends a marketing_proof_comments row. The proof
// stays 'pending' until Collected uploads a revision (spec 5b).
// (We also support a 'request_revision' decision that explicitly
// marks the proof revision_requested, in case the UI wants to use it.)

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { blockIfImpersonating } from '@/lib/impersonation/server'

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

  const blocked = await blockIfImpersonating(req)
  if (blocked) return blocked

  const sb = admin()
  const { data: meRow } = await sb.from('users').select('marketing_access, name').eq('id', me.id).maybeSingle()
  if (!(meRow as any)?.marketing_access) {
    return NextResponse.json({ error: 'Marketing access required' }, { status: 403 })
  }

  let body: any
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const decision = (body?.decision || '').toString()
  const comment = (body?.comment ?? '').toString().trim() || null

  if (decision !== 'approve' && decision !== 'comment' && decision !== 'request_revision') {
    return NextResponse.json({ error: 'decision must be approve | comment | request_revision' }, { status: 400 })
  }

  const { data: proof } = await sb.from('marketing_proofs')
    .select('id, campaign_id, status, version_number').eq('id', params.id).maybeSingle()
  if (!proof) return NextResponse.json({ error: 'Proof not found' }, { status: 404 })

  // Approve / request_revision require approver privileges.
  if (decision === 'approve' || decision === 'request_revision') {
    const { data: ap } = await sb.from('marketing_approvers')
      .select('is_active').eq('user_id', me.id).maybeSingle()
    if (!ap || !ap.is_active) {
      return NextResponse.json({ error: 'Only active approvers can approve / request revisions.' }, { status: 403 })
    }
  }

  const nowIso = new Date().toISOString()

  // Always record a comment row when one was provided (so threads stay
  // contiguous regardless of the decision).
  if (comment) {
    await sb.from('marketing_proof_comments').insert({
      proof_id: proof.id,
      commenter_id: me.id,
      commenter_name: (meRow as any)?.name ?? null,
      comment,
    })
  }

  if (decision === 'approve') {
    if (proof.status === 'approved') {
      return NextResponse.json({ ok: true, alreadyApproved: true })
    }
    await sb.from('marketing_proofs').update({
      status: 'approved',
      approved_by: me.id,
      approved_at: nowIso,
    }).eq('id', proof.id)
    await sb.from('marketing_campaigns').update({
      status: 'payment',
      sub_status: 'awaiting_payment_request',
    }).eq('id', proof.campaign_id)
    return NextResponse.json({ ok: true, decision: 'approve' })
  }

  if (decision === 'request_revision') {
    if (!comment) {
      return NextResponse.json({ error: 'A comment is required when requesting a revision.' }, { status: 400 })
    }
    await sb.from('marketing_proofs').update({
      status: 'revision_requested',
    }).eq('id', proof.id)
    // Keep campaign in proofing; sub_status stays awaiting_proof_approval
    // until the next upload (which sets it again).
    return NextResponse.json({ ok: true, decision: 'request_revision' })
  }

  // comment-only — no proof status change
  return NextResponse.json({ ok: true, decision: 'comment', commented: !!comment })
}
