// Vercel cron — daily lead follow-up reminders.
//
// Fires once a day. For each user with at least one lead whose
// follow_up_date is due today (or overdue), sends ONE digest email
// summarizing those leads + a link to the leads module.
//
// Recipient model:
//   - Leads with assigned_rep_id → emailed to that rep
//   - Leads with no assigned_rep but a follow_up_set_by_user_id
//     (the user who last set the follow-up date — trigger-stamped)
//     → emailed to that user
//   - Anything with neither is dropped (no owner, no email)
//
// De-duplication: per-lead `follow_up_email_last_sent_on` is
// stamped to today after a successful send. The query filters on
// `follow_up_email_last_sent_on IS NULL OR < today` so the same
// lead doesn't fire twice on the same day. Overdue leads keep
// re-firing daily until acted on — by design.
//
// Auth: ?secret=<CRON_SECRET>, same pattern as the other crons.
//
// Schedule (vercel.json): '0 13 * * *' → 13:00 UTC = 9 AM Eastern
// (year-round-safe — slightly off-peak vs. the operator's
// morning routine).

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email'

export const dynamic = 'force-dynamic'

// Daily run, no batching needed — even 1k+ leads is well under the
// per-tick budget.
export const maxDuration = 300

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

function portalUrl(): string {
  return (
    process.env.NEXT_PUBLIC_PORTAL_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    'https://beb-portal-v2.vercel.app'
  )
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch] as string))
}

