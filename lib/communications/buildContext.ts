// Resolves the real-data MergeContext for a trunk-show + rep
// pair, used by the send pipeline (phase 5) and any client-side
// "preview as it will actually send" view.
//
// Mirrors the shape of SAMPLE_FIXTURE in mergeFields.ts so a
// template that previews cleanly on the editor will fill cleanly
// at send time.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { MergeContext } from './mergeFields'

interface BuildArgs {
  sb: SupabaseClient
  trunkShowId: string
  /** Rep user_id whose name/email/phone will populate {rep_*}.
   *  Typically the sender. Falls back to the trunk show's
   *  assigned_rep_id when not provided. */
  repUserId?: string | null
}

export interface BuildContextResult {
  ctx: MergeContext
  /** Primary recipient (first contact flagged send_documents=true,
   *  or fallback). Always populated when at least one valid email
   *  is on file. */
  recipient: {
    email: string | null
    name: string | null
  }
  /** Every contact flagged send_documents=true (with a non-empty
   *  email), in array order. Used by the send pipeline to address
   *  multiple recipients. Falls back to a single-element list
   *  matching `recipient` when the contacts array is empty. */
  recipients: { email: string; name: string | null }[]
  /** Sender resolution (already in ctx.rep_*; pulled out for
   *  the `from` header). */
  sender: {
    email: string | null
    name: string | null
    phone: string | null
  }
}

export async function buildMergeContext({
  sb, trunkShowId, repUserId,
}: BuildArgs): Promise<BuildContextResult> {
  // Trunk show
  const { data: ts } = await sb
    .from('trunk_shows')
    .select('id, store_id, start_date, end_date, assigned_rep_id')
    .eq('id', trunkShowId)
    .maybeSingle()
  if (!ts) throw new Error(`Trunk show ${trunkShowId} not found`)

  // Store
  const { data: store } = await sb
    .from('trunk_show_stores')
    .select('name, address_1, city, state, zip, primary_contact_name, primary_contact_email, contact_1, email_1, contacts')
    .eq('id', ts.store_id)
    .maybeSingle()

  // Rep — explicit override OR assigned
  const effectiveRepId = repUserId || ts.assigned_rep_id
  let rep: { name: string | null; email: string | null; phone: string | null } = {
    name: null, email: null, phone: null,
  }
  if (effectiveRepId) {
    const { data } = await sb
      .from('users')
      .select('name, email, phone')
      .eq('id', effectiveRepId)
      .maybeSingle()
    if (data) rep = data as any
  }

  // Hours
  const { data: hours } = await sb
    .from('trunk_show_hours')
    .select('show_date, open_time, close_time')
    .eq('trunk_show_id', ts.id)
    .order('show_date')

  const storeName = store?.name || ''
  const addr1    = store?.address_1 || ''
  const city     = store?.city || ''
  const state    = store?.state || ''
  const zip      = store?.zip || ''

  const fullAddress = [
    addr1,
    [city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', '),
  ].filter(Boolean).join('\n')

  // Resolve recipients. Source of truth is the new contacts JSONB
  // array — every entry with send_documents=true and a non-empty
  // email becomes a recipient. Falls back to primary_contact_*
  // and then to legacy email_1/contact_1 when the array is empty.
  const contactsArr = Array.isArray(store?.contacts) ? (store!.contacts as any[]) : []
  const flagged = contactsArr.filter(c => c?.send_documents && typeof c?.email === 'string' && c.email.trim())
  let recipients = flagged.map(c => ({
    email: String(c.email).trim(),
    name: (typeof c?.name === 'string' && c.name.trim()) ? c.name.trim() : null,
  }))
  if (recipients.length === 0) {
    const fallbackEmail = store?.primary_contact_email || store?.email_1 || null
    const fallbackName  = store?.primary_contact_name  || store?.contact_1 || null
    if (fallbackEmail) {
      recipients = [{ email: fallbackEmail, name: fallbackName }]
    }
  }
  const recipientEmail = recipients[0]?.email ?? null
  const recipientName  = recipients[0]?.name  ?? null

  const ctx: MergeContext = {
    store_name:           storeName,
    store_address_line_1: addr1,
    store_city:           city,
    store_state:          state,
    store_zip:            zip,
    store_full_address:   fullAddress,
    store_contact_name:   recipientName || '',
    store_contact_title:  '',  // not in schema today
    event_start_date:     formatDateLong(ts.start_date),
    event_end_date:       formatDateLong(ts.end_date),
    event_dates_range:    formatRange(ts.start_date, ts.end_date),
    event_hours_per_day:  formatHours(hours || []),
    rep_name:             rep.name || '',
    rep_email:            rep.email || '',
    rep_phone:            rep.phone || '',
    today_date:           formatDateLong(new Date().toISOString().slice(0, 10)),
  }

  return {
    ctx,
    recipient: { email: recipientEmail, name: recipientName },
    recipients,
    sender:    { email: rep.email, name: rep.name, phone: rep.phone },
  }
}

// ── Date helpers ─────────────────────────────────────────────

function formatDateLong(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

function formatRange(startIso: string | null, endIso: string | null): string {
  if (!startIso) return ''
  if (!endIso || startIso === endIso) return formatDateLong(startIso)
  const s = new Date(startIso + 'T12:00:00')
  const e = new Date(endIso   + 'T12:00:00')
  const sm = s.toLocaleDateString('en-US', { month: 'long' })
  const em = e.toLocaleDateString('en-US', { month: 'long' })
  const yr = s.getFullYear()
  if (sm === em) {
    return `${sm} ${s.getDate()}–${e.getDate()}, ${yr}`
  }
  // Cross-month: "Feb 28 – Mar 2, 2026"
  const smShort = s.toLocaleDateString('en-US', { month: 'short' })
  const emShort = e.toLocaleDateString('en-US', { month: 'short' })
  return `${smShort} ${s.getDate()} – ${emShort} ${e.getDate()}, ${yr}`
}

function formatHours(rows: { show_date: string; open_time: string; close_time: string }[]): string {
  if (rows.length === 0) return ''
  return rows.map(r => {
    const d = new Date(r.show_date + 'T12:00:00')
    const day = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    const o = formatTime12h(r.open_time)
    const c = formatTime12h(r.close_time)
    return `${day}: ${o} – ${c}`
  }).join('\n')
}

function formatTime12h(hms: string): string {
  // Accepts "HH:MM" or "HH:MM:SS" — common Postgres TIME formats.
  const [hStr, mStr] = hms.split(':')
  let h = Number(hStr)
  const m = Number(mStr || '0')
  const ampm = h >= 12 ? 'PM' : 'AM'
  if (h === 0) h = 12
  else if (h > 12) h -= 12
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`
}
