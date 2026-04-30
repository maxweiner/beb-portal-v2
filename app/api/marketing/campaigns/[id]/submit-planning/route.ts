// POST /api/marketing/campaigns/[id]/submit-planning
//
// Body: { vdp_count?: number, zip_codes?: string[], postcard_count?: number }
//
// Persists the planning inputs (VDP: count + zip list; Postcard:
// just the count for now — Phase 5 expands postcard with the master
// list flow), advances status to 'planning' / sub_status =
// 'awaiting_planning_approval', and emails active approvers.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { resolveMarketingActor } from '@/lib/marketing/auth'
import { notifyApprovers, fmtDateRange, appBaseUrl } from '@/lib/marketing/notify'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const sb = admin()

  const auth = await resolveMarketingActor(req, params.id)
  if (auth.reason) {
    const status = auth.reason === 'no_auth' ? 401 : 403
    return NextResponse.json({ error: auth.reason }, { status })
  }
  const actor = auth.actor

  let body: any
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { data: campaign } = await sb.from('marketing_campaigns')
    .select('id, event_id, flow_type, status').eq('id', params.id).maybeSingle()
  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

  const nowIso = new Date().toISOString()

  if (campaign.flow_type === 'vdp') {
    const vdpCount = Number(body?.vdp_count)
    if (!Number.isFinite(vdpCount) || vdpCount < 0) {
      return NextResponse.json({ error: 'vdp_count must be a non-negative number' }, { status: 400 })
    }
    const rawZips: string[] = Array.isArray(body?.zip_codes) ? body.zip_codes : []
    const zips = Array.from(new Set(
      rawZips.map(z => (z ?? '').toString().trim()).filter(z => /^\d{5}$/.test(z))
    ))
    if (zips.length === 0) {
      return NextResponse.json({ error: 'At least one valid 5-digit zip code is required.' }, { status: 400 })
    }

    // Upsert the details row (clear any prior approval — this is a new submission)
    const { error: detErr } = await sb.from('vdp_campaign_details').upsert({
      campaign_id: campaign.id,
      vdp_count: vdpCount,
      submitted_at: nowIso,
      submitted_by: actor.userId ?? null,
      approved_at: null,
      approved_by: null,
    }, { onConflict: 'campaign_id' })
    if (detErr) return NextResponse.json({ error: detErr.message }, { status: 500 })

    // Replace zip list
    await sb.from('vdp_zip_codes').delete().eq('campaign_id', campaign.id)
    if (zips.length > 0) {
      const { error: zErr } = await sb.from('vdp_zip_codes')
        .insert(zips.map(z => ({ campaign_id: campaign.id, zip_code: z })))
      if (zErr) return NextResponse.json({ error: zErr.message }, { status: 500 })
    }
  } else if (campaign.flow_type === 'postcard') {
    // Phase 5 postcard planning: filter settings drive the recipient
    // count from the store's master list. Body:
    //   { max_age_days?: number, max_proximity_miles?: number }
    const maxAge = body?.max_age_days != null ? Number(body.max_age_days) : null
    const maxProx = body?.max_proximity_miles != null ? Number(body.max_proximity_miles) : null
    if (maxAge != null && (!Number.isFinite(maxAge) || maxAge < 0)) {
      return NextResponse.json({ error: 'max_age_days must be a non-negative number' }, { status: 400 })
    }
    if (maxProx != null && (!Number.isFinite(maxProx) || maxProx < 0)) {
      return NextResponse.json({ error: 'max_proximity_miles must be a non-negative number' }, { status: 400 })
    }

    // Resolve store + count matching addresses with the same filter logic
    // the UI uses for the live preview.
    const { data: ev } = await sb.from('events').select('store_id').eq('id', campaign.event_id).maybeSingle()
    const storeId = ev?.store_id
    if (!storeId) return NextResponse.json({ error: 'Event has no store' }, { status: 400 })

    let q = sb.from('store_postcard_lists').select('id', { count: 'exact', head: true }).eq('store_id', storeId)
    if (maxAge != null) {
      const cutoff = new Date(Date.now() - maxAge * 24 * 60 * 60 * 1000).toISOString()
      q = q.gte('created_at', cutoff)
    }
    // Proximity intentionally unenforced server-side in v1 — needs
    // geocoded lat/lng on store_postcard_lists which we haven't shipped
    // yet. Selected value still persists for future use.
    const { count, error: countErr } = await q
    if (countErr) return NextResponse.json({ error: countErr.message }, { status: 500 })

    const { error: detErr } = await sb.from('postcard_campaign_details').upsert({
      campaign_id: campaign.id,
      postcard_count: count ?? 0,
      submitted_at: nowIso,
      submitted_by: actor.userId ?? null,
      approved_at: null,
      approved_by: null,
      selected_filter_max_record_age_days: maxAge,
      selected_filter_max_proximity_miles: maxProx,
    }, { onConflict: 'campaign_id' })
    if (detErr) return NextResponse.json({ error: detErr.message }, { status: 500 })
  } else if (campaign.flow_type === 'newspaper') {
    // Newspaper planning is just the publication name. Approval flow
    // is the same single-approver loop as VDP/Postcard.
    const publication = (body?.publication_name ?? '').toString().trim()
    if (!publication) {
      return NextResponse.json({ error: 'publication_name is required.' }, { status: 400 })
    }
    const { error: detErr } = await sb.from('newspaper_campaign_details').upsert({
      campaign_id: campaign.id,
      publication_name: publication,
      submitted_at: nowIso,
      submitted_by: actor.userId ?? null,
      approved_at: null,
      approved_by: null,
    }, { onConflict: 'campaign_id' })
    if (detErr) return NextResponse.json({ error: detErr.message }, { status: 500 })
  } else {
    return NextResponse.json({ error: `Submit not implemented for flow_type=${campaign.flow_type}` }, { status: 400 })
  }

  // Advance campaign state
  await sb.from('marketing_campaigns').update({
    status: 'planning',
    sub_status: 'awaiting_planning_approval',
  }).eq('id', campaign.id)

  // Notify approvers
  const { data: event } = await sb.from('events')
    .select('store_id, store_name, start_date').eq('id', campaign.event_id).maybeSingle()
  const { data: store } = event?.store_id
    ? await sb.from('stores').select('name').eq('id', event.store_id).maybeSingle()
    : { data: null as any }
  const storeName = store?.name || event?.store_name || '(unknown store)'
  const dateRange = event?.start_date ? fmtDateRange(event.start_date) : ''
  const campaignUrl = `${appBaseUrl()}/?nav=marketing&campaign=${campaign.id}`

  const notify = await notifyApprovers({
    sb,
    templateId: 'marketing-approver-planning',
    vars: {
      store_name: storeName,
      date_range: dateRange,
      flow_type: campaign.flow_type,
      campaign_url: campaignUrl,
    },
    ctaLabel: 'Review Planning',
  })

  return NextResponse.json({
    ok: true,
    notified: notify.sent,
    notify_failed: notify.failed,
    notify_errors: notify.errors.length > 0 ? notify.errors : undefined,
  })
}
