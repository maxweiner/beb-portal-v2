// POST /api/expense-reports/[id]/upload-receipt
//
// Combined upload + OCR. Body is JSON: { imageBase64, mediaType }.
// (Client compresses with lib/imageUtils.compressImage before posting,
// keeps payloads well under Vercel's 4.5 MB body limit.)
//
// Uploads the image to the private expense-receipts bucket at
// {user_id}/{report_id}/{uuid}.<ext>, then asks Claude vision to
// extract vendor / amount / date / category. Returns the storage path
// and the suggestion — does NOT create the expense yet (per spec, the
// user reviews + edits before saving).

import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser, isAdminLike } from '@/lib/expenses/serverAuth'
import { extractReceiptData } from '@/lib/expenses/extractReceipt'

export const dynamic = 'force-dynamic'

const RECEIPTS_BUCKET = 'expense-receipts'
const ALLOWED_MEDIA = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_BYTES = 5 * 1024 * 1024 // 5 MB after base64 decode

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

function extOf(mediaType: string): string {
  return mediaType === 'image/png' ? 'png' : mediaType === 'image/webp' ? 'webp' : 'jpg'
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const imageBase64Input: string = (body?.imageBase64 ?? '').toString()
  const mediaType: string = (body?.mediaType ?? 'image/jpeg').toString()

  if (!imageBase64Input) return NextResponse.json({ error: 'Missing imageBase64' }, { status: 400 })
  if (!ALLOWED_MEDIA.has(mediaType)) return NextResponse.json({ error: `mediaType must be one of ${[...ALLOWED_MEDIA].join(', ')}` }, { status: 400 })

  // Strip data: prefix if present.
  const imageBase64 = imageBase64Input.includes(',')
    ? imageBase64Input.slice(imageBase64Input.indexOf(',') + 1)
    : imageBase64Input

  let buffer: Buffer
  try {
    buffer = Buffer.from(imageBase64, 'base64')
  } catch {
    return NextResponse.json({ error: 'Invalid base64' }, { status: 400 })
  }
  if (buffer.length === 0) return NextResponse.json({ error: 'Empty image' }, { status: 400 })
  if (buffer.length > MAX_BYTES) return NextResponse.json({ error: `Image too large (max ${MAX_BYTES} bytes)` }, { status: 413 })

  const sb = admin()
  const { data: report, error: rErr } = await sb
    .from('expense_reports').select('id, user_id, status').eq('id', params.id).maybeSingle()
  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 })
  if (!report) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const isOwner = report.user_id === me.id
  if (!isOwner && !isAdminLike(me)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  // Match RLS posture: owner can only add receipts while still active.
  if (isOwner && report.status !== 'active') {
    return NextResponse.json({ error: `Report is ${report.status}, no longer editable` }, { status: 409 })
  }

  // 1. Upload to storage.
  const path = `${report.user_id}/${report.id}/${crypto.randomUUID()}.${extOf(mediaType)}`
  const { error: upErr } = await sb.storage.from(RECEIPTS_BUCKET).upload(path, buffer, {
    contentType: mediaType,
    upsert: false,
  })
  if (upErr) return NextResponse.json({ error: `Upload failed: ${upErr.message}` }, { status: 500 })

  // 2. OCR via Claude vision. Failure is non-fatal — return the
  //    receiptPath so the user can still attach the receipt manually
  //    and fill in the fields by hand.
  let suggestion = null as Awaited<ReturnType<typeof extractReceiptData>> | null
  let extractError: string | null = null
  try {
    suggestion = await extractReceiptData(imageBase64, mediaType)
  } catch (err: any) {
    extractError = err?.message ?? 'extraction failed'
  }

  return NextResponse.json({
    ok: true,
    receiptPath: path,
    suggestion,
    extractError,
  })
}
