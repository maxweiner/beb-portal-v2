// POST /api/marketing-proofs/sign-url
//
// Returns a short-lived signed URL for a marketing_proofs row that
// lives in Supabase Storage. Two access modes (same as upload):
//   - Vendor: pass `token` (event marketing_token) → must match the
//     proof's parent campaign's event.
//   - Admin: pass an Authorization Bearer header → must be admin.
//
// Body: { proof_id: string, token?: string }
// Response: { url: string, expires_in: number }

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser, isAdminLike } from '@/lib/expenses/serverAuth'

export const dynamic = 'force-dynamic'

const SIGN_TTL_SECONDS = 3600  // 1 hour — covers a normal review session

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

export async function POST(req: Request) {
  let body: any
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const proofId = (body?.proof_id || '').toString()
  const token = (body?.token || '').toString()
  if (!proofId) return NextResponse.json({ error: 'Missing proof_id' }, { status: 400 })

  const sb = admin()

  // Resolve proof + parent campaign + parent event in one go so we
  // can run the auth check.
  const { data: proof } = await sb.from('marketing_proofs')
    .select('id, storage_path, file_url, campaign_id, marketing_campaigns!inner(event_id)')
    .eq('id', proofId)
    .maybeSingle()
  if (!proof) return NextResponse.json({ error: 'Proof not found' }, { status: 404 })

  // Legacy data-URL rows don't need a signed URL — just return the
  // data URL directly so the client can render uniformly.
  if (!proof.storage_path && proof.file_url?.startsWith('data:')) {
    return NextResponse.json({ url: proof.file_url, expires_in: 0, legacy: true })
  }
  if (!proof.storage_path) {
    return NextResponse.json({ error: 'Proof has no file' }, { status: 404 })
  }

  const eventId = (proof as any).marketing_campaigns?.event_id

  // Auth gate
  if (token) {
    const { data: ev } = await sb.from('events')
      .select('id, marketing_token')
      .eq('id', eventId)
      .maybeSingle()
    if (!ev || ev.marketing_token !== token) {
      return NextResponse.json({ error: 'Invalid token for this proof' }, { status: 403 })
    }
  } else {
    const me = await getAuthedUser(req)
    if (!isAdminLike(me)) {
      return NextResponse.json({ error: 'Admins only' }, { status: 403 })
    }
  }

  const { data: signed, error } = await sb.storage
    .from('marketing-proofs')
    .createSignedUrl(proof.storage_path, SIGN_TTL_SECONDS)
  if (error || !signed?.signedUrl) {
    return NextResponse.json({ error: error?.message || 'Could not sign URL' }, { status: 500 })
  }

  return NextResponse.json({ url: signed.signedUrl, expires_in: SIGN_TTL_SECONDS })
}
