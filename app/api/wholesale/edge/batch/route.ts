// POST /api/wholesale/edge/batch
//   Body: {
//     brand: 'liberty',
//     item_ids: string[],
//     recipient_email: string,
//     recipient_name?: string,
//     cc_emails?: string[],
//     bcc_emails?: string[],
//     notes?: string,
//   }
//   → 200 { ok: true, batch: { id, batch_code, public_token, ... } }
//
// What happens server-side (all in one request):
//   1. Auth + wholesale-access check
//   2. Load each item w/ vendor + stones, build EdgeBatchItemSnapshot
//   3. Mint batch_code + public_token, INSERT edge_batches (status='draft')
//   4. INSERT edge_batch_items rows
//   5. Copy photos into edge-batches/{batch_code}/ with friendly names
//   6. Generate CSV, upload it to the batch folder as well
//   7. Send the email via Resend
//   8. UPDATE edge_batches → status='sent', sent_at, csv_path, item/photo counts
//
// GET /api/wholesale/edge/batch?brand=liberty&limit=50
//   → 200 { batches: EdgeBatch[] }

import { NextResponse } from 'next/server'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { pdfAdmin, PHOTO_BUCKET } from '@/lib/wholesale/pdfHelpers'
import { mintBatchCode, mintPublicToken } from '@/lib/wholesale/edgeBatchCode'
import { buildSnapshot } from '@/lib/wholesale/edgeSnapshot'
import { buildCsv } from '@/lib/wholesale/edgeCsv'
import { bundleBatchPhotos } from '@/lib/wholesale/edgePhotos'
import { sendBatchEmail } from '@/lib/wholesale/edgeEmail'

export const dynamic = 'force-dynamic'
export const maxDuration = 300  // photo copies can run long on bigger batches

function hasWholesaleAccess(me: any): boolean {
  if (!me) return false
  if (me.role === 'superadmin' || me.role === 'admin') return true
  if (me.is_partner === true) return true
  if (me.inventory_access === true) return true
  return false
}

