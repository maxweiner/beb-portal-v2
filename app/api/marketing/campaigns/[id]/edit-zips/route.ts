// POST /api/marketing/campaigns/[id]/edit-zips
//
// Body: { zip_codes: string[] }
// → 200 { ok: true, zip_codes: string[], added: string[], removed: string[] }
//
// Edits a VDP campaign's zip-code list AFTER initial approval. Used
// by the "✏️ Edit zips" affordance on the read-only summary in
// VDPPlanningSection — operators sometimes need to drop a zip that
// was returned undeliverable, add one they missed, etc.
//
// Side effects:
//   1. Replaces the vdp_zip_codes rows for this campaign with the
//      new list (DELETE + INSERT — same pattern submit-planning uses).
//   2. Stamps vdp_campaign_details.zips_last_edited_at / _by so the
//      UI can show a "last edited" chip.
//   3. Emails ALL superadmin users a diff of what changed (added /
//      removed zips, who edited, link back to the campaign).
//
// Auth: same `resolveMarketingActor` gate every other marketing
// route uses — must have marketing access AND not be impersonating.
//
// Limitations: VDP-only for now. Postcard / newspaper campaigns
// don't have a zip-code list to edit.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { resolveMarketingActor } from '@/lib/marketing/auth'
import { blockIfImpersonating } from '@/lib/impersonation/server'
import { sendEmail } from '@/lib/email'
import { appBaseUrl } from '@/lib/marketing/notify'

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

  const blocked = await blockIfImpersonating(req)
  if (blocked) return blocked

  let body: any
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  // Load campaign + verify it's a VDP campaign + load event/store
  // metadata for the email body.
  const { data: campaign } = await sb.from('marketing_campaigns')
    .select('id, event_id, flow_type, status').eq('id', params.id).maybeSingle()
  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
  if (campaign.flow_type !== 'vdp') {
    return NextResponse.json({ error: 'edit-zips is VDP-only' }, { status: 400 })
  }

  // Normalize + dedupe + validate the incoming list.
  const rawZips: string[] = Array.isArray(body?.zip_codes) ? body.zip_codes : []
  const nextZips = Array.from(new Set(
    rawZips.map(z => (z ?? '').toString().trim()).filter(z => /^\d{5}$/.test(z))
  )).sort()
  if (nextZips.length === 0) {
    return NextResponse.json({ error: 'At least one valid 5-digit zip code is required.' }, { status: 400 })
  }

  // Load existing zips for diff.
  const { data: existingRows } = await sb.from('vdp_zip_codes')
    .select('zip_code').eq('campaign_id', campaign.id)
  const existing = ((existingRows || []) as { zip_code: string }[]).map(r => r.zip_code).sort()
  const existingSet = new Set(existing)
  const nextSet = new Set(nextZips)
  const added = nextZips.filter(z => !existingSet.has(z))
  const removed = existing.filter(z => !nextSet.has(z))

  // No-op check — saves a DELETE + INSERT + email when the user hit
  // Save without actually changing anything.
  if (added.length === 0 && removed.length === 0) {
    return NextResponse.json({ ok: true, zip_codes: nextZips, added, removed, noop: true })
  }

  // Replace the zip list. DELETE + INSERT mirrors submit-planning's
  // approach — simpler than diff-based updates and the table is
  // small (a few hundred zips at most).
  const { error: delErr } = await sb.from('vdp_zip_codes')
    .delete().eq('campaign_id', campaign.id)
  if (delErr) return NextResponse.json({ error: `Delete: ${delErr.message}` }, { status: 500 })

  const { error: insErr } = await sb.from('vdp_zip_codes')
    .insert(nextZips.map(z => ({ campaign_id: campaign.id, zip_code: z })))
  if (insErr) return NextResponse.json({ error: `Insert: ${insErr.message}` }, { status: 500 })

  // Stamp the edit-tracking columns on vdp_campaign_details. Upsert
  // in case the details row doesn't exist yet (shouldn't happen
  // post-approval but defensive).
  const nowIso = new Date().toISOString()
  await sb.from('vdp_campaign_details').upsert({
    campaign_id: campaign.id,
    zips_last_edited_at: nowIso,
    zips_last_edited_by: actor.userId ?? null,
  }, { onConflict: 'campaign_id' })

  // ── Email superadmins ────────────────────────────────────────
  // Best-effort: if email fails we still return success — the data
  // change went through, the audit notification is a nice-to-have.
  try {
    // Load actor name for the email body.
    let actorName = 'A user'
    let actorEmail: string | null = null
    if (actor.userId) {
      const { data: actorRow } = await sb.from('users')
        .select('name, email').eq('id', actor.userId).maybeSingle()
      if (actorRow) {
        actorName = (actorRow as any).name || (actorRow as any).email || actorName
        actorEmail = (actorRow as any).email || null
      }
    }

    // Pull all active superadmins. Strict role check; ignores
    // is_partner — Max wanted "superadmins" specifically.
    const { data: supers } = await sb.from('users')
      .select('email').eq('role', 'superadmin').not('email', 'is', null)
    const superEmails = Array.from(new Set(
      ((supers || []) as { email: string }[])
        .map(r => r.email).filter(Boolean)
    ))

    if (superEmails.length > 0) {
      // Pull event + store names for richer subject / body.
      const { data: ev } = await sb.from('events')
        .select('id, store_id, start_date').eq('id', campaign.event_id).maybeSingle()
      let storeName = ''
      if (ev?.store_id) {
        const { data: s } = await sb.from('stores').select('name').eq('id', ev.store_id).maybeSingle()
        storeName = (s as any)?.name || ''
      }
      const dateStr = ev?.start_date
        ? new Date(ev.start_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : ''

      const base = appBaseUrl()
      const campaignUrl = `${base}/marketing?campaign=${campaign.id}`

      const subject = `VDP zip list edited — ${storeName || 'campaign'}${dateStr ? ` · ${dateStr}` : ''}`
      const html = buildEmailHtml({
        storeName, dateStr,
        actorName, actorEmail,
        added, removed,
        beforeCount: existing.length,
        afterCount: nextZips.length,
        campaignUrl,
      })
      await sendEmail({ to: superEmails, subject, html })
    }
  } catch (e) {
    console.warn('[edit-zips] superadmin email failed (non-fatal):', e)
  }

  return NextResponse.json({
    ok: true,
    zip_codes: nextZips,
    added,
    removed,
    last_edited_at: nowIso,
  })
}

