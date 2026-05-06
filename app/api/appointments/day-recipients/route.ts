// GET /api/appointments/day-recipients?store_id=…&date=YYYY-MM-DD
//
// Recipients picker for the daily-appointments email. Returns:
//   - Store contacts attached to the store
//   - Buyers (event workers) for any event at this store whose date
//     window contains the appointment date — pulled live from
//     public.users so renamed users have current emails.
//
// Both lists drop entries without an email and skip the
// @placeholder.bebllp.local addresses left over from the legacy
// trunk-rep import.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/expenses/serverAuth'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: Request) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const storeId = url.searchParams.get('store_id') || ''
  const date    = url.searchParams.get('date') || ''
  if (!storeId) return NextResponse.json({ error: 'Missing store_id' }, { status: 400 })
  if (!DATE_RE.test(date)) return NextResponse.json({ error: 'Invalid or missing date' }, { status: 400 })

  const sb = admin()

  // Store contacts
  const { data: contacts } = await sb
    .from('store_contacts')
    .select('id, name, email, title')
    .eq('store_id', storeId)
    .order('created_at')
  const storeContacts = (contacts || [])
    .filter((c: any) => c.email && c.email.includes('@'))
    .map((c: any) => ({
      kind: 'store_contact' as const,
      id: `sc:${c.id}`,
      label: [c.name, c.title].filter(Boolean).join(' — '),
      email: c.email,
    }))

  // Find events at this store whose window contains `date`. event_days
  // is the source of truth for which dates an event is "live" — every
  // saved Day N has a matching row, so include any event with an
  // event_days row on the date.
  const { data: edRows } = await sb
    .from('event_days')
    .select('event_id, events!inner(store_id, workers)')
    .eq('events.store_id', storeId)
    .eq('day_date', date)

  const workerIds = new Set<string>()
  for (const r of (edRows || [])) {
    const ws = (r as any).events?.workers
    if (Array.isArray(ws)) {
      for (const w of ws) if (typeof w?.id === 'string') workerIds.add(w.id)
    }
  }

  // Fallback: event_days rows might not store the literal date. Also
  // pick up any event whose start_date <= date <= start_date + 5 days
  // (max event length sanity bound). Belt and suspenders.
  const { data: byStart } = await sb
    .from('events')
    .select('id, workers, start_date')
    .eq('store_id', storeId)
    .lte('start_date', date)
    .gte('start_date', addDays(date, -5))
  for (const e of (byStart || [])) {
    const ws = (e as any).workers
    if (Array.isArray(ws)) {
      for (const w of ws) if (typeof w?.id === 'string') workerIds.add(w.id)
    }
  }

  let workers: { kind: 'buyer'; id: string; label: string; email: string }[] = []
  if (workerIds.size > 0) {
    const { data: us } = await sb.from('users').select('id, name, email').in('id', [...workerIds])
    workers = (us || [])
      .filter((u: any) => u.email && u.email.includes('@') && !/placeholder\.bebllp\.local$/i.test(u.email))
      .map((u: any) => ({
        kind: 'buyer' as const,
        id: `buyer:${u.id}`,
        label: u.name || u.email,
        email: u.email,
      }))
  }

  return NextResponse.json({ storeContacts, workers })
}

function addDays(ymd: string, n: number): string {
  const d = new Date(ymd + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}
