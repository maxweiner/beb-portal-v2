// POST /api/marketing-proofs/upload
//
// Two access modes:
//   - Vendor: include `token` form field (the event's marketing_token).
//     The route verifies the campaign belongs to that event.
//   - Admin: omit `token`; provide an `Authorization: Bearer <jwt>`
//     header. The route verifies admin/superadmin role.
//
// FormData fields: { file: File, campaign_id: string, token?: string }
//
// Uploads the file to the private 'marketing-proofs' bucket at
// `{event_id}/{campaign_id}/v{version}-{filename}`, inserts a
// marketing_proofs row pointing at it, and returns the new row.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser, isAdminLike } from '@/lib/expenses/serverAuth'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

function safeFilename(name: string): string {
  // Strip directory traversal + non-portable chars. Keep extension.
  return name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80)
}

export async function POST(req: Request) {
  let form: FormData
  try { form = await req.formData() }
  catch { return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 }) }

  const file = form.get('file')
  const campaignId = (form.get('campaign_id') || '').toString()
  const token = (form.get('token') || '').toString()
  if (!(file instanceof File)) return NextResponse.json({ error: 'Missing file' }, { status: 400 })
  if (!campaignId) return NextResponse.json({ error: 'Missing campaign_id' }, { status: 400 })

  const sb = admin()

  // Resolve the campaign + parent event up front; both flows need it.
  const { data: campaign, error: campErr } = await sb
    .from('marketing_campaigns')
    .select('id, event_id')
    .eq('id', campaignId)
    .maybeSingle()
  if (campErr || !campaign) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
  }

  // ── Auth gate ──
  if (token) {
    // Vendor flow: token must match the campaign's event.
    const { data: ev } = await sb.from('events')
      .select('id, marketing_token')
      .eq('id', campaign.event_id)
      .maybeSingle()
    if (!ev || ev.marketing_token !== token) {
      return NextResponse.json({ error: 'Invalid token for this campaign' }, { status: 403 })
    }
  } else {
    // Admin flow: require an authed admin session.
    const me = await getAuthedUser(req)
    if (!isAdminLike(me)) {
      return NextResponse.json({ error: 'Admins only' }, { status: 403 })
    }
  }

  // Compute the next version for this campaign so the path + row stay
  // consistent.
  const { data: existing } = await sb.from('marketing_proofs')
    .select('version')
    .eq('campaign_id', campaignId)
    .order('version', { ascending: false })
    .limit(1)
  const nextVersion = ((existing?.[0]?.version as number | undefined) || 0) + 1

  const filename = safeFilename(file.name || `proof-v${nextVersion}`)
  const storagePath = `${campaign.event_id}/${campaignId}/v${nextVersion}-${filename}`

  const buffer = Buffer.from(await file.arrayBuffer())
  const { error: upErr } = await sb.storage
    .from('marketing-proofs')
    .upload(storagePath, buffer, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    })
  if (upErr) {
    return NextResponse.json({ error: `Upload failed: ${upErr.message}` }, { status: 500 })
  }

  const { data: row, error: insErr } = await sb.from('marketing_proofs').insert({
    campaign_id: campaignId,
    version: nextVersion,
    storage_path: storagePath,
    // file_url is legacy; leave NULL for new rows so the UI knows to
    // fetch a signed URL via the storage_path branch.
    file_url: null,
    file_name: file.name || filename,
    status: 'pending',
  }).select('*').single()

  if (insErr || !row) {
    // Try to clean up the orphaned object so we don't leak storage.
    try { await sb.storage.from('marketing-proofs').remove([storagePath]) }
    catch { /* swallow */ }
    return NextResponse.json({ error: insErr?.message || 'Insert failed' }, { status: 500 })
  }

  // Bump the campaign's status to proof_pending the same way the old
  // direct-insert flow did. Best-effort.
  try {
    await sb.from('marketing_campaigns')
      .update({ status: 'proof_pending' })
      .eq('id', campaignId)
  } catch { /* swallow */ }

  return NextResponse.json({ ok: true, proof: row })
}
