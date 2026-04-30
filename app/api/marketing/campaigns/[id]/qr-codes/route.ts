// GET /api/marketing/campaigns/[id]/qr-codes
//
// Returns the (read-only) QR codes for the campaign's event's store.
// Dual-auth: authed user with marketing_access OR magic-link token
// scoped to this campaign.
//
// QR codes table is admin-RLS by default — using the service role
// here bypasses that, scoped to the specific store via the join chain.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { resolveMarketingActor } from '@/lib/marketing/auth'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const sb = admin()

  const auth = await resolveMarketingActor(req, params.id)
  if (auth.reason) {
    const status = auth.reason === 'no_auth' ? 401 : 403
    return NextResponse.json({ error: auth.reason }, { status })
  }

  // Resolve the campaign's event → store_id, then fetch active QR
  // codes for that store. QR codes attach to stores (or store groups);
  // for v1 we only surface store-scoped codes — group-scoped codes
  // would require an additional store_group_members lookup.
  const { data: campaign } = await sb.from('marketing_campaigns')
    .select('event_id').eq('id', params.id).maybeSingle()
  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

  const { data: event } = await sb.from('events')
    .select('store_id').eq('id', campaign.event_id).maybeSingle()
  if (!event?.store_id) {
    return NextResponse.json({ qr_codes: [], reason: 'event_has_no_store' })
  }

  const { data: codes } = await sb.from('qr_codes')
    .select('id, code, type, lead_source, custom_label, label, active')
    .eq('store_id', event.store_id)
    .is('deleted_at', null)
    .order('label', { ascending: true })

  return NextResponse.json({ qr_codes: codes ?? [] })
}
