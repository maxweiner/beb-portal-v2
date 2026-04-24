// POST /api/qr/generate
//
// Body: { store_id?, store_group_id?, items: GenerateItem[] }
//   GenerateItem = {
//     type: 'channel' | 'custom' | 'employee' | 'group',
//     lead_source?: string,                  // for channel
//     custom_label?: string,                 // for custom
//     appointment_employee_id?: string,      // for employee
//     label: string,                         // human-readable, required
//   }
//
// Returns: { created: QrCode[] }
//
// Generates a unique 8-char code per item, retries on collision (very rare
// at 32^8 keyspace). Does not perform an auth check at this layer — the
// admin UI gates access and the route uses the service role; tighten with a
// session check if exposing to the public.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { generateQrCode } from '@/lib/qr/code'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

const VALID_TYPES = new Set(['channel', 'custom', 'employee', 'group'])

export async function POST(req: Request) {
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { store_id, store_group_id, items } = body ?? {}
  if (!store_id && !store_group_id) {
    return NextResponse.json({ error: 'Either store_id or store_group_id is required' }, { status: 400 })
  }
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: 'items must be a non-empty array' }, { status: 400 })
  }

  const sb = admin()
  const created: any[] = []

  for (const it of items) {
    if (!VALID_TYPES.has(it?.type)) {
      return NextResponse.json({ error: `Invalid type: ${it?.type}` }, { status: 400 })
    }
    if (!it.label || typeof it.label !== 'string') {
      return NextResponse.json({ error: 'Each item needs a label' }, { status: 400 })
    }

    // Retry up to 5 times on code collision (collision odds are vanishingly low).
    let inserted: any = null
    let lastErr: any = null
    for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
      const code = generateQrCode(8)
      const { data, error } = await sb.from('qr_codes').insert({
        code,
        store_id: store_id || null,
        store_group_id: store_group_id || null,
        type: it.type,
        lead_source: it.lead_source || null,
        custom_label: it.custom_label || null,
        appointment_employee_id: it.appointment_employee_id || null,
        label: it.label,
        active: true,
      })
      .select('id, code, type, lead_source, custom_label, appointment_employee_id, label, active, created_at')
      .single()
      if (error) {
        lastErr = error
        // Unique-violation → retry with a fresh code; anything else is fatal.
        if (error.code !== '23505') break
      } else {
        inserted = data
      }
    }

    if (!inserted) {
      console.error('qr_code insert failed', lastErr)
      return NextResponse.json({ error: lastErr?.message || 'Insert failed' }, { status: 500 })
    }
    created.push(inserted)
  }

  return NextResponse.json({ created })
}
