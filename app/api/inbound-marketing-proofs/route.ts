// POST /api/inbound-marketing-proofs
//
// Postmark inbound webhook for proof approval-by-reply. The notify-
// proof email is sent with `Reply-To: proof-{proof_id}@updates.bebllp.com`
// so the To address on the inbound webhook payload encodes which
// proof this reply belongs to.
//
// Behavior:
//   - Verify Postmark webhook secret (settings key 'postmark_webhook_secret')
//   - Extract proof_id from the To address (proof-{uuid}@…)
//   - Identify the sender by email; must be an active marketing_approver
//   - If the body / subject matches /^\s*approved?\b/i (case-insens, first
//     non-quoted line), mark the proof approved + advance the campaign to
//     payment.
//   - Otherwise, capture the reply as a comment.
//
// Postmark inbound MX setup is operational (separate Postmark dashboard
// step); this route handles the parsed payload Postmark POSTs.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

function extractProofId(to: string): string | null {
  // Accept either `proof-{uuid}@whatever.com` or `Foo <proof-{uuid}@…>`
  const m = to.match(/proof-([0-9a-f-]{36})@/i)
  return m ? m[1] : null
}

function isApproveReply(text: string): boolean {
  // Inspect just the first ~5 non-empty lines that aren't quoted ('>').
  const lines = (text || '').split(/\r?\n/).map(l => l.trim())
  let count = 0
  for (const line of lines) {
    if (!line) continue
    if (line.startsWith('>') || line.startsWith('On ') && line.includes('wrote:')) continue
    count++
    if (count > 5) break
    if (/^approve(d)?[!.\s]*$/i.test(line)) return true
  }
  return false
}

export async function POST(req: NextRequest) {
  const sb = admin()

  // Optional shared secret check via settings key. Postmark can be
  // configured to include x-postmark-secret on inbound webhooks via
  // the dashboard; if you don't set it, this defaults to allow.
  const { data: secretRow } = await sb.from('settings').select('value').eq('key', 'postmark_webhook_secret').maybeSingle()
  const expected = ((secretRow as any)?.value as string | undefined)?.replace(/^"|"$/g, '')
  if (expected) {
    const got = req.headers.get('x-postmark-secret') || ''
    if (got !== expected) {
      return NextResponse.json({ error: 'Bad webhook secret' }, { status: 401 })
    }
  }

  let payload: any
  try { payload = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  // Postmark fields: ToFull[] | To, FromFull | From, Subject,
  // TextBody, StrippedTextReply.
  const toRaw: string = payload?.OriginalRecipient || payload?.To
    || (Array.isArray(payload?.ToFull) ? payload.ToFull.map((t: any) => t.Email).join(',') : '')
  const fromEmail: string = (payload?.FromFull?.Email || payload?.From || '').trim().toLowerCase()
  const subject: string = payload?.Subject || ''
  const text: string = payload?.StrippedTextReply || payload?.TextBody || ''

  const proofId = extractProofId(toRaw || '')
  if (!proofId) {
    return NextResponse.json({ ignored: true, reason: 'No proof id in To address' })
  }
  if (!fromEmail) {
    return NextResponse.json({ ignored: true, reason: 'No From email' })
  }

  // Look up sender → must be an active approver
  const { data: senderUser } = await sb.from('users')
    .select('id, name, marketing_access').eq('email', fromEmail).maybeSingle()
  if (!senderUser?.id) {
    return NextResponse.json({ ignored: true, reason: 'Sender not in users table' })
  }
  const { data: approver } = await sb.from('marketing_approvers')
    .select('is_active').eq('user_id', senderUser.id).maybeSingle()
  const isApprover = !!approver?.is_active

  // Resolve proof + campaign
  const { data: proof } = await sb.from('marketing_proofs')
    .select('id, campaign_id, status').eq('id', proofId).maybeSingle()
  if (!proof) {
    return NextResponse.json({ ignored: true, reason: 'Proof not found' })
  }

  const wantsApprove = isApprover && (isApproveReply(subject) || isApproveReply(text))
  const nowIso = new Date().toISOString()

  if (wantsApprove && proof.status !== 'approved') {
    await sb.from('marketing_proofs').update({
      status: 'approved',
      approved_by: senderUser.id,
      approved_at: nowIso,
    }).eq('id', proof.id)
    await sb.from('marketing_campaigns').update({
      status: 'payment',
      sub_status: 'awaiting_payment_request',
    }).eq('id', proof.campaign_id)
    // Also drop a comment row so the audit trail records the email.
    await sb.from('marketing_proof_comments').insert({
      proof_id: proof.id,
      commenter_id: senderUser.id,
      commenter_name: (senderUser as any).name,
      comment: `(approved via email) ${text.slice(0, 500)}`,
    })
    return NextResponse.json({ ok: true, action: 'approved' })
  }

  // Otherwise capture the body as a comment (any sender — even non-
  // approvers — can leave a comment via reply).
  if (text.trim()) {
    await sb.from('marketing_proof_comments').insert({
      proof_id: proof.id,
      commenter_id: senderUser.id,
      commenter_name: (senderUser as any).name,
      comment: text.slice(0, 4000),
    })
    return NextResponse.json({ ok: true, action: 'commented' })
  }

  return NextResponse.json({ ignored: true, reason: 'Empty body and not an approve reply' })
}
