// POST /api/leads/[id]/convert
//
// Converts a buying-event or trunk-show lead into a real store +
// reserved (Save-the-Date) event/show.
//
// trade_show leads aren't handled here — they convert via the legacy
// Phase-16 trunk-show flow (which itself rolls into this endpoint
// eventually but isn't strictly required yet).
//
// Body:
//   {
//     start_date: 'YYYY-MM-DD',          // required
//     end_date?:  'YYYY-MM-DD',          // required for trunk_show
//     buyers_needed?: number,            // buying_event default 3
//     assigned_rep_id?: string | null,   // trunk_show only
//     notes?: string,
//   }
//
// Auth: caller must be admin/superadmin/partner (matches the leads_*
// RLS for these kinds).

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { blockIfImpersonating } from '@/lib/impersonation/server'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

interface Body {
  start_date?: string
  end_date?: string
  buyers_needed?: number
  assigned_rep_id?: string | null
  notes?: string
}

const ISO = /^\d{4}-\d{2}-\d{2}$/

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const blocked = await blockIfImpersonating(req)
  if (blocked) return blocked

  const sb = admin()
  const { data: caller } = await sb
    .from('users').select('role, is_partner').eq('id', me.id).maybeSingle()
  const allowed = caller?.role === 'admin' || caller?.role === 'superadmin' || !!caller?.is_partner
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: Body
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const startDate = String(body?.start_date || '').trim()
  if (!ISO.test(startDate)) return NextResponse.json({ error: 'start_date (YYYY-MM-DD) is required' }, { status: 400 })

  const { data: lead, error: leadErr } = await sb
    .from('leads')
    .select(`id, lead_kind, status, deleted_at,
             company_name, first_name, last_name,
             email, phone, store_phone, cell_phone,
             address_line_1, city, state, zip, website,
             best_time_of_year, freestanding, parking, year_established,
             sq_footage, currently_buys,
             locking_cases, rated_safe, sales_staff_count, years_in_business,
             sells_estate_jewelry, distance_to_airport_miles,
             converted_store_id, converted_trunk_show_store_id,
             converted_event_id, converted_trunk_show_id,
             notes, assigned_rep_id, captured_by_user_id`)
    .eq('id', params.id)
    .maybeSingle()
  if (leadErr) return NextResponse.json({ error: leadErr.message }, { status: 500 })
  if (!lead || lead.deleted_at) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
  if (lead.status === 'converted') return NextResponse.json({ error: 'Lead is already converted' }, { status: 409 })
  if (!lead.company_name) return NextResponse.json({ error: 'Lead is missing a store/company name' }, { status: 400 })

  if (lead.lead_kind === 'buying_event') {
    return await convertBuyingEvent(sb, lead, body, startDate, me.id)
  }
  if (lead.lead_kind === 'trunk_show') {
    return await convertTrunkShow(sb, lead, body, startDate, me.id)
  }
  return NextResponse.json({ error: `Convert not supported for lead_kind=${lead.lead_kind}` }, { status: 400 })
}

async function convertBuyingEvent(
  sb: ReturnType<typeof admin>,
  lead: any,
  body: Body,
  startDate: string,
  meId: string,
) {
  // Default brand = current portal brand. Stores has a NOT NULL
  // brand column; events copies it. We pull the caller's last-active
  // brand off settings.value (same default the rest of the app uses)
  // — fall back to 'beb' if missing.
  const brand = await resolveBrand(sb)

  // Look for an existing store with the same name + state to avoid
  // creating a dupe even after the AddLead-time warning was acked.
  let storeId: string | null = null
  if (lead.company_name) {
    const { data: existing } = await sb
      .from('stores')
      .select('id')
      .eq('brand', brand)
      .ilike('name', lead.company_name)
      .eq('state', lead.state || '')
      .limit(1)
    if (existing && existing.length) storeId = existing[0].id
  }

  if (!storeId) {
    const { data: storeRow, error: storeErr } = await sb
      .from('stores')
      .insert({
        brand,
        name: lead.company_name,
        address: lead.address_line_1 || '',
        city: lead.city || '',
        state: (lead.state || '').toUpperCase(),
        zip: lead.zip || '',
        website: lead.website || '',
        owner_phone: lead.store_phone || lead.phone || '',
      })
      .select('id')
      .single()
    if (storeErr) return NextResponse.json({ error: `Store create failed: ${storeErr.message}` }, { status: 500 })
    storeId = storeRow.id
  }

  const buyersNeeded = Number.isFinite(body?.buyers_needed) && (body!.buyers_needed as number) > 0
    ? Math.min(20, Math.floor(body!.buyers_needed as number))
    : 3

  const { data: ev, error: evErr } = await sb
    .from('events')
    .insert({
      brand,
      store_id: storeId,
      store_name: lead.company_name,
      start_date: startDate,
      buyers_needed: buyersNeeded,
      created_by: meId,
      status: 'reserved',
    })
    .select('id')
    .single()
  if (evErr) return NextResponse.json({ error: `Event create failed: ${evErr.message}` }, { status: 500 })

  await sb.from('leads').update({
    status: 'converted',
    converted_at: new Date().toISOString(),
    converted_store_id: storeId,
    converted_event_id: ev.id,
    converted_to_store_id: storeId,
  }).eq('id', lead.id)

  return NextResponse.json({
    ok: true,
    store_id: storeId,
    event_id: ev.id,
  })
}

