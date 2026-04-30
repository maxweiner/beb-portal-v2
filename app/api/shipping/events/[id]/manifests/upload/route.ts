// POST /api/shipping/events/[id]/manifests/upload
//
// Body: multipart/form-data with `file` (image/jpeg) and
// `is_scan_style` ("true" | "false"). Client compresses + scan-styles
// the image before posting (lib/imageUtils.processImageForUpload).
//
// Validates the caller can write to the event (admin/superadmin OR a
// worker on the event), uploads to the `manifests` bucket via service
// role at events/{event_id}/{uuid}.jpg, then inserts a
// shipping_manifests row scoped to the event. Returns the new row.

import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser, isAdminLike } from '@/lib/expenses/serverAuth'

export const dynamic = 'force-dynamic'

const BUCKET = 'manifests'
const MAX_BYTES = 8 * 1024 * 1024
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
  // Look up the event to enforce access — admin OR worker on event.
  const { data: event, error: evErr } = await sb
    .from('events')
    .select('id, workers')
    .eq('id', params.id)
    .maybeSingle()
  if (evErr) return NextResponse.json({ error: evErr.message }, { status: 500 })
  if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

  const isAdmin = isAdminLike(me)
  const workers = ((event as any).workers || []) as Array<{ id: string }>
  const isWorker = workers.some(w => w.id === me.id)
  if (!isAdmin && !isWorker) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const path = `events/${event.id}/${crypto.randomUUID()}.jpg`

  const { error: upErr } = await sb.storage.from(BUCKET).upload(path, buffer, {
    contentType: 'image/jpeg',
    upsert: false,
  })
  if (upErr) return NextResponse.json({ error: `Upload failed: ${upErr.message}` }, { status: 500 })

  const { data: row, error: insErr } = await sb
    .from('shipping_manifests')
    .insert({
      event_id: event.id,
      file_path: path,
      file_size_bytes: buffer.length,
      is_scan_style: isScanStyle,
      uploaded_by: me.id,
    })
    .select('id, event_id, box_id, file_path, file_size_bytes, is_scan_style, uploaded_by, uploaded_at, deleted_at')
    .single()
  if (insErr || !row) {
    await sb.storage.from(BUCKET).remove([path]).catch(() => {})
    return NextResponse.json({ error: insErr?.message || 'Insert failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, manifest: row })
}
