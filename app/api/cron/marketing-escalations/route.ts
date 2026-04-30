// Cron worker — daily marketing escalations.
//
// Walks marketing_campaigns in 4 stalled-state buckets:
//   1. planning_approval — sub_status=awaiting_planning_approval >24h
//   2. proof_approval    — sub_status=awaiting_proof_approval    >24h
//   3. payment_request   — sub_status=awaiting_payment_method    >24h
//   4. mark_paid         — sub_status=awaiting_paid_mark         >24h
//
// For each, re-notifies the relevant audience (approvers for 1-3,
// Collected via team_emails for 4) using the same templates the
// initial notifications use. Logs each escalation to
// marketing_escalations w/ a unique-per-day index — duplicate runs
// in the same UTC day are no-ops.
//
// Auth: ?secret=<CRON_SECRET> (matches the existing cron pattern in
// vercel.json).

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email'
import { notifyApprovers, fmtDateRange, appBaseUrl, renderApproverEmailHtml } from '@/lib/marketing/notify'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const STALL_HOURS = 24

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

interface CampaignRow {
  id: string
  event_id: string
  flow_type: string
  status: string
  sub_status: string | null
  marketing_budget: number | null
  payment_method_label: string | null
  team_notified_at: string | null
  updated_at: string
}

async function findStalled(sb: ReturnType<typeof admin>, subStatus: string): Promise<CampaignRow[]> {
  const cutoff = new Date(Date.now() - STALL_HOURS * 60 * 60 * 1000).toISOString()
  const { data } = await sb.from('marketing_campaigns')
    .select('id, event_id, flow_type, status, sub_status, marketing_budget, payment_method_label, team_notified_at, updated_at')
    .eq('sub_status', subStatus)
    .lte('updated_at', cutoff)
  return (data ?? []) as CampaignRow[]
}

async function alreadyEscalatedToday(sb: ReturnType<typeof admin>, campaignId: string, type: string): Promise<boolean> {
  const today = new Date().toISOString().slice(0, 10)
  const { count } = await sb.from('marketing_escalations')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .eq('escalation_type', type)
    .eq('escalated_day', today)
  return (count ?? 0) > 0
}

async function recordEscalation(sb: ReturnType<typeof admin>, campaignId: string, type: string) {
  // The unique index handles the dedup if a parallel run beats us.
  try {
    await sb.from('marketing_escalations').insert({
      campaign_id: campaignId, escalation_type: type,
    })
  } catch { /* swallow — duplicate or transient */ }
}

async function fetchCampaignContext(sb: ReturnType<typeof admin>, c: CampaignRow) {
  const { data: event } = await sb.from('events')
    .select('store_id, store_name, start_date').eq('id', c.event_id).maybeSingle()
  const { data: store } = event?.store_id
    ? await sb.from('stores').select('name').eq('id', event.store_id).maybeSingle()
    : { data: null as any }
  const storeName = store?.name || event?.store_name || '(unknown store)'
  const dateRange = event?.start_date ? fmtDateRange(event.start_date) : ''
  const campaignUrl = `${appBaseUrl()}/?nav=marketing&campaign=${c.id}`
  return { storeName, dateRange, campaignUrl }
}

async function escalateApprovers(sb: ReturnType<typeof admin>, c: CampaignRow, templateId: string, ctaLabel: string, type: string) {
  if (await alreadyEscalatedToday(sb, c.id, type)) return null
  const ctx = await fetchCampaignContext(sb, c)
  const result = await notifyApprovers({
    sb,
    templateId,
    vars: {
      store_name: ctx.storeName,
      date_range: ctx.dateRange,
      flow_type: c.flow_type,
      campaign_url: ctx.campaignUrl,
      budget_amount: Number(c.marketing_budget || 0).toLocaleString('en-US', { maximumFractionDigits: 2 }),
    },
    ctaLabel: `[Reminder] ${ctaLabel}`,
  })
  await recordEscalation(sb, c.id, type)
  return result
}

async function escalateCollected(sb: ReturnType<typeof admin>, c: CampaignRow) {
  // Mark-paid stall — Collected hasn't run the card yet. Notify the
  // marketing_team_emails list (Collected contacts) since there's no
  // single user to email.
  const type = 'mark_paid'
  if (await alreadyEscalatedToday(sb, c.id, type)) return null

  const { data: emails } = await sb.from('marketing_team_emails')
    .select('email').eq('is_active', true)
  const recipients = ((emails ?? []) as { email: string }[]).map(e => e.email).filter(Boolean)
  if (recipients.length === 0) return { sent: 0, failed: 0, errors: ['No team email recipients configured.'] }

  const ctx = await fetchCampaignContext(sb, c)

  // Reuse marketing-team-notification template structure with reminder
  // copy. Inline body — keeping this self-contained.
  const subject = `[Reminder] Mark as paid — ${ctx.storeName} (${ctx.dateRange})`
  const body = `Hi team,\n\nA payment was authorized for ${ctx.storeName} (${ctx.dateRange}) on ${c.payment_method_label || 'a saved card'} but hasn't been marked paid yet. Please run the card and click "Mark as Paid" in the portal: ${ctx.campaignUrl}`

  const html = renderApproverEmailHtml({
    greeting: 'Reminder — payment pending',
    subtitle: `${ctx.storeName} · ${ctx.dateRange}`,
    body,
    ctaUrl: ctx.campaignUrl,
    ctaLabel: 'Open Campaign',
    footer: 'Beneficial Estate Buyers · Marketing',
  })

  let sent = 0, failed = 0
  const errors: string[] = []
  for (const email of recipients) {
    try { await sendEmail({ to: email, subject, html }); sent++ }
    catch (err: any) { failed++; errors.push(`${email}: ${err?.message || 'unknown'}`) }
  }
  await recordEscalation(sb, c.id, type)
  return { sent, failed, errors }
}

async function run(req: Request) {
  const url = new URL(req.url)
  const secret = url.searchParams.get('secret')
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const sb = admin()

  const planning = await findStalled(sb, 'awaiting_planning_approval')
  const proof = await findStalled(sb, 'awaiting_proof_approval')
  const payment = await findStalled(sb, 'awaiting_payment_method')
  const paid = await findStalled(sb, 'awaiting_paid_mark')

  const summary = {
    planning_approval: 0,
    proof_approval: 0,
    payment_request: 0,
    mark_paid: 0,
    skipped_already_escalated: 0,
  }

  for (const c of planning) {
    const r = await escalateApprovers(sb, c, 'marketing-approver-planning', 'Review Planning', 'planning_approval')
    if (r) summary.planning_approval++
    else summary.skipped_already_escalated++
  }
  for (const c of proof) {
    const r = await escalateApprovers(sb, c, 'marketing-approver-proof', 'Review Proof', 'proof_approval')
    if (r) summary.proof_approval++
    else summary.skipped_already_escalated++
  }
  for (const c of payment) {
    const r = await escalateApprovers(sb, c, 'marketing-approver-payment', 'Authorize Payment', 'payment_request')
    if (r) summary.payment_request++
    else summary.skipped_already_escalated++
  }
  for (const c of paid) {
    const r = await escalateCollected(sb, c)
    if (r) summary.mark_paid++
    else summary.skipped_already_escalated++
  }

  return NextResponse.json({ ok: true, ...summary })
}

export const GET = run
export const POST = run
