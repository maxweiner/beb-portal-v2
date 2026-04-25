// GET /api/welcome-email/status/[store_id]
// Returns the most-recent welcome-email send (and open, if known) per
// recipient. Used by the Store Employee Management UI to render
// "Sent ✓" / "Opened ✓" badges.

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

export async function GET(_req: Request, { params }: { params: { store_id: string } }) {
  const sb = admin()
  const { data, error } = await sb
    .from('welcome_email_log')
    .select('store_employee_id, recipient_email, sent_at, opened_at')
    .eq('store_id', params.store_id)
    .order('sent_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Latest entry per (employee_id || email)
  const seen = new Set<string>()
  const latest: typeof data = []
  for (const row of data ?? []) {
    const key = (row.store_employee_id ?? row.recipient_email).toString()
    if (seen.has(key)) continue
    seen.add(key)
    latest.push(row)
  }
  return NextResponse.json({ recipients: latest })
}