function fmtDate(iso: string): string {
  // 'YYYY-MM-DD' → 'May 15'
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

interface DueLead {
  id: string
  business_name: string | null
  contact_name: string | null
  city: string | null
  state: string | null
  status: string
  follow_up_date: string  // YYYY-MM-DD
  assigned_rep_id: string | null
  follow_up_set_by_user_id: string | null
  interest_level: string | null
  interest_description: string | null
  notes: string | null
}

async function run(req: Request) {
  const url = new URL(req.url)
  const secret = url.searchParams.get('secret')
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sb = admin()
  const today = new Date().toISOString().slice(0, 10)

  // ── 1. Pull every due lead that hasn't been emailed today ───
  // Status filter excludes terminal states. Email-guard filter
  // is "haven't sent today" using PostgREST .or() across the
  // null-or-stale cases.
  const { data: leads, error } = await sb
    .from('leads')
    .select(`
      id, business_name, contact_name, city, state, status,
      follow_up_date, assigned_rep_id, follow_up_set_by_user_id,
      interest_level, interest_description, notes
    `)
    .lte('follow_up_date', today)
    .not('follow_up_date', 'is', null)
    .not('status', 'in', '(converted,dead)')
    .is('deleted_at', null)
    .or(`follow_up_email_last_sent_on.is.null,follow_up_email_last_sent_on.lt.${today}`)
  if (error) {
    return NextResponse.json({ error: 'lead_query_failed', detail: error.message }, { status: 500 })
  }
  const dueLeads = (leads || []) as DueLead[]
  if (dueLeads.length === 0) {
    return NextResponse.json({ ok: true, leads: 0, emails: 0 })
  }

  // ── 2. Determine recipient per lead ──────────────────────────
  // assigned_rep first, fall back to set_by. Drop leads with neither.
  type GroupedLead = { lead: DueLead; recipient_user_id: string }
  const grouped: GroupedLead[] = []
  for (const l of dueLeads) {
    const recipient = l.assigned_rep_id || l.follow_up_set_by_user_id
    if (recipient) grouped.push({ lead: l, recipient_user_id: recipient })
  }
  if (grouped.length === 0) {
    return NextResponse.json({ ok: true, leads: dueLeads.length, emails: 0, note: 'No leads had an identifiable recipient.' })
  }

  // ── 3. Fetch recipient details (name + email) in one trip ───
  const recipientIds = Array.from(new Set(grouped.map(g => g.recipient_user_id)))
  const { data: usersData } = await sb
    .from('users')
    .select('id, name, email')
    .in('id', recipientIds)
  const userById = new Map<string, { id: string; name: string | null; email: string | null }>()
  for (const u of (usersData || []) as any[]) {
    if (u.id) userById.set(u.id, u)
  }

  // ── 4. Group leads per recipient ─────────────────────────────
  const byRecipient = new Map<string, DueLead[]>()
  for (const g of grouped) {
    const list = byRecipient.get(g.recipient_user_id) || []
    list.push(g.lead)
    byRecipient.set(g.recipient_user_id, list)
  }

  // ── 5. Send one digest per recipient, stamp on success ──────
  let emailsSent = 0
  let emailsFailed = 0
  const stampedLeadIds: string[] = []

  for (const [recipientId, recipientLeads] of byRecipient.entries()) {
    const recipient = userById.get(recipientId)
    if (!recipient?.email || typeof recipient.email !== 'string' || !recipient.email.includes('@')) {
      // No emailable address — skip but DON'T stamp; we want the
      // next cron tick to try again in case the user adds an email.
      emailsFailed += recipientLeads.length
      continue
    }

    const dueToday = recipientLeads.filter(l => l.follow_up_date === today)
    const overdue  = recipientLeads.filter(l => l.follow_up_date <  today)

    // Subject summary — most-readable inbox preview.
    const summaryParts: string[] = []
    if (dueToday.length > 0) summaryParts.push(`${dueToday.length} due today`)
    if (overdue.length  > 0) summaryParts.push(`${overdue.length} overdue`)
    const subject = `🎯 Lead follow-ups · ${summaryParts.join(' · ') || `${recipientLeads.length} due`}`

    // Body — overdue first (more urgent), then due today.
    const renderRow = (l: DueLead, daysLate: number | null) => {
      const name = escapeHtml(l.business_name || l.contact_name || '(unnamed lead)')
      const where = [l.city, l.state].filter(Boolean).join(', ')
      const interest = l.interest_description || (l.interest_level ? `Interest: ${l.interest_level}` : '')
      const lateChip = daysLate !== null && daysLate > 0
        ? `<span style="background:#FEE2E2;color:#991B1B;font-size:11px;font-weight:700;padding:2px 6px;border-radius:4px;margin-left:6px">${daysLate}d overdue</span>`
        : daysLate === 0
          ? `<span style="background:#FEF3C7;color:#92400E;font-size:11px;font-weight:700;padding:2px 6px;border-radius:4px;margin-left:6px">today</span>`
          : ''
      return `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #E5E7EB;vertical-align:top">
            <div style="font-weight:700;font-size:14px;color:#1a1a1a">${name}${lateChip}</div>
            ${where ? `<div style="font-size:12px;color:#6B7280;margin-top:2px">${escapeHtml(where)}</div>` : ''}
            ${interest ? `<div style="font-size:12px;color:#4B5563;margin-top:4px">${escapeHtml(interest)}</div>` : ''}
            ${l.notes ? `<div style="font-size:11px;color:#9CA3AF;margin-top:4px;font-style:italic">${escapeHtml(l.notes.slice(0, 240))}${l.notes.length > 240 ? '…' : ''}</div>` : ''}
          </td>
        </tr>
      `
    }

    const rows: string[] = []
    for (const l of overdue.sort((a, b) => a.follow_up_date.localeCompare(b.follow_up_date))) {
      const days = Math.max(1, Math.floor((new Date(today + 'T12:00:00').getTime() - new Date(l.follow_up_date + 'T12:00:00').getTime()) / 86400000))
      rows.push(renderRow(l, days))
    }
    for (const l of dueToday) {
      rows.push(renderRow(l, 0))
    }

    const html = `<!DOCTYPE html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1a1a1a;max-width:560px;margin:0 auto;padding:24px;line-height:1.5">
  <h2 style="font-size:18px;font-weight:800;margin:0 0 4px">🎯 Lead follow-ups</h2>
  <div style="font-size:13px;color:#6B7280;margin-bottom:18px">
    ${escapeHtml(recipient.name || recipient.email)} ·
    ${summaryParts.length > 0 ? summaryParts.join(' · ') : 'Daily summary'}
  </div>

  <table style="width:100%;border-collapse:collapse;border:1px solid #E5E7EB;border-radius:8px;overflow:hidden;margin-bottom:20px">
    ${rows.join('')}
  </table>

  <div style="text-align:center;margin-bottom:20px">
    <a href="${portalUrl()}/?nav=leads" style="display:inline-block;padding:10px 20px;background:#1D6B44;color:#fff;text-decoration:none;border-radius:8px;font-weight:800;font-size:14px">
      Open Leads →
    </a>
  </div>

  <div style="font-size:11px;color:#9CA3AF;border-top:1px solid #E5E7EB;padding-top:12px">
    You're receiving this because you're the assigned rep or you set the follow-up date.
    Resolve a lead (change status, advance the follow-up date, or assign it elsewhere) to stop the daily reminder.
  </div>
</body></html>`

    try {
      await sendEmail({
        to: recipient.name ? `${recipient.name} <${recipient.email}>` : recipient.email,
        subject,
        html,
      })
      emailsSent += 1
      stampedLeadIds.push(...recipientLeads.map(l => l.id))
    } catch (e: any) {
      console.warn('[lead-follow-up-reminders] send failed for recipient', recipientId, e?.message)
      emailsFailed += 1
    }
  }

  // ── 6. Stamp follow_up_email_last_sent_on for emailed leads ─
  // Done in one UPDATE for the whole batch. Failed sends are not
  // stamped so the next cron tick retries them.
  if (stampedLeadIds.length > 0) {
    const { error: stampErr } = await sb
      .from('leads')
      .update({ follow_up_email_last_sent_on: today })
      .in('id', stampedLeadIds)
    if (stampErr) {
      console.warn('[lead-follow-up-reminders] stamp update failed', stampErr.message)
    }
  }

  return NextResponse.json({
    ok: true,
    leads: dueLeads.length,
    recipients: byRecipient.size,
    emails_sent: emailsSent,
    emails_failed: emailsFailed,
    stamped: stampedLeadIds.length,
  })
}

export async function GET(req: Request)  { return run(req) }
export async function POST(req: Request) { return run(req) }
