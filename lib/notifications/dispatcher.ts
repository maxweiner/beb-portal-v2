// Per-row dispatch logic for the delayed notification system.
//
// dispatchOne(row) is called by:
//   - the cron worker (after claim_due_notifications has flipped the
//     row to status='processing'), and
//   - the manual "Send Now" admin action (which similarly transitions
//     pending -> processing before calling).
//
// dispatchOne is responsible for:
//   - Re-rendering merge data against live event/buyer/store state.
//   - Per-channel quiet-hours + rate-limit gating.
//   - Sending via Resend / Twilio.
//   - Updating per-channel status, overall status, retry_count, sent_at.
//   - Scheduling retries with exponential backoff on transient failure.
//   - Sending a final-failure alert email to the brand's admin contact
//     after the 3rd attempt.

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email'
import { sendSMS } from '@/lib/sms'
import { buildMergeVars, substitute, type MergeVarsContext } from './mergeVars'
import { inQuietHours, nextQuietHoursEnd, type QuietHoursWindow } from './quietHours'
import { checkRateLimit, type SendChannel } from './rateLimit'

let _client: SupabaseClient | null = null
function admin(): SupabaseClient {
  if (_client) return _client
  _client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
  return _client
}

function portalUrl(): string {
  return (
    process.env.NEXT_PUBLIC_PORTAL_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    'https://beb-portal-v2.vercel.app'
  )
}

const RETRY_BACKOFF_MINUTES = [1, 5] // first retry 1m, second 5m, then fail

interface ScheduledRow {
  id: string
  brand: 'beb' | 'liberty'
  trigger_type: string
  template_id: string | null
  recipient_buyer_id: string | null
  recipient_email: string | null
  recipient_phone: string | null
  recipient_timezone: string | null
  channels: string[]
  merge_data: Record<string, string>
  status: string
  email_status: string | null
  sms_status: string | null
  retry_count: number
  related_event_id: string | null
}

export interface DispatchResult {
  rowId: string
  outcome:
    | 'sent'
    | 'partial'
    | 'held'
    | 'rate_limited'
    | 'retry_scheduled'
    | 'failed'
    | 'cancelled'
    | 'skipped'
  email?: 'sent' | 'failed' | 'held' | 'skipped' | 'rate_limited'
  sms?: 'sent' | 'failed' | 'held' | 'skipped' | 'rate_limited'
  error?: string
  rescheduledFor?: string
}

/**
 * Sends one scheduled_notifications row. Caller has already flipped
 * its status to 'processing' (via claim_due_notifications or the
 * Send-Now path).
 */
