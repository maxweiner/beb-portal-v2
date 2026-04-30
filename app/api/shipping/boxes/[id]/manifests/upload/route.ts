// POST /api/shipping/boxes/[id]/manifests/upload
//
// Body: multipart/form-data with `file` (image/jpeg) and
// `is_scan_style` ("true" | "false"). Client compresses + scan-styles
// the image before posting (lib/imageUtils.processImageForUpload).
//
// Validates the caller can write to the box (admin/superadmin OR a
// worker on the parent event), uploads to the `manifests` bucket via
// service role at {shipment_id}/{box_id}/{uuid}.jpg, then inserts a
// shipping_manifests row. Returns the new row.

import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser, isAdminLike } from '@/lib/expenses/serverAuth'

export const dynamic = 'force-dynamic'

const BUCKET = 'manifests'
const MAX_BYTES = 8 * 1024 * 1024 // 8 MB cap — scan-style outputs are usually <500 KB
const ALLOWED = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp'])

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let form: FormData
  try { form = await req.formData() }
  catch { return NextResponse.json({ error: 'Invalid form data' }, { status: 400 }) }

  const file = form.get('file')
  if (!(file instanceof Blob)) return NextResponse.json({ error: 'Missing file' }, { status: 400 })
  const contentType = file.type || 'image/jpeg'
  if (!ALLOWED.has(contentType)) {
    return NextResponse.json({ error: `Unsupported type: ${contentType}` }, { status: 400 })
  }
  if (file.size === 0) return NextResponse.json({ error: 'Empty file' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: `File too large (max ${MAX_BYTES} bytes)` }, { status: 413 })

  const isScanStyle = (form.get('is_scan_style') ?? 'true').toString() === 'true'

  const sb = admin()
  // Look up the box + parent event to enforce access.
  const { data: box, error: boxErr } = await sb
    .from('event_shipment_boxes')
    .select('id, shipment_id, event_shipments!inner(id, event_id, events!inner(workers))')
    .eq('id', params.id)
    .maybeSingle()
  if (boxErr) return NextResponse.json({ error: boxErr.message }, { status: 500 })
  if (!box) return NextResponse.json({ error: 'Box not found' }, { status: 404 })

  const isAdmin = isAdminLike(me)
  const workers = ((box as any).event_shipments?.events?.workers || []) as Array<{ id: string }>
  const isWorker = workers.some(w => w.id === me.id)
  if (!isAdmin && !isWorker) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const shipmentId = (box as any).shipment_id as string
  const buffer = Buffer.from(await file.arrayBuffer())
  const path = `${shipmentId}/${box.id}/${crypto.randomUUID()}.jpg`

  const { error: upErr } = await sb.storage.from(BUCKET).upload(path, buffer, {
    contentType: 'image/jpeg',
    upsert: false,
  })
  if (upErr) return NextResponse.json({ error: `Upload failed: ${upErr.message}` }, { status: 500 })

  const { data: row, error: insErr } = await sb
    .from('shipping_manifests')
    .insert({
      box_id: box.id,
      file_path: path,
      file_size_bytes: buffer.length,
      is_scan_style: isScanStyle,
      uploaded_by: me.id,
    })
    .select('id, box_id, file_path, file_size_bytes, is_scan_style, uploaded_by, uploaded_at, deleted_at')
    .single()
  if (insErr || !row) {
    // Best-effort: clean up the orphan storage object.
    await sb.storage.from(BUCKET).remove([path]).catch(() => {})
    return NextResponse.json({ error: insErr?.message || 'Insert failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, manifest: row })
}
