// POST /api/marketing/campaigns/[id]/authorize-payment
//
// Approver picks the payment method label (existing or new). Sets the
// payment fields on the campaign + advances sub_status to
// awaiting_paid_mark. First responder wins (subsequent approvers see a
// 409).
//
// Body: { payment_method_label?: string (existing), new_label?: string,
//         note?: string }
//
// Auth: must be active marketing_approver AND have marketing_access.

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
  const { data: ap } = await sb.from('marketing_approvers')
    .select('is_active').eq('user_id', me.id).maybeSingle()
  if (!ap || !ap.is_active) {
    return NextResponse.json({ error: 'Only active approvers can authorize payment.' }, { status: 403 })
  }

  let body: any
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  let label: string = (body?.payment_method_label || '').toString().trim()
  const newLabel: string = (body?.new_label || '').toString().trim()
  const note: string | null = ((body?.note ?? '').toString().trim() || null)

  if (newLabel) {
    // Insert (or surface existing) label
    const { error: insErr } = await sb.from('marketing_payment_methods')
      .insert({ label: newLabel, created_by: me.id })
    if (insErr && !/duplicate key/i.test(insErr.message)) {
      return NextResponse.json({ error: insErr.message }, { status: 500 })
    }
    label = newLabel
  }

  if (!label) {
    return NextResponse.json({ error: 'Pick or add a payment method label.' }, { status: 400 })
  }

  // Verify the label exists + isn't archived (paranoia: client could
  // pass a stale value).
  const { data: pm } = await sb.from('marketing_payment_methods')
    .select('id, is_archived').eq('label', label).maybeSingle()
  if (!pm) return NextResponse.json({ error: `Unknown payment method "${label}"` }, { status: 400 })
  if (pm.is_archived) return NextResponse.json({ error: `Payment method "${label}" is archived.` }, { status: 400 })

  // Pre-condition + first-responder-wins guard.
  const { data: campaign } = await sb.from('marketing_campaigns')
    .select('id, status, sub_status').eq('id', params.id).maybeSingle()
  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
  if (campaign.status !== 'payment' || campaign.sub_status !== 'awaiting_payment_method') {
    return NextResponse.json({
      error: campaign.sub_status === 'awaiting_paid_mark'
        ? 'Already authorized — Collected has been notified.'
        : `Campaign is in ${campaign.status}/${campaign.sub_status} — payment not pending authorization.`,
    }, { status: 409 })
  }

  const nowIso = new Date().toISOString()
  await sb.from('marketing_campaigns').update({
    payment_method_label: label,
    payment_method_note: note,
    payment_authorized_by: me.id,
    payment_authorized_at: nowIso,
    sub_status: 'awaiting_paid_mark',
  }).eq('id', campaign.id)

  // Touch last_used_at on the payment method so the dropdown can sort
  // recently-used to the top later.
  await sb.from('marketing_payment_methods')
    .update({ last_used_at: nowIso }).eq('id', pm.id)

  return NextResponse.json({ ok: true, label, note })
}
