// Vercel cron worker — auto-schedule sends for due buying-comms
// checklist items.
//
// Phase 3c-ii. Closes the loop on the master checklist: when a
// master item with linked_action='send_communication' reaches its
// due_date, this cron auto-inserts a 'scheduled' row into
// buying_communication_sends with scheduled_for=now(). The existing
// /api/cron/buying-comms-fire-due cron drains it within 15 minutes.
//
// We don't fire directly from this cron — that keeps the send
// pipeline single-path (manual + scheduled + auto all flow through
// the same fire-due drainer). One Resend integration to debug, one
// log row format to read.
//
// Settings (admin-managed; flip via SQL or settings panel):
//   - buying_comms_auto_send_enabled  ('true' to enable)
//   - buying_comms_auto_send_dry_run  (default 'true' — log only)
//   - buying_comms_auto_send_user_id  (UUID of the sender user;
//                                      their @bebllp.com email
//                                      goes on the From header)
//   - buying_comms_send_enabled       (master kill switch — also
//                                      gates the fire-due cron)
//
// Default state: auto-send is OFF + dry_run is ON. Operator has to
// (1) flip dry_run to 'false' (2) flip auto_send_enabled to 'true'
// (3) flip the master send_enabled to 'true' for letters to fire.
// Three explicit yes-clicks before any email goes out automatically.
//
// Schedule: every hour at :07 (offset from other crons to avoid
// thundering herd). Hourly is plenty — master due_dates are
// day-granularity; first cron after midnight ET catches the day's
// new dues, drainer fires them within 15 min.
//
// Idempotency:
//   - Skip items already is_completed=true.
//   - Skip items whose (event_id, template_id) already has a row
//     in buying_communication_sends with status in
//     ('scheduled','sent','delivered'). Prevents double-fire on
//     re-runs and on humans who already sent it.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { applyBuyingMergeFields } from '@/lib/communications/buyingMergeFields'
import type { MergeContext } from '@/lib/communications/mergeFields'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const BATCH_SIZE = 100

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

interface DueItem {
  id: string
  event_id: string
  linked_template_id: string
  title: string
  due_date: string
}

async function readBoolSetting(sb: any, key: string, defaultVal: boolean): Promise<boolean> {
  const { data } = await sb.from('settings').select('value').eq('key', key).maybeSingle()
  const raw = ((data as any)?.value as string | undefined)?.replace(/^"|"$/g, '')
  if (raw === undefined) return defaultVal
  return raw === 'true'
}

async function readStringSetting(sb: any, key: string): Promise<string | null> {
  const { data } = await sb.from('settings').select('value').eq('key', key).maybeSingle()
  const raw = (data as any)?.value as string | undefined
  if (!raw) return null
  return raw.replace(/^"|"$/g, '')
}

