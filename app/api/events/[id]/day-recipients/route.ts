// GET /api/events/[id]/day-recipients
//
// Returns the recipient picker options for the day-PDF email modal:
//   - Store contacts attached to the event's store (name + email)
//   - Event workers (the buyers assigned to the event) — pulled from
//     public.users by id so we have their current email
//
// Both lists drop entries without an email. Client merges them into
// checkbox groups; the user can also enter free-form addresses.

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

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = admin()

  const { data: ev, error: evErr } = await sb
    .from('events')
    .select('store_id, store_name, workers')
    .eq('id', params.id)
    .maybeSingle()
  if (evErr) return NextResponse.json({ error: evErr.message }, { status: 500 })
  if (!ev)   return NextResponse.json({ error: 'Event not found' }, { status: 404 })

  // Store contacts
  const { data: contacts } = await sb
    .from('store_contacts')
    .select('id, name, email, title')
    .eq('store_id', ev.store_id)
    .order('created_at')

  const storeContacts = (contacts || [])
    .filter((c: any) => c.email && c.email.includes('@'))
    .map((c: any) => ({
      kind: 'store_contact' as const,
      id: `sc:${c.id}`,
      label: [c.name, c.title].filter(Boolean).join(' — '),
      email: c.email,
    }))

  // Event workers: workers JSONB has at least { id, name }; reload
  // emails fresh so a renamed/changed-email user is correct.
  const workerIds = Array.isArray(ev.workers)
    ? ev.workers.map((w: any) => w?.id).filter((x: any) => typeof x === 'string')
    : []
  let workers: { kind: 'buyer'; id: string; label: string; email: string }[] = []
  if (workerIds.length > 0) {
    const { data: us } = await sb.from('users').select('id, name, email').in('id', workerIds)
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
