// Per-row dispatcher for gcal_sync_queue. Called by the every-minute
// Vercel cron worker after claim_due_gcal_syncs has flipped the row to
// 'processing'.
//
// Rules:
// - Brand must be enabled in gcal_integration_settings and have a
//   calendar_id configured. Otherwise the row is marked 'done' with
//   no_calendar_configured and the sync is a no-op.
// - On create: call Google, store id in gcal_event_links, mark done.
// - On update: if no link exists, treat as create instead.
// - On delete: best-effort, 404/410 from Google is treated as success.
// - On failure: 3-attempt exponential backoff (1m, 5m, 15m). After the
//   3rd attempt, mark failed and (PR 3) email the brand admin.

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { createGcalEvent, deleteGcalEvent, patchGcalEvent, type GcalEventInput } from './client'
import { sendEmail } from '@/lib/email'

const RETRY_BACKOFF_MINUTES = [1, 5, 15]

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

interface QueueRow {
  id: string
  event_id: string | null
  brand: 'beb' | 'liberty'
  action: 'create' | 'update' | 'delete'
  google_calendar_event_id: string | null
  payload: any
  attempts: number
  status: string
}

interface BrandSettings {
  enabled: boolean
  calendar_id: string | null
  include_buyer_names: boolean
}

async function getBrandSettings(brand: 'beb' | 'liberty'): Promise<BrandSettings | null> {
  const { data } = await admin()
    .from('gcal_integration_settings')
    .select('enabled, calendar_id, include_buyer_names')
    .eq('brand', brand)
    .maybeSingle()
  return (data as BrandSettings | null) ?? null
}

/** Build the Google Calendar event body from the queue payload + live store data. */
async function buildInput(row: QueueRow, settings: BrandSettings): Promise<GcalEventInput> {
  const sb = admin()
  const p = row.payload || {}
  const startDate: string = p.start_date
  // 3-day events; Google's all-day end is exclusive.
  const start = new Date(startDate + 'T00:00:00Z')
  const endExclusive = new Date(start.getTime() + 3 * 86400000)
  const endDate = endExclusive.toISOString().slice(0, 10)

  let location = ''
  if (p.store_id) {
    const { data: store } = await sb.from('stores')
      .select('city, state, address').eq('id', p.store_id).maybeSingle()
    if (store) {
      const parts = [store.address, store.city, store.state].filter(Boolean)
      location = parts.join(', ')
    }
  }

  const workers = (p.workers || []) as Array<{ id: string; name: string }>
  const lead = workers[0]
  const others = workers.slice(1).map(w => w.name).join(', ')

  const descLines: string[] = []
  if (settings.include_buyer_names) {
    if (lead) descLines.push(`Lead buyer: ${lead.name}`)
    if (others) descLines.push(`Assigned: ${others}`)
  }
  descLines.push(`Brand: ${row.brand === 'liberty' ? 'Liberty' : 'Beneficial'}`)
  descLines.push(`Store: ${p.store_name || ''}`)
  descLines.push('')
  descLines.push(`Open in BEB Portal: ${portalUrl()}/?event=${row.event_id}`)

  return {
    summary: p.store_name || 'Event',
    description: descLines.join('\n'),
    location,
    startDate,
    endDate,
    source: { title: 'BEB Portal', url: `${portalUrl()}/?event=${row.event_id}` },
  }
}

export interface DispatchResult {
  rowId: string
  outcome: 'done' | 'skipped' | 'retry_scheduled' | 'failed'
  error?: string
}

export async function dispatchOneSync(row: QueueRow): Promise<DispatchResult> {
  const sb = admin()

  const settings = await getBrandSettings(row.brand)
  if (!settings || !settings.enabled || !settings.calendar_id) {
    await sb.from('gcal_sync_queue').update({
      status: 'done',
      last_error: 'no_calendar_configured',
      processed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', row.id)
    return { rowId: row.id, outcome: 'skipped', error: 'no_calendar_configured' }
  }

  try {
    if (row.action === 'delete') {
      if (row.google_calendar_event_id) {
        await deleteGcalEvent(settings.calendar_id, row.google_calendar_event_id)
      }
      // Clean up any lingering link row in case the trigger missed it.
      if (row.event_id) {
        await sb.from('gcal_event_links').delete().eq('event_id', row.event_id)
      }
    } else {
      const body = await buildInput(row, settings)
      let gcalId = row.google_calendar_event_id
      if (row.action === 'update' && gcalId) {
        await patchGcalEvent(settings.calendar_id, gcalId, body)
      } else {
        const created = await createGcalEvent(settings.calendar_id, body)
        gcalId = created.id
      }
      // Upsert link mapping (the trigger ignores writes to this table so
      // this won't re-enqueue another sync).
      if (row.event_id && gcalId) {
        await sb.from('gcal_event_links').upsert({
          event_id: row.event_id,
          brand: row.brand,
          google_calendar_event_id: gcalId,
          updated_at: new Date().toISOString(),
        })
      }
    }

    await sb.from('gcal_sync_queue').update({
      status: 'done',
      last_error: null,
      processed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', row.id)
    return { rowId: row.id, outcome: 'done' }
  } catch (e: any) {
    const message = e?.message || 'unknown'
    const nextAttempt = row.attempts + 1
    if (nextAttempt < RETRY_BACKOFF_MINUTES.length) {
      const backoff = RETRY_BACKOFF_MINUTES[nextAttempt] * 60 * 1000
      await sb.from('gcal_sync_queue').update({
        status: 'pending',
        attempts: nextAttempt,
        last_error: message,
        scheduled_for: new Date(Date.now() + backoff).toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', row.id)
      return { rowId: row.id, outcome: 'retry_scheduled', error: message }
    } else {
      await sb.from('gcal_sync_queue').update({
        status: 'failed',
        attempts: nextAttempt,
        last_error: message,
        updated_at: new Date().toISOString(),
      }).eq('id', row.id)
      // Best-effort admin alert. Reuses notification_settings.admin_alert_email
      // — the same address the notifications system uses on final failure.
      void notifyAdminOfGcalFailure(row, message)
      return { rowId: row.id, outcome: 'failed', error: message }
    }
  }
}

async function notifyAdminOfGcalFailure(row: QueueRow, error: string): Promise<void> {
  try {
    const sb = admin()
    const { data: settings } = await sb.from('notification_settings')
      .select('admin_alert_email').eq('brand', row.brand).maybeSingle()
    const to = (settings as any)?.admin_alert_email
    if (!to) return
    const portal = portalUrl()
    await sendEmail({
      to,
      subject: `[BEB Portal] Google Calendar sync failed (${row.brand})`,
      html: `
        <p>A Google Calendar sync row permanently failed after 3 attempts.</p>
        <ul>
          <li><strong>Brand:</strong> ${row.brand}</li>
          <li><strong>Action:</strong> ${row.action}</li>
          <li><strong>Event ID:</strong> ${row.event_id || '-'}</li>
          <li><strong>Google Event ID:</strong> ${row.google_calendar_event_id || '-'}</li>
          <li><strong>Last error:</strong> ${escapeHtml(error)}</li>
        </ul>
        <p>Open Settings → Google Calendar Sync to inspect and retry: <a href="${portal}/?nav=settings">${portal}/?nav=settings</a></p>
      `,
    })
  } catch (e) {
    console.error('[gcal] admin alert failed', e)
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c] || c))
}