async function run(req: Request) {
  const url = new URL(req.url)
  const secret = url.searchParams.get('secret')
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sb = admin()

  const autoEnabled = await readBoolSetting(sb, 'buying_comms_auto_send_enabled', false)
  if (!autoEnabled) {
    return NextResponse.json({ ok: true, skipped: 'auto_send_disabled' })
  }
  const dryRun = await readBoolSetting(sb, 'buying_comms_auto_send_dry_run', true)
  const senderUserId = await readStringSetting(sb, 'buying_comms_auto_send_user_id')
  if (!senderUserId) {
    return NextResponse.json({ ok: false, error: 'buying_comms_auto_send_user_id not set' }, { status: 500 })
  }

  // Resolve the sender. Must have a @bebllp.com email (Resend
  // domain restriction — same gate the immediate-send route uses).
  const { data: sender } = await sb.from('users')
    .select('id, name, email').eq('id', senderUserId).maybeSingle()
  if (!sender || !(sender as any).email || !/@bebllp\.com$/i.test((sender as any).email)) {
    return NextResponse.json({
      ok: false,
      error: `Configured auto-send sender (${senderUserId}) doesn't have a @bebllp.com email.`,
    }, { status: 500 })
  }

  // Find due items. Joining the master + the linked template up
  // front so we can render in one pass.
  const todayIso = new Date().toISOString().slice(0, 10)
  const { data: dueRaw, error: dueErr } = await sb
    .from('buying_event_checklist_items')
    .select('id, event_id, linked_template_id, title, due_date')
    .eq('is_completed', false)
    .eq('linked_action_type', 'send_communication')
    .not('linked_template_id', 'is', null)
    .lte('due_date', todayIso)
    .order('due_date', { ascending: true })
    .limit(BATCH_SIZE)
  if (dueErr) return NextResponse.json({ error: `query: ${dueErr.message}` }, { status: 500 })
  const due = ((dueRaw || []) as unknown) as DueItem[]
  if (due.length === 0) {
    return NextResponse.json({ ok: true, dryRun, claimed: 0 })
  }

  // Pre-load events + stores + templates + existing send guards in
  // bulk so we don't N+1 against Supabase.
  const eventIds = Array.from(new Set(due.map(d => d.event_id)))
  const templateIds = Array.from(new Set(due.map(d => d.linked_template_id)))
  const [{ data: evs }, { data: storeRows }, { data: tpls }, { data: existingSends }] = await Promise.all([
    sb.from('events').select('id, store_id, start_date, status, workers, store_name').in('id', eventIds),
    sb.from('stores').select('id, name, address_1, city, state, zip, owner_name, owner_email, owner_title')
      .in('id', (await sb.from('events').select('store_id').in('id', eventIds)).data?.map((e: any) => e.store_id) || []),
    sb.from('buying_communication_templates').select('id, name, subject_line, body').in('id', templateIds),
    sb.from('buying_communication_sends')
      .select('event_id, template_id, delivery_status')
      .in('event_id', eventIds)
      .in('template_id', templateIds)
      .in('delivery_status', ['scheduled', 'sent', 'delivered']),
  ])
  const eventById   = new Map<string, any>((evs || []).map((r: any) => [r.id, r]))
  const storeById   = new Map<string, any>((storeRows || []).map((r: any) => [r.id, r]))
  const tplById     = new Map<string, any>((tpls || []).map((r: any) => [r.id, r]))
  const guardKeys   = new Set<string>(
    (existingSends || []).map((r: any) => `${r.event_id}::${r.template_id}`),
  )

  const nowIso = new Date().toISOString()
  const fromName = (sender as any).name || (sender as any).email
  const fromEmail = (sender as any).email

  const scheduled: any[] = []
  const skipped: any[] = []

  for (const d of due) {
    const ev = eventById.get(d.event_id)
    const tpl = tplById.get(d.linked_template_id)
    const store = ev ? storeById.get(ev.store_id) : null

    if (!ev || !tpl) { skipped.push({ id: d.id, reason: 'missing_event_or_template' }); continue }
    if (ev.status === 'cancelled' || ev.deleted_at) {
      skipped.push({ id: d.id, reason: 'event_cancelled' }); continue
    }
    if (!store?.owner_email) { skipped.push({ id: d.id, reason: 'no_store_owner_email' }); continue }
    if (guardKeys.has(`${d.event_id}::${d.linked_template_id}`)) {
      skipped.push({ id: d.id, reason: 'already_scheduled_or_sent' }); continue
    }

    // Resolve buying merge context (same shape as the BuyingSendFlow).
    const start = ev.start_date as string | null
    const end = start ? addDays(start, 2) : ''
    const workers = (ev.workers as any[] | undefined) || []
    const buyerNames = workers.filter(w => !w.deleted).map(w => firstName(w.name)).filter(Boolean).join(', ')
    const fullAddress = [store.address_1, [store.city, store.state, store.zip].filter(Boolean).join(', ')].filter(Boolean).join('\n')

    const ctx: MergeContext = {
      store_name:           store.name || '',
      store_address_line_1: store.address_1 || '',
      store_city:           store.city || '',
      store_state:          store.state || '',
      store_zip:            store.zip || '',
      store_full_address:   fullAddress,
      store_contact_name:   store.owner_name || '',
      store_contact_title:  store.owner_title || '',
      event_start_date:     start ? fmtDateLong(start) : '',
      event_end_date:       end ? fmtDateLong(end) : '',
      event_dates_range:    start && end ? fmtDateRange(start, end) : (start ? fmtDateLong(start) : ''),
      buyer_names:          buyerNames,
      today_date:           fmtDateLong(todayIso),
    }
    const subject = applyBuyingMergeFields(tpl.subject_line, ctx)
    const body = applyBuyingMergeFields(tpl.body, ctx)

    if (dryRun) {
      scheduled.push({
        id: d.id, event_id: d.event_id, template_id: d.linked_template_id,
        store_name: store.name, due_date: d.due_date,
        to_email: store.owner_email,
        subject_preview: subject.slice(0, 80),
      })
      continue
    }

    const { error: insErr } = await sb.from('buying_communication_sends').insert({
      event_id:              d.event_id,
      template_id:           d.linked_template_id,
      sent_by_user_id:       senderUserId,
      from_email:            fromEmail,
      from_name:             fromName,
      to_email:              store.owner_email,
      to_name:               store.owner_name || null,
      cc_emails:             [],
      subject_line_rendered: subject,
      body_rendered:         body,
      delivery_status:       'scheduled',
      scheduled_for:         nowIso,
      scheduled_by_user_id:  senderUserId,
      scheduled_at:          nowIso,
      sent_at:               null,
    })
    if (insErr) {
      skipped.push({ id: d.id, reason: `insert_failed: ${insErr.message.slice(0, 200)}` })
      continue
    }
    scheduled.push({ id: d.id, event_id: d.event_id, template_id: d.linked_template_id })
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    claimed: due.length,
    scheduled: scheduled.length,
    skipped: skipped.length,
    items: { scheduled, skipped: skipped.slice(0, 20) },
  })
}

export async function GET(req: Request)  { return run(req) }
export async function POST(req: Request) { return run(req) }

// ─── Helpers ───
function fmtDateLong(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}
function fmtDateRange(startIso: string, endIso: string): string {
  if (!startIso || !endIso) return ''
  const s = new Date(startIso + 'T12:00:00')
  const e = new Date(endIso + 'T12:00:00')
  const sameMonth = s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()
  const month = s.toLocaleDateString('en-US', { month: 'long' })
  const year = e.getFullYear()
  if (sameMonth) return `${month} ${s.getDate()}–${e.getDate()}, ${year}`
  return `${fmtDateLong(startIso)} – ${fmtDateLong(endIso)}`
}
function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}
function firstName(full: string | null | undefined): string {
  if (!full) return ''
  return full.trim().split(/\s+/)[0]
}
