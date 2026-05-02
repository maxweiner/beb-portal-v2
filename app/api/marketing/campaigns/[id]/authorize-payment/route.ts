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
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomBytes } from 'crypto'
import { sendEmail } from '@/lib/email'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { blockIfImpersonating } from '@/lib/impersonation/server'
import { fmtDateRange, appBaseUrl, escapeHtml } from '@/lib/marketing/notify'

export const dynamic = 'force-dynamic'

const MAGIC_LINK_TTL_DAYS = 30

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

  // Notify the Marketing Team that the card is authorized — go run it.
  // Best-effort: failure here doesn't fail the API call (the
  // authorization itself succeeded; team can also see the change in-app).
  let teamNotify = { sent: 0, failed: 0 }
  try {
    teamNotify = await notifyTeamPaymentAuthorized(sb, {
      campaignId: campaign.id,
      approverName: me.name,
      cardLabel: label,
      note,
    })
  } catch { /* swallow */ }

  return NextResponse.json({
    ok: true, label, note,
    team_notified: teamNotify.sent,
    team_notify_failed: teamNotify.failed,
  })
}

/**
 * Email every active Marketing Team recipient that the approver has
 * authorized payment with a specific card. Each recipient gets a
 * magic-link token (reusing their existing one for this campaign if
 * still valid; minting fresh otherwise) so they can land directly in
 * the campaign view to run the charge + Mark as Paid.
 */
async function notifyTeamPaymentAuthorized(sb: SupabaseClient, opts: {
  campaignId: string
  approverName: string
  cardLabel: string
  note: string | null
}): Promise<{ sent: number; failed: number }> {
  // Pull recipients
  const { data: teamEmails } = await sb.from('marketing_team_emails')
    .select('email, name').eq('is_active', true)
  const recipients = ((teamEmails ?? []) as { email: string; name: string | null }[])
    .filter(r => typeof r.email === 'string' && r.email.includes('@'))
  if (recipients.length === 0) return { sent: 0, failed: 0 }

  // Pull campaign + event for context lines
  const { data: campaign } = await sb.from('marketing_campaigns')
    .select('event_id, flow_type, marketing_budget')
    .eq('id', opts.campaignId).maybeSingle()
  const { data: event } = campaign?.event_id
    ? await sb.from('events').select('store_id, store_name, start_date').eq('id', campaign.event_id).maybeSingle()
    : { data: null as any }
  const { data: store } = event?.store_id
    ? await sb.from('stores').select('name').eq('id', event.store_id).maybeSingle()
    : { data: null as any }

  const storeName = store?.name || event?.store_name || '(unknown store)'
  const dateRange = event?.start_date ? fmtDateRange(event.start_date) : ''
  const budget = Number(campaign?.marketing_budget || 0).toLocaleString('en-US', {
    minimumFractionDigits: 0, maximumFractionDigits: 2,
  })
  const subject = `Payment authorized for ${storeName} — run the card`
  const baseUrl = appBaseUrl()
  const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()

  let sent = 0, failed = 0
  for (const r of recipients) {
    // Reuse existing valid token if any; mint fresh otherwise.
    let token: string | null = null
    const { data: existing } = await sb.from('magic_link_tokens')
      .select('token, expires_at')
      .eq('campaign_id', opts.campaignId).eq('email', r.email)
      .order('expires_at', { ascending: false }).limit(1).maybeSingle()
    if (existing?.token && existing.expires_at && new Date(existing.expires_at).getTime() > Date.now()) {
      token = existing.token
    } else {
      const fresh = randomBytes(32).toString('hex')
      const { error: tokErr } = await sb.from('magic_link_tokens').insert({
        campaign_id: opts.campaignId, email: r.email, token: fresh, expires_at: expiresAt,
      })
      if (tokErr) { failed++; continue }
      token = fresh
    }

    const magicLinkUrl = `${baseUrl}/marketing/${token}`
    const html = renderPaymentAuthorizedEmail({
      recipientName: r.name || '',
      approverName: opts.approverName,
      storeName,
      dateRange,
      cardLabel: opts.cardLabel,
      budgetAmount: budget,
      note: opts.note,
      magicLinkUrl,
    })
    try {
      await sendEmail({ to: r.email, subject, html })
      sent++
    } catch { failed++ }
  }
  return { sent, failed }
}

function renderPaymentAuthorizedEmail(opts: {
  recipientName: string
  approverName: string
  storeName: string
  dateRange: string
  cardLabel: string
  budgetAmount: string
  note: string | null
  magicLinkUrl: string
}): string {
  const greeting = opts.recipientName ? `Hi ${opts.recipientName},` : 'Hi team,'
  const noteLine = opts.note
    ? `<p style="margin: 12px 0; padding: 10px 14px; background: #f5f0e8; border-left: 3px solid #2D3B2D; border-radius: 4px; color: #333; font-style: italic;">"${escapeHtml(opts.note)}" — ${escapeHtml(opts.approverName)}</p>`
    : ''
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; background: #f5f0e8; padding: 20px;">
      <div style="background: #2D3B2D; padding: 24px; border-radius: 8px 8px 0 0; color: #fff;">
        <div style="color: #7EC8A0; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 4px;">
          Beneficial Estate Buyers · Marketing
        </div>
        <div style="font-size: 20px; font-weight: 900;">💳 Payment authorized — run the card</div>
        <div style="font-size: 13px; color: rgba(255,255,255,.6); margin-top: 4px;">${escapeHtml(opts.storeName)} · ${escapeHtml(opts.dateRange)}</div>
      </div>
      <div style="background: #fff; padding: 24px; border: 1px solid #e8e0d0; border-top: none; font-size: 14px; color: #333; line-height: 1.6;">
        <div>${escapeHtml(greeting)}</div>
        <p>${escapeHtml(opts.approverName)} authorized payment via <strong>${escapeHtml(opts.cardLabel)}</strong>. Go ahead and charge <strong>$${escapeHtml(opts.budgetAmount)}</strong>, then come back and tap <strong>Mark as Paid</strong> so we can close out this campaign.</p>
        ${noteLine}
        <div style="text-align: center; margin: 24px 0;">
          <a href="${opts.magicLinkUrl}" style="display: inline-block; padding: 14px 32px; background: #2D3B2D; color: #fff; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
            Open Campaign →
          </a>
        </div>
        <p style="color: #888; font-size: 12px; text-align: center; margin: 0;">${escapeHtml(opts.magicLinkUrl)}</p>
      </div>
      <div style="background: #fff; padding: 14px 28px; border: 1px solid #e8e0d0; border-top: none; border-radius: 0 0 8px 8px; text-align: center; font-size: 12px; color: #a8a89a;">
        Beneficial Estate Buyers · Marketing
      </div>
    </div>
  `
}