export async function POST(req: Request) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasWholesaleAccess(me)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => null) as any
  if (!body) return NextResponse.json({ error: 'Bad JSON' }, { status: 400 })

  const brand = String(body.brand || '').trim()
  if (brand !== 'liberty' && brand !== 'beb') {
    return NextResponse.json({ error: 'Invalid brand' }, { status: 400 })
  }
  const itemIds: string[] = Array.isArray(body.item_ids) ? body.item_ids.filter((x: any) => typeof x === 'string') : []
  if (itemIds.length === 0) return NextResponse.json({ error: 'No items selected' }, { status: 400 })
  if (itemIds.length > 500) return NextResponse.json({ error: 'Batch too large (max 500)' }, { status: 400 })

  const recipientEmail = String(body.recipient_email || '').trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipientEmail)) {
    return NextResponse.json({ error: 'Invalid recipient email' }, { status: 400 })
  }
  const recipientName = body.recipient_name ? String(body.recipient_name).trim() : null
  const ccEmails = sanitizeEmailArr(body.cc_emails)
  const bccEmails = sanitizeEmailArr(body.bcc_emails)
  const notes = body.notes ? String(body.notes).trim() : null

  const sb = pdfAdmin()

  // Load items (with vendor + stones for snapshotting).
  const { data: items, error: itemsErr } = await sb
    .from('inventory_items')
    .select('*')
    .in('id', itemIds)
    .eq('brand', brand)
  if (itemsErr) return NextResponse.json({ error: `Items: ${itemsErr.message}` }, { status: 500 })
  if (!items || items.length === 0) return NextResponse.json({ error: 'No matching items' }, { status: 404 })

  // Block items that don't have an Edge price set — that's the
  // hard readiness gate.
  const missing = (items as any[]).filter(it => it.edge_price_cents == null)
  if (missing.length) {
    return NextResponse.json({
      error: `${missing.length} item(s) have no Edge price set; remove or set them before sending.`,
      missing: missing.map((it: any) => it.item_number),
    }, { status: 422 })
  }

  // Preserve the order the client sent (caller picked the order).
  const orderById = new Map<string, number>()
  itemIds.forEach((id, i) => orderById.set(id, i))
  const orderedItems = [...(items as any[])].sort((a, b) =>
    (orderById.get(a.id) ?? 9999) - (orderById.get(b.id) ?? 9999))

  // Vendor + stones joins.
  const vendorIds = Array.from(new Set(orderedItems.map(i => i.vendor_id).filter(Boolean)))
  const { data: vendors } = vendorIds.length
    ? await sb.from('wholesale_vendors').select('id, brand, company_name').in('id', vendorIds)
    : { data: [] as any[] }
  const vendorById = new Map<string, any>()
  ;(vendors || []).forEach((v: any) => vendorById.set(v.id, v))

  const { data: stones } = await sb.from('inventory_item_stones')
    .select('*').in('item_id', orderedItems.map(i => i.id))
  const stonesByItem = new Map<string, any[]>()
  for (const s of (stones || []) as any[]) {
    const arr = stonesByItem.get(s.item_id) || []
    arr.push(s); stonesByItem.set(s.item_id, arr)
  }

  // Mint codes + insert the batch row in draft state.
  const batchCode = mintBatchCode()
  const publicToken = mintPublicToken()
  const { data: batchRow, error: batchErr } = await sb
    .from('edge_batches')
    .insert({
      brand,
      batch_code: batchCode,
      public_token: publicToken,
      created_by: me.id,
      created_by_email: me.email,
      recipient_email: recipientEmail,
      recipient_name: recipientName,
      cc_emails: ccEmails,
      bcc_emails: bccEmails,
      notes,
      item_count: orderedItems.length,
      status: 'draft',
    })
    .select('*')
    .single()
  if (batchErr || !batchRow) {
    return NextResponse.json({ error: `Batch insert: ${batchErr?.message || 'unknown'}` }, { status: 500 })
  }

  // Build snapshots + insert batch items.
  const snapshots = orderedItems.map((it: any, idx: number) => {
    const snap = buildSnapshot({
      item: it,
      vendor: vendorById.get(it.vendor_id) ?? null,
      stones: stonesByItem.get(it.id) || [],
    })
    return { it, idx, snap }
  })

  const batchItemsRows = snapshots.map(({ it, idx, snap }) => ({
    batch_id: batchRow.id,
    inventory_item_id: it.id,
    position: idx + 1,
    item_number_frozen: it.item_number,
    snapshot: snap,
  }))
  const { error: itemsInsErr } = await sb.from('edge_batch_items').insert(batchItemsRows)
  if (itemsInsErr) {
    await sb.from('edge_batches').update({ status: 'failed', email_error: `Items insert: ${itemsInsErr.message}` }).eq('id', batchRow.id)
    return NextResponse.json({ error: `Items insert: ${itemsInsErr.message}` }, { status: 500 })
  }

  // Copy photos to the batch folder.
  const bundle = await bundleBatchPhotos(
    batchCode,
    orderedItems.map((it: any) => ({ itemId: it.id, itemNumberFrozen: it.item_number })),
  )

  // Persist per-item photo paths + filenames back to edge_batch_items.
  for (const { it, idx } of snapshots) {
    const pi = bundle.perItem[idx]
    if (!pi) continue
    await sb.from('edge_batch_items')
      .update({ photo_paths: pi.copiedPaths, photo_count: pi.copiedPaths.length })
      .eq('batch_id', batchRow.id)
      .eq('position', idx + 1)
  }

  // Generate CSV from snapshots, upload it alongside the photos.
  const csvRows = snapshots.map(({ idx, snap }) => ({
    position: idx + 1,
    batch_code: batchCode,
    snapshot: snap,
    photo_filenames: bundle.perItem[idx]?.filenames ?? [],
  }))
  const csv = buildCsv(csvRows)
  const csvFilename = `${batchCode}.csv`
  const csvPath = `${bundle.mediaFolder}/${csvFilename}`
  const { error: csvUpErr } = await sb.storage.from(PHOTO_BUCKET).upload(csvPath, Buffer.from(csv, 'utf8'), {
    contentType: 'text/csv; charset=utf-8',
    upsert: true,
    cacheControl: '60',
  })
  if (csvUpErr) console.warn('[edge batch] csv upload failed:', csvUpErr.message)

  // Build public batch URL.
  const origin = req.headers.get('origin') || guessOriginFromHost(req) || ''
  const batchUrl = origin ? `${origin}/edge/${publicToken}` : `/edge/${publicToken}`

  // Send the email.
  const send = await sendBatchEmail({
    brand: brand as 'liberty' | 'beb',
    to: recipientEmail,
    toName: recipientName,
    cc: ccEmails,
    bcc: bccEmails,
    batchCode,
    itemCount: orderedItems.length,
    photoCount: bundle.totalPhotos,
    batchUrl,
    notes,
    csv,
    csvFilename,
  })

  const nowIso = new Date().toISOString()
  const finalPatch: any = {
    item_count: orderedItems.length,
    photo_count: bundle.totalPhotos,
    csv_path: csvPath,
    media_folder: bundle.mediaFolder,
  }
  if (send.ok) {
    finalPatch.status = 'sent'
    finalPatch.sent_at = nowIso
    finalPatch.email_provider_id = send.messageId || null
    finalPatch.email_error = null
  } else {
    finalPatch.status = 'failed'
    finalPatch.email_error = send.error || 'Unknown email error'
  }
  const { data: updated, error: updErr } = await sb.from('edge_batches')
    .update(finalPatch).eq('id', batchRow.id).select('*').single()
  if (updErr) console.warn('[edge batch] final update failed:', updErr.message)

  return NextResponse.json({
    ok: send.ok,
    batch: updated || batchRow,
    photoCount: bundle.totalPhotos,
    csvPath,
    batchUrl,
    emailError: send.ok ? null : send.error,
  }, { status: send.ok ? 200 : 502 })
}

export async function GET(req: Request) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasWholesaleAccess(me)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const url = new URL(req.url)
  const brand = String(url.searchParams.get('brand') || '').trim() || 'liberty'
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 200)

  const sb = pdfAdmin()
  const { data, error } = await sb.from('edge_batches')
    .select('*')
    .eq('brand', brand)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // For the "already sent in last 90 days" badge, expose the item ids
  // touched by recent batches in the same response (cheap one-shot).
  const recentSinceIso = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
  const { data: recentItems } = await sb.from('edge_batch_items')
    .select('inventory_item_id, batch_id')
    .in('batch_id', (data || []).filter(b => b.created_at >= recentSinceIso).map(b => b.id))
  const recentItemIds = Array.from(new Set(((recentItems || []) as any[])
    .map(r => r.inventory_item_id).filter(Boolean)))

  return NextResponse.json({ batches: data || [], recentItemIds }, { status: 200 })
}

function sanitizeEmailArr(v: any): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x: any) => typeof x === 'string')
    .map((s: string) => s.trim().toLowerCase())
    .filter(s => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s))
}

function guessOriginFromHost(req: Request): string | null {
  const host = req.headers.get('host')
  if (!host) return null
  const proto = req.headers.get('x-forwarded-proto') || 'https'
  return `${proto}://${host}`
}
