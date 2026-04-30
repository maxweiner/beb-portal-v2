// POST /api/marketing/proofs/[id]/sign-url
//
// Body: { file_index: number }
//
// Returns a signed URL (1h TTL) for the requested file in the proof's
// file_urls[] array. Auth: marketing_access required.
//
// Magic-link flow lands in Phase 9 — that branch will accept a token
// instead of a session.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/expenses/serverAuth'

export const dynamic = 'force-dynamic'

const SIGN_TTL_SECONDS = 3600

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

  const sb = admin()
  const { data: meRow } = await sb.from('users').select('marketing_access').eq('id', me.id).maybeSingle()
  if (!(meRow as any)?.marketing_access) {
    return NextResponse.json({ error: 'Marketing access required' }, { status: 403 })
  }

  let body: any
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const fileIndex = Number(body?.file_index ?? 0)

  const { data: proof } = await sb.from('marketing_proofs')
    .select('id, file_urls').eq('id', params.id).maybeSingle()
  if (!proof) return NextResponse.json({ error: 'Proof not found' }, { status: 404 })

  const paths: string[] = (proof as any).file_urls || []
  if (fileIndex < 0 || fileIndex >= paths.length) {
    return NextResponse.json({ error: 'file_index out of range' }, { status: 400 })
  }

  const { data: signed, error } = await sb.storage
    .from('marketing-proofs')
    .createSignedUrl(paths[fileIndex], SIGN_TTL_SECONDS)
  if (error || !signed?.signedUrl) {
    return NextResponse.json({ error: error?.message || 'Could not sign URL' }, { status: 500 })
  }
  return NextResponse.json({ url: signed.signedUrl, expires_in: SIGN_TTL_SECONDS })
}
