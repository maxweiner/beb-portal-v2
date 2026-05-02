// POST /api/marketing/campaigns/[id]/notify-team
//
// Mints a 30-day magic-link token per active team-email recipient, emails
// the marketing-team-notification template to each, and stamps
// marketing_campaigns.team_notified_at.
//
// Required: campaign has marketing_budget set (the spec gates the button
// on this; the route enforces it server-side too).
// Required: caller has marketing_access (serverAuth).

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'crypto'
import { sendEmail } from '@/lib/email'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { blockIfImpersonating } from '@/lib/impersonation/server'
import { eventEndIso } from '@/lib/eventDates'

export const dynamic = 'force-dynamic'

const MAGIC_LINK_TTL_DAYS = 30

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

function substitute(text: string, vars: Record<string, string | number | null | undefined>): string {
  return (text || '').replace(/\{(\w+)\}/g, (_, k) => {
    const v = vars[k]
    return v == null ? '' : String(v)
  })
}

function fmtDateRange(startIso: string): string {
  const start = new Date(startIso + 'T12:00:00')
  const endIso = eventEndIso(startIso)
  const end = new Date(endIso + 'T12:00:00')
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()
  const startLabel = start.toLocaleDateString('en-US', sameMonth
    ? { month: 'long', day: 'numeric' }
    : { month: 'short', day: 'numeric' })
  const endLabel = end.toLocaleDateString('en-US', { month: sameMonth ? undefined : 'short', day: 'numeric', year: 'numeric' })
  return `${startLabel}–${endLabel}`
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const blocked = await blockIfImpersonating(req)
  if (blocked) return blocked

  const sb = admin()

  // Verify caller has marketing_access.
  const { data: meRow } = await sb.from('users').select('marketing_access').eq('id', me.id).maybeSingle()
  if (!(meRow as any)?.marketing_access) {
    return NextResponse.json({ error: 'Marketing access required' }, { status: 403 })
  }

  // Pull the campaign + event + store. RLS would block this for the
  // caller's own anon client; service role bypasses it.
  const { data: campaign } = await sb.from('marketing_campaigns')
    .select('id, event_id, flow_type, marketing_budget, team_notified_at')
    .eq('id', params.id).maybeSingle()
  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
  if (!campaign.marketing_budget || Number(campaign.marketing_budget) <= 0) {
    return NextResponse.json({ error: 'Set a marketing budget before notifying the team.' }, { status: 400 })
  }

  const { data: event } = await sb.from('events')
    .select('id, store_id, store_name, start_date')
    .eq('id', campaign.event_id).maybeSingle()
  if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

  const { data: store } = await sb.from('stores')
    .select('name, address, city, state, zip')
    .eq('id', event.store_id).maybeSingle()
  const storeName = (store as any)?.name || event.store_name || '(unknown store)'
  const fullAddress = [store?.address, store?.city, store?.state, store?.zip]
    .filter(Boolean).join(', ') || '(address not set)'

  // Recipients
  const { data: teamEmails } = await sb.from('marketing_team_emails')
    .select('email, name').eq('is_active', true)
  const recipients = (teamEmails ?? []) as { email: string; name: string | null }[]
  if (recipients.length === 0) {
    return NextResponse.json({ error: 'No active team email recipients configured. Add some in Settings → Team Emails.' }, { status: 400 })
  }

  // Template
  const { data: tpl } = await sb.from('report_templates')
    .select('subject, greeting, header_subtitle, footer, shoutout_fallback')
    .eq('id', 'marketing-team-notification').maybeSingle()

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://beb-portal-v2.vercel.app'
  const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const dateRange = fmtDateRange(event.start_date)
  const budgetAmount = Number(campaign.marketing_budget).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })

  // Mint a token per recipient and send.
  let sentCount = 0
  let failCount = 0
  const errors: string[] = []
  for (const r of recipients) {
    const token = randomBytes(32).toString('hex')
    const { error: tokenErr } = await sb.from('magic_link_tokens').insert({
      campaign_id: campaign.id,
      email: r.email,
      token,
      expires_at: expiresAt,
    })
    if (tokenErr) { failCount++; errors.push(`token for ${r.email}: ${tokenErr.message}`); continue }

    const magicLinkUrl = `${baseUrl}/marketing/${token}`
    const vars = {
      store_name: storeName,
      full_address: fullAddress,
      date_range: dateRange,
      budget_amount: budgetAmount,
      magic_link_url: magicLinkUrl,
    }
    const subject = substitute(tpl?.subject || 'New event at {store_name} — marketing setup', vars)
    const greeting = substitute(tpl?.greeting || 'Dear Collected Team,', vars)
    const subtitle = substitute(tpl?.header_subtitle || `${storeName} · ${dateRange}`, vars)
    const body = substitute(tpl?.shoutout_fallback || '', vars)
    const footer = substitute(tpl?.footer || 'Beneficial Estate Buyers · Marketing', vars)

    const html = renderEmail({ greeting, subtitle, body, magicLinkUrl, footer })
    try {
      await sendEmail({ to: r.email, subject, html })
      sentCount++
    } catch (err: any) {
      failCount++
      errors.push(`send to ${r.email}: ${err?.message || 'unknown'}`)
    }
  }

  // Stamp team_notified_at + advance sub_status.
  await sb.from('marketing_campaigns')
    .update({
      team_notified_at: new Date().toISOString(),
      sub_status: 'awaiting_planning_submission',
    })
    .eq('id', campaign.id)

  return NextResponse.json({
    ok: true,
    sent: sentCount,
    failed: failCount,
    errors: errors.length > 0 ? errors : undefined,
  })
}

function renderEmail(opts: {
  greeting: string; subtitle: string; body: string; magicLinkUrl: string; footer: string
}): string {
  const bodyHtml = (opts.body || '').replace(/\n/g, '<br/>')
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; background: #f5f0e8; padding: 20px;">
      <div style="background: #2D3B2D; padding: 24px; border-radius: 8px 8px 0 0; color: #fff;">
        <div style="color: #7EC8A0; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 4px;">
          Beneficial Estate Buyers · Marketing
        </div>
        <div style="font-size: 20px; font-weight: 900;">${escapeHtml(opts.greeting)}</div>
        <div style="font-size: 13px; color: rgba(255,255,255,.6); margin-top: 4px;">${escapeHtml(opts.subtitle)}</div>
      </div>
      <div style="background: #fff; padding: 24px; border: 1px solid #e8e0d0; border-top: none; font-size: 14px; color: #333; line-height: 1.6;">
        <div>${bodyHtml}</div>
        <div style="text-align: center; margin: 24px 0;">
          <a href="${opts.magicLinkUrl}" style="display: inline-block; padding: 14px 32px; background: #2D3B2D; color: #fff; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
            Open Campaign →
          </a>
        </div>
        <p style="color: #888; font-size: 12px; text-align: center; margin: 0;">${escapeHtml(opts.magicLinkUrl)}</p>
      </div>
      <div style="background: #fff; padding: 14px 28px; border: 1px solid #e8e0d0; border-top: none; border-radius: 0 0 8px 8px; text-align: center; font-size: 12px; color: #a8a89a;">
        ${escapeHtml(opts.footer)}
      </div>
    </div>
  `
}

function escapeHtml(s: string): string {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
