// PUT /api/user/last-active-brand
// Body: { user_id: string, brand: 'beb' | 'liberty' }
//
// Persists the user's currently-selected brand to users.last_active_brand
// so the choice propagates to the user's other devices on next load.

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

export async function PUT(req: Request) {
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const userId = body?.user_id
  const brand = body?.brand
  if (!userId) return NextResponse.json({ error: 'Missing user_id' }, { status: 400 })
  if (brand !== 'beb' && brand !== 'liberty') {
    return NextResponse.json({ error: 'brand must be beb or liberty' }, { status: 400 })
  }

  const sb = admin()
  const { error } = await sb.from('users').update({ last_active_brand: brand }).eq('id', userId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
