// POST /api/marketing/campaigns/[id]/proofs/upload
//
// Multipart form: { files: File[] (any number) }
//
// Creates a new marketing_proofs row at the next version_number with
// all uploaded files' Storage paths in file_urls[]. Marks any prior
// proofs is_latest=false. Notifies all active approvers via the
// marketing-approver-proof template.
//
// Auth: marketing_access required.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { resolveMarketingActor } from '@/lib/marketing/auth'
import { notifyApprovers, fmtDateRange, appBaseUrl } from '@/lib/marketing/notify'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

function safeFilename(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80)
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const sb = admin()

  const auth = await resolveMarketingActor(req, params.id)
  if (auth.reason) {
    const status = auth.reason === 'no_auth' ? 401 : auth.reason === 'no_marketing_access' ? 403 : 403
    return NextResponse.json({ error: auth.reason }, { status })
  }
  const actor = auth.actor

  let form: FormData
  try { form = await req.formData() }
  catch { return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 }) }

  // Accept either a single 'file' or multiple 'files' entries.
  const files = [
    ...form.getAll('files'),
    ...form.getAll('file'),
  ].filter((x): x is File => x instanceof File)
  if (files.length === 0) return NextResponse.json({ error: 'Attach at least one file.' }, { status: 400 })

  const { data: campaign } = await sb.from('marketing_campaigns')
    .select('id, event_id, flow_type, status, sub_status').eq('id', params.id).maybeSingle()
  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
  if (campaign.status !== 'proofing' && campaign.status !== 'planning') {
    // Allow proof uploads from planning too (spec lets the flow go
    // straight from approved planning into proofing — but if Collected
    // jumps the gun, we still accept and bump status).
    return NextResponse.json({ error: `Campaign is in ${campaign.status} — proof uploads not allowed here.` }, { status: 409 })
  }

  // Next version
  const { data: priorRows } = await sb.from('marketing_proofs')
    .select('version_number')
    .eq('campaign_id', campaign.id)
    .order('version_number', { ascending: false })
    .limit(1)
  const nextVersion = ((priorRows?.[0]?.version_number as number | undefined) || 0) + 1

  // Upload every file to Storage
  const uploadedPaths: string[] = []
  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    const safeName = safeFilename(f.name || `proof-v${nextVersion}-${i + 1}`)
    const path = `${campaign.event_id}/${campaign.id}/v${nextVersion}-${i + 1}-${safeName}`
    const buf = Buffer.from(await f.arrayBuffer())
    const { error } = await sb.storage.from('marketing-proofs').upload(path, buf, {
      contentType: f.type || 'application/octet-stream',
      upsert: false,
    })
    if (error) {
      // Roll back any already-uploaded files in this submission so we
      // don't leave orphans pointing nowhere.
      if (uploadedPaths.length > 0) {
        try { await sb.storage.from('marketing-proofs').remove(uploadedPaths) } catch {}
      }
      return NextResponse.json({ error: `Upload failed (${i + 1}/${files.length}): ${error.message}` }, { status: 500 })
    }
    uploadedPaths.push(path)
  }

  // Mark prior latest as not-latest
  await sb.from('marketing_proofs')
    .update({ is_latest: false })
    .eq('campaign_id', campaign.id)
    .eq('is_latest', true)

  // Insert the new proof row
  const { data: proofRow, error: insErr } = await sb.from('marketing_proofs').insert({
    campaign_id: campaign.id,
    version_number: nextVersion,
    is_latest: true,
    // Magic-link uploads don't have a user_id — leave null + record the
    // recipient email in a comment if needed later.
    uploaded_by: actor.userId ?? null,
    file_urls: uploadedPaths,
    status: 'pending',
  }).select('*').single()
  if (insErr || !proofRow) {
    // Roll back the storage objects since the row didn't make it.
    try { await sb.storage.from('marketing-proofs').remove(uploadedPaths) } catch {}
    return NextResponse.json({ error: insErr?.message || 'Insert failed' }, { status: 500 })
  }

  // Advance campaign to proofing/awaiting_proof_approval
  await sb.from('marketing_campaigns').update({
    status: 'proofing',
    sub_status: 'awaiting_proof_approval',
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

  // Reply-To routes approver "approve" replies through the Postmark
  // inbound webhook to /api/inbound-marketing-proofs. Operationally
  // requires Postmark inbound MX configured to forward to this domain.
  const replyTo = `proof-${proofRow.id}@updates.bebllp.com`

  const notify = await notifyApprovers({
    sb,
    templateId: 'marketing-approver-proof',
    vars: {
      store_name: storeName,
      date_range: dateRange,
      flow_type: campaign.flow_type,
      campaign_url: campaignUrl,
      version_number: nextVersion,
    },
    ctaLabel: 'Review Proof',
    replyTo,
  })

  return NextResponse.json({
    ok: true,
    proof: proofRow,
    notified: notify.sent,
    notify_failed: notify.failed,
    notify_errors: notify.errors.length > 0 ? notify.errors : undefined,
  })
}
