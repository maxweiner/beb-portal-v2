// PATCH  /api/wholesale/edge/recipients/[id]
//   Body: partial { email?, name?, role?, is_default?, notes? }
// DELETE /api/wholesale/edge/recipients/[id]
//   Soft-archive (sets archived_at). Recipients aren't truly deleted —
//   past batches reference their email value at send time, but keeping
//   the recipient row around makes audit + re-add cleaner.

import { NextResponse } from 'next/server'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { pdfAdmin } from '@/lib/wholesale/pdfHelpers'

export const dynamic = 'force-dynamic'

function hasWholesaleAccess(me: any): boolean {
  if (!me) return false
  return me.role === 'superadmin' || me.role === 'admin' || me.is_partner === true || me.inventory_access === true
}

export async function PATCH(req: Request, ctx: { params: { id: string } }) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasWholesaleAccess(me)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => null) as any
  if (!body) return NextResponse.json({ error: 'Bad JSON' }, { status: 400 })

  const sb = pdfAdmin()
  const { data: existing, error: getErr } = await sb.from('edge_recipients')
    .select('*').eq('id', ctx.params.id).maybeSingle()
  if (getErr) return NextResponse.json({ error: getErr.message }, { status: 500 })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const patch: any = {}
  if (body.email !== undefined) {
    const e = String(body.email).trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return NextResponse.json({ error: 'Invalid email' }, { status: 400 })
    patch.email = e
  }
  if (body.name !== undefined) patch.name = body.name ? String(body.name).trim() : null
  if (body.role !== undefined) {
    const r = String(body.role)
    if (!['to', 'cc', 'bcc'].includes(r)) return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
    patch.role = r
  }
  if (body.notes !== undefined) patch.notes = body.notes ? String(body.notes).trim() : null

  // is_default handling — only meaningful on role='to', and we have to
  // unset any other default for the same brand first (partial unique
  // index enforces one).
  const effectiveRole = patch.role || existing.role
  if (body.is_default !== undefined && effectiveRole === 'to') {
    if (body.is_default === true) {
      await sb.from('edge_recipients')
        .update({ is_default: false })
        .eq('brand', existing.brand)
        .eq('role', 'to')
        .is('archived_at', null)
        .neq('id', existing.id)
      patch.is_default = true
    } else {
      patch.is_default = false
    }
  } else if (effectiveRole !== 'to') {
    // cc/bcc rows can't be default; force-unset.
    patch.is_default = false
  }

  const { data, error } = await sb.from('edge_recipients')
    .update(patch).eq('id', ctx.params.id).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ recipient: data }, { status: 200 })
}

export async function DELETE(req: Request, ctx: { params: { id: string } }) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasWholesaleAccess(me)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sb = pdfAdmin()
  const { error } = await sb.from('edge_recipients')
    .update({ archived_at: new Date().toISOString(), is_default: false })
    .eq('id', ctx.params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true }, { status: 200 })
}