export async function dispatchOne(
  row: ScheduledRow,
  opts: { bypassRateLimit?: boolean; bypassQuietHours?: boolean } = {},
): Promise<DispatchResult> {
  const sb = admin()

  // Load template + per-brand settings live.
  const [tplRes, settingsRes] = await Promise.all([
    row.template_id
      ? sb.from('notification_templates')
          .select('id, enabled, channels, email_subject, email_body_html, email_body_text, sms_body, respect_quiet_hours_email, respect_quiet_hours_sms')
          .eq('id', row.template_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null } as any),
    sb.from('notification_settings')
      .select('admin_alert_email, default_from_email, quiet_hours_enabled, quiet_hours_start, quiet_hours_end, default_timezone')
      .eq('brand', row.brand)
      .maybeSingle(),
  ])

  const tpl = tplRes.data as any
  const settings = (settingsRes.data as any) || {
    admin_alert_email: null,
    default_from_email: 'noreply@bebllp.com',
    quiet_hours_enabled: true,
    quiet_hours_start: '21:00',
    quiet_hours_end: '08:00',
    default_timezone: 'America/New_York',
  }

  if (!tpl) {
    await markFailed(sb, row.id, 'template_missing')
    return { rowId: row.id, outcome: 'failed', error: 'template_missing' }
  }
  if (!tpl.enabled) {
    await sb.from('scheduled_notifications').update({
      status: 'cancelled', cancelled_reason: 'template_disabled', updated_at: new Date().toISOString(),
    }).eq('id', row.id)
    return { rowId: row.id, outcome: 'cancelled' }
  }

  // Re-render merge data against LIVE event/buyer state. Falls back
  // to the snapshot in row.merge_data on any lookup failure.
  const mergeData = await rerenderMergeData(sb, row, row.merge_data)

  const tz = row.recipient_timezone || settings.default_timezone || 'America/New_York'
  const window: QuietHoursWindow = {
    enabled: !!settings.quiet_hours_enabled,
    start: settings.quiet_hours_start || '21:00',
    end: settings.quiet_hours_end || '08:00',
  }
  const now = new Date()
  const inQH = !opts.bypassQuietHours && inQuietHours(now, tz, window)
  const nextWake = inQH ? nextQuietHoursEnd(now, tz, window) : null

  const channelsRequested = (row.channels || []).filter(c => c === 'email' || c === 'sms') as SendChannel[]

  let emailOutcome: DispatchResult['email'] | undefined
  let smsOutcome: DispatchResult['sms'] | undefined
  const errors: string[] = []

  // ── EMAIL ────────────────────────────────────────────────────
  if (channelsRequested.includes('email') && row.email_status !== 'sent') {
    if (!row.recipient_email) {
      emailOutcome = 'failed'
      errors.push('email: missing_contact_info')
    } else if (inQH && tpl.respect_quiet_hours_email) {
      emailOutcome = 'held'
    } else {
      const gate = await checkRateLimit('email', { bypass: !!opts.bypassRateLimit })
      if (!gate.allowed) {
        emailOutcome = 'rate_limited'
      } else {
        try {
          const subject = substitute(tpl.email_subject || '', mergeData)
          const html = substitute(tpl.email_body_html || tpl.email_body_text || '', mergeData)
          await sendEmail({
            to: row.recipient_email,
            subject,
            html,
            from: settings.default_from_email
              ? `Beneficial Estate Buyers <${settings.default_from_email}>`
              : undefined,
          })
          emailOutcome = 'sent'
        } catch (e: any) {
          emailOutcome = 'failed'
          errors.push(`email: ${e?.message || 'send_failed'}`)
        }
      }
    }
  } else if (row.email_status === 'sent') {
    emailOutcome = 'sent'
  }

  // ── SMS ──────────────────────────────────────────────────────
  if (channelsRequested.includes('sms') && row.sms_status !== 'sent') {
    if (!row.recipient_phone) {
      smsOutcome = 'failed'
      errors.push('sms: missing_contact_info')
    } else if (inQH && tpl.respect_quiet_hours_sms) {
      smsOutcome = 'held'
    } else {
      const gate = await checkRateLimit('sms', { bypass: !!opts.bypassRateLimit })
      if (!gate.allowed) {
        smsOutcome = 'rate_limited'
      } else {
        try {
          const body = substitute(tpl.sms_body || '', mergeData)
          await sendSMS(row.recipient_phone, body)
          smsOutcome = 'sent'
        } catch (e: any) {
          smsOutcome = 'failed'
          errors.push(`sms: ${e?.message || 'send_failed'}`)
        }
      }
    }
  } else if (row.sms_status === 'sent') {
    smsOutcome = 'sent'
  }

  // ── Resolve overall row state ────────────────────────────────
  const outcomes = [emailOutcome, smsOutcome].filter(Boolean) as string[]
  const allDone = outcomes.every(o => o === 'sent' || o === 'skipped')
  const anyHeld = outcomes.some(o => o === 'held')
  const anyRateLimited = outcomes.some(o => o === 'rate_limited')
  const anyFailed = outcomes.some(o => o === 'failed')

  const update: Record<string, any> = {
    email_status: emailOutcome ?? row.email_status,
    sms_status: smsOutcome ?? row.sms_status,
    error_message: errors.length ? errors.join('; ') : null,
    updated_at: new Date().toISOString(),
  }

  let outcome: DispatchResult['outcome']
  let rescheduledFor: string | undefined

  if (allDone) {
    update.status = 'sent'
    update.sent_at = new Date().toISOString()
    outcome = 'sent'
  } else if (anyFailed && !anyHeld && !anyRateLimited) {
    // All non-sent channels failed. Apply retry policy.
    const nextRetry = row.retry_count
    if (nextRetry < RETRY_BACKOFF_MINUTES.length) {
      const backoffMs = RETRY_BACKOFF_MINUTES[nextRetry] * 60 * 1000
      update.status = 'pending'
      update.retry_count = row.retry_count + 1
      update.scheduled_for = new Date(Date.now() + backoffMs).toISOString()
      // Reset per-channel statuses on the FAILED ones so the retry
      // attempts them again. Keep 'sent' / 'skipped' as-is.
      if (emailOutcome === 'failed') update.email_status = 'pending'
      if (smsOutcome === 'failed') update.sms_status = 'pending'
      outcome = 'retry_scheduled'
      rescheduledFor = update.scheduled_for
    } else {
      update.status = 'failed'
      outcome = 'failed'
      // Fire admin alert. Best-effort — don't fail the dispatch on this.
      void notifyAdminOfFailure(row, settings.admin_alert_email, errors.join('; '))
    }
  } else if (anyHeld && !anyFailed && !anyRateLimited) {
    // All non-sent channels are held by quiet hours. Wake at next end.
    update.status = 'held'
    update.hold_reason = 'quiet_hours'
    if (nextWake) update.scheduled_for = nextWake.toISOString()
    outcome = 'held'
    rescheduledFor = update.scheduled_for
  } else if (anyRateLimited && !anyFailed) {
    // Hold the row for the next cron cycle (60s). Don't change status
    // from 'processing' permanently — set back to 'pending' with a
    // small bump so it falls within the next claim batch.
    update.status = 'pending'
    update.scheduled_for = new Date(Date.now() + 30 * 1000).toISOString()
    if (emailOutcome === 'rate_limited') update.email_status = 'pending'
    if (smsOutcome === 'rate_limited') update.sms_status = 'pending'
    outcome = 'rate_limited'
    rescheduledFor = update.scheduled_for
  } else {
    // Mixed: some sent, some held / rate-limited / failed. Treat as
    // partial and re-queue for another pass.
    update.status = 'pending'
    update.scheduled_for = nextWake
      ? nextWake.toISOString()
      : new Date(Date.now() + 60 * 1000).toISOString()
    if (emailOutcome === 'rate_limited' || emailOutcome === 'held') update.email_status = 'pending'
    if (smsOutcome === 'rate_limited' || smsOutcome === 'held') update.sms_status = 'pending'
    outcome = 'partial'
    rescheduledFor = update.scheduled_for
  }

  await sb.from('scheduled_notifications').update(update).eq('id', row.id)

  return { rowId: row.id, outcome, email: emailOutcome, sms: smsOutcome, error: errors.join('; ') || undefined, rescheduledFor }
}