function buildEmailHtml(args: {
  storeName: string
  dateStr: string
  actorName: string
  actorEmail: string | null
  added: string[]
  removed: string[]
  beforeCount: number
  afterCount: number
  campaignUrl: string
}): string {
  const { storeName, dateStr, actorName, actorEmail, added, removed, beforeCount, afterCount, campaignUrl } = args
  const subjectLine = storeName || 'VDP campaign'
  const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const zipChips = (zs: string[], bg: string, fg: string) => zs.length === 0
    ? `<span style="color:#9ca3af; font-size:12px;">(none)</span>`
    : zs.map(z => `<span style="display:inline-block; background:${bg}; color:${fg}; padding:2px 8px; border-radius:99px; font-weight:700; font-size:12px; margin:2px 4px 2px 0;">${escapeHtml(z)}</span>`).join('')

  return `<!DOCTYPE html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color: #1f2937; max-width: 600px; margin: 0 auto; padding: 24px;">
  <p style="margin: 0 0 12px; font-size: 13px; color: #6b7280;">Audit alert · superadmins only</p>
  <h2 style="margin: 0 0 14px; font-size: 18px;">VDP zip list edited</h2>
  <p style="margin: 0 0 8px;">
    <strong>${escapeHtml(actorName)}</strong>${actorEmail ? ` <span style="color:#6b7280;">&lt;${escapeHtml(actorEmail)}&gt;</span>` : ''}
    edited the zip-code list for the VDP campaign
    ${storeName ? `at <strong>${escapeHtml(storeName)}</strong>` : ''}${dateStr ? ` (${escapeHtml(dateStr)})` : ''}.
  </p>
  <p style="margin: 0 0 16px; font-size: 13px; color: #6b7280;">
    Zip count: ${beforeCount} → ${afterCount}
    (${added.length} added, ${removed.length} removed)
  </p>

  ${added.length > 0 ? `
    <div style="margin-bottom: 14px;">
      <div style="font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .05em; color: #047857; margin-bottom: 6px;">Added (${added.length})</div>
      <div>${zipChips(added, '#D1FAE5', '#065F46')}</div>
    </div>` : ''}

  ${removed.length > 0 ? `
    <div style="margin-bottom: 14px;">
      <div style="font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .05em; color: #B91C1C; margin-bottom: 6px;">Removed (${removed.length})</div>
      <div>${zipChips(removed, '#FEE2E2', '#991B1B')}</div>
    </div>` : ''}

  <p style="margin: 24px 0;">
    <a href="${campaignUrl}"
       style="display:inline-block; background:#1D6B44; color:#fff; padding:10px 18px; border-radius:8px; text-decoration:none; font-weight:700;">
      Open campaign →
    </a>
  </p>
  <p style="margin: 16px 0 0; font-size: 12px; color: #9ca3af;">
    You're receiving this because you're a superadmin on the BEB Portal. Zip-list edits to approved VDP campaigns trigger this notification automatically.
  </p>
</body></html>`
}
