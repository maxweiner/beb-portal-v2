// GET /api/marketing/magic/[token]
//
// Public endpoint — no auth. Resolves the magic_link_tokens row and
// returns enough campaign context for the public /marketing/[token]
// page to render. Bumps last_used_at on the token.
//
// Returns:
//   200 { campaign, event, store, recipientEmail, expiresAt }
//   404 { error: 'token_invalid' }
//   410 { error: 'token_expired' }

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const sb = admin()
  const token = params.token

  const { data: row } = await sb.from('magic_link_tokens')
    .select('id, campaign_id, email, expires_at')
    .eq('token', token).maybeSingle()
  if (!row) return NextResponse.json({ error: 'token_invalid' }, { status: 404 })
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: 'token_expired', expires_at: row.expires_at }, { status: 410 })
  }

  const { data: campaign } = await sb.from('marketing_campaigns')
    .select('*').eq('id', row.campaign_id).maybeSingle()
  if (!campaign) return NextResponse.json({ error: 'campaign_missing' }, { status: 404 })

  const { data: event } = await sb.from('events')
    .select('id, store_id, store_name, start_date').eq('id', campaign.event_id).maybeSingle()
  const { data: store } = event?.store_id
    ? await sb.from('stores').select('id, name, address, city, state, zip').eq('id', event.store_id).maybeSingle()
    : { data: null as any }

  // Best-effort touch
  await sb.from('magic_link_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', row.id)

  return NextResponse.json({
    campaign,
    event,
    store,
    recipientEmail: row.email,
    expiresAt: row.expires_at,
  })
}