// ── Helpers ─────────────────────────────────────────────────────

async function markFailed(sb: SupabaseClient, rowId: string, message: string) {
  await sb.from('scheduled_notifications').update({
    status: 'failed', error_message: message, updated_at: new Date().toISOString(),
  }).eq('id', rowId)
}

async function rerenderMergeData(
  sb: SupabaseClient,
  row: ScheduledRow,
  snapshot: Record<string, string>,
): Promise<Record<string, string>> {
  // If we don't have an event id we can't refresh — return the snapshot.
  if (!row.related_event_id || !row.recipient_buyer_id) return snapshot

  try {
    const [evRes, buyerRes] = await Promise.all([
      sb.from('events')
        .select('id, store_id, store_name, start_date, workers, brand')
        .eq('id', row.related_event_id)
        .maybeSingle(),
      sb.from('users')
        .select('id, name, email, phone')
        .eq('id', row.recipient_buyer_id)
        .maybeSingle(),
    ])

    const event = evRes.data as any
    const buyer = buyerRes.data as any
    if (!event || !buyer) return snapshot

    const storeRes = await sb.from('stores')
      .select('id, name, city, address, timezone')
      .eq('id', event.store_id)
      .maybeSingle()
    const store = (storeRes.data as any) || { id: event.store_id, name: event.store_name }

    const others = ((event.workers || []) as { id: string; name: string }[])
      .filter(w => w.id !== buyer.id)

    const ctx: MergeVarsContext = {
      buyer: { id: buyer.id, name: buyer.name, email: buyer.email, phone: buyer.phone },
      event: {
        id: event.id,
        name: event.store_name,
        start_date: event.start_date,
        city: store.city,
        address: store.address,
        travel_share_url: `${portalUrl()}/?event=${event.id}&nav=travel`,
      },
      store: { id: store.id, name: store.name, timezone: store.timezone },
      brand: row.brand,
      otherBuyers: others,
      portalUrl: portalUrl(),
    }
    return buildMergeVars(ctx)
  } catch {
    return snapshot
  }
}

async function notifyAdminOfFailure(
  row: ScheduledRow,
  adminEmail: string | null,
  error: string,
): Promise<void> {
  if (!adminEmail) return
  try {
    await sendEmail({
      to: adminEmail,
      subject: `[BEB Portal] Notification failed: ${row.trigger_type}`,
      html: `
        <p>A scheduled notification permanently failed after retries.</p>
        <ul>
          <li><strong>Row id:</strong> ${row.id}</li>
          <li><strong>Brand:</strong> ${row.brand}</li>
          <li><strong>Trigger:</strong> ${row.trigger_type}</li>
          <li><strong>Recipient buyer id:</strong> ${row.recipient_buyer_id ?? '-'}</li>
          <li><strong>Email:</strong> ${row.recipient_email ?? '-'}</li>
          <li><strong>Phone:</strong> ${row.recipient_phone ?? '-'}</li>
          <li><strong>Channels:</strong> ${(row.channels || []).join(', ')}</li>
          <li><strong>Last error:</strong> ${escapeHtml(error)}</li>
        </ul>
      `,
    })
  } catch (e) {
    console.error('admin alert email failed', e)
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] || c))
}