async function convertTrunkShow(
  sb: ReturnType<typeof admin>,
  lead: any,
  body: Body,
  startDate: string,
  _meId: string,
) {
  const endDate = String(body?.end_date || startDate).trim()
  if (!ISO.test(endDate)) return NextResponse.json({ error: 'end_date (YYYY-MM-DD) is required' }, { status: 400 })
  if (endDate < startDate) return NextResponse.json({ error: 'end_date must be on or after start_date' }, { status: 400 })

  // Reuse an existing trunk_show_store on name+state if there is one.
  let tssId: string | null = null
  {
    const { data: existing } = await sb
      .from('trunk_show_stores')
      .select('id')
      .ilike('name', lead.company_name)
      .eq('state', (lead.state || '').toUpperCase())
      .limit(1)
    if (existing && existing.length) tssId = existing[0].id
  }

  if (!tssId) {
    const { data: tssRow, error: tssErr } = await sb
      .from('trunk_show_stores')
      .insert({
        name: lead.company_name,
        trunk_shows: true,
        address_1: lead.address_line_1 || null,
        city: lead.city || null,
        state: (lead.state || '').toUpperCase() || null,
        zip: lead.zip || null,
        url: lead.website || null,
        store_phone: lead.store_phone || lead.phone || null,
        primary_contact_name: [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim() || null,
        primary_contact_email: lead.email || null,
        contact_1: [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim() || null,
        email_1: lead.email || null,
      })
      .select('id')
      .single()
    if (tssErr) return NextResponse.json({ error: `Trunk-show store create failed: ${tssErr.message}` }, { status: 500 })
    tssId = tssRow.id
  }

  const assignedRepId = (body?.assigned_rep_id ?? lead.assigned_rep_id) || null
  const notes = body?.notes || lead.notes || null

  const { data: ts, error: tsErr } = await sb
    .from('trunk_shows')
    .insert({
      store_id: tssId,
      start_date: startDate,
      end_date: endDate,
      assigned_rep_id: assignedRepId,
      status: 'reserved',
      notes,
    })
    .select('id')
    .single()
  if (tsErr) return NextResponse.json({ error: `Trunk-show create failed: ${tsErr.message}` }, { status: 500 })

  // Seed default 10–5 hours rows so the reserved show matches the
  // shape produced by the normal create flow.
  const dates = enumerateDates(startDate, endDate)
  if (dates.length > 0) {
    await sb.from('trunk_show_hours').insert(
      dates.map(d => ({
        trunk_show_id: ts.id,
        show_date: d,
        open_time: '10:00:00',
        close_time: '17:00:00',
      })),
    )
  }

  await sb.from('leads').update({
    status: 'converted',
    converted_at: new Date().toISOString(),
    converted_trunk_show_store_id: tssId,
    converted_trunk_show_id: ts.id,
  }).eq('id', lead.id)

  return NextResponse.json({
    ok: true,
    trunk_show_store_id: tssId,
    trunk_show_id: ts.id,
  })
}

async function resolveBrand(sb: ReturnType<typeof admin>): Promise<string> {
  // The portal stores the current brand in settings.value.activeBrand.
  // If unavailable, fall back to 'beb' (the dominant brand in the
  // dataset). Only used for the new store row's brand column.
  try {
    const { data } = await sb.from('settings').select('value').eq('key', 'activeBrand').maybeSingle()
    const v: any = data?.value
    if (typeof v === 'string' && v) return v
    if (v?.value) return v.value
  } catch { /* ignore */ }
  return 'beb'
}

function enumerateDates(startIso: string, endIso: string): string[] {
  const out: string[] = []
  const start = new Date(startIso + 'T12:00:00')
  const end = new Date(endIso + 'T12:00:00')
  for (let d = new Date(start); d.getTime() <= end.getTime(); d.setDate(d.getDate() + 1)) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
  }
  return out
}
