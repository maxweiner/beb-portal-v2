// GET  /api/expense-payment-methods
// PATCH /api/expense-payment-methods
//
// Read + manage the list of payment methods that the Add Payment
// modal offers in its dropdown. Stored as a JSONB string array
// under settings.key = 'expense_payment_methods'.
//
// PATCH body shapes:
//   { add: string }       — append a new lowercased label
//   { remove: string }    — remove a label (only if not 'check' /
//                           'zelle' / 'wire' / 'ach' which are
//                           protected defaults)
//   { replace: string[] } — replace the entire list (admin tooling)
//
// Auth: accounting / admin / superadmin / partner.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/expenses/serverAuth'

export const dynamic = 'force-dynamic'

const ALLOWED_ROLES = new Set(['accounting', 'admin', 'superadmin'])
const DEFAULT_METHODS = ['check', 'zelle', 'wire', 'ach']
const PROTECTED = new Set(DEFAULT_METHODS)

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

function isAllowed(me: any): boolean {
  return ALLOWED_ROLES.has(me?.role) || !!me?.is_partner
}

function canonicalize(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ')
}

async function readMethods(sb: ReturnType<typeof admin>): Promise<string[]> {
  const { data } = await sb
    .from('settings')
    .select('value')
    .eq('key', 'expense_payment_methods')
    .maybeSingle()
  if (Array.isArray((data as any)?.value)) return (data as any).value as string[]
  return DEFAULT_METHODS
}

async function writeMethods(sb: ReturnType<typeof admin>, methods: string[]) {
  await sb
    .from('settings')
    .upsert({ key: 'expense_payment_methods', value: methods }, { onConflict: 'key' })
}

export async function GET(req: Request) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAllowed(me)) return NextResponse.json({ error: 'Accounting / admin / partner only' }, { status: 403 })
  const sb = admin()
  return NextResponse.json({ ok: true, methods: await readMethods(sb) })
}

export async function PATCH(req: Request) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAllowed(me)) return NextResponse.json({ error: 'Accounting / admin / partner only' }, { status: 403 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const sb = admin()
  const current = await readMethods(sb)

  if (typeof body?.add === 'string') {
    const v = canonicalize(body.add)
    if (!v || v.length > 50) {
      return NextResponse.json({ error: 'add must be 1-50 chars' }, { status: 400 })
    }
    if (current.includes(v)) {
      return NextResponse.json({ ok: true, methods: current, added: false })
    }
    const next = [...current, v]
    await writeMethods(sb, next)
    return NextResponse.json({ ok: true, methods: next, added: true })
  }

  if (typeof body?.remove === 'string') {
    const v = canonicalize(body.remove)
    if (PROTECTED.has(v)) {
      return NextResponse.json({ error: `'${v}' is a default method and cannot be removed` }, { status: 400 })
    }
    const next = current.filter(m => m !== v)
    await writeMethods(sb, next)
    return NextResponse.json({ ok: true, methods: next })
  }

  if (Array.isArray(body?.replace)) {
    const cleaned = (body.replace as unknown[])
      .filter((v): v is string => typeof v === 'string')
      .map(canonicalize)
      .filter(v => v.length > 0 && v.length <= 50)
    // Defaults can't be dropped — re-merge them in case the
    // caller's list missed any.
    const merged = Array.from(new Set([...DEFAULT_METHODS, ...cleaned]))
    await writeMethods(sb, merged)
    return NextResponse.json({ ok: true, methods: merged })
  }

  return NextResponse.json({ error: 'Provide add, remove, or replace' }, { status: 400 })
}
