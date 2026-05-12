// GET  /api/wholesale/edge/recipients?brand=liberty
// POST /api/wholesale/edge/recipients
//   Body: { brand, email, name?, role: 'to'|'cc'|'bcc', is_default?, notes? }

import { NextResponse } from 'next/server'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { pdfAdmin } from '@/lib/wholesale/pdfHelpers'

export const dynamic = 'force-dynamic'

function hasWholesaleAccess(me: any): boolean {
  if (!me) return false
  return me.role === 'superadmin' || me.role === 'admin' || me.is_partner === true || me.inventory_access === true
}

export async function GET(req: Request) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasWholesaleAccess(me)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const url = new URL(req.url)
  const brand = String(url.searchParams.get('brand') || 'liberty').trim()

  const sb = pdfAdmin()
  const { data, error } = await sb.from('edge_recipients')
    .select('*')
    .eq('brand', brand)
    .is('archived_at', null)
    .order('role', { ascending: true })
    .order('is_default', { ascending: false })
    .order('email', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ recipients: data || [] }, { status: 200 })
}

export async function POST(req: Request) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasWholesaleAccess(me)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => null) as any
  if (!body) return NextResponse.json({ error: 'Bad JSON' }, { status: 400 })

  const brand = String(body.brand || 'liberty').trim()
  if (brand !== 'liberty' && brand !== 'beb') return NextResponse.json({ error: 'Invalid brand' }, { status: 400 })
  const email = String(body.email || '').trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400 })
  }
  const role = String(body.role || 'to')
  if (!['to', 'cc', 'bcc'].includes(role)) return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
  const name = body.name ? String(body.name).trim() : null
  const isDefault = role === 'to' && body.is_default === true
  const notes = body.notes ? String(body.notes).trim() : null

  const sb = pdfAdmin()

  // If marking this row as the new default, clear any existing default
  // first (the partial unique index allows only one).
  if (isDefault) {
    await sb.from('edge_recipients')
      .update({ is_default: false })
      .eq('brand', brand)
      .eq('role', 'to')
      .is('archived_at', null)
  }

  const { data, error } = await sb.from('edge_recipients')
    .insert({ brand, email, name, role, is_default: isDefault, notes })
    .select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ recipient: data }, { status: 200 })
}
