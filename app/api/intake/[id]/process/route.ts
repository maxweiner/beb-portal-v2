// POST /api/intake/[id]/process
//
// Background processor for intake → purchase (Phases 2 + 3).
//
// Pulls the front-of-license + invoice photos from storage, hands them
// to Anthropic Vision, and writes parsed fields back to the intake row.
//
// We use Vision on the FRONT of the license rather than running a
// server-side PDF417 decoder on the BACK because:
//   - Claude Vision can't decode binary barcodes; the encoded payload
//     is opaque to it.
//   - The front of every US driver's license has the same parsed
//     fields (name, address, DOB, license #) printed visibly. OCR on
//     the front is easier and gets ~95% of what the PDF417 would.
//   - The back photo is still archived for compliance.
//
// Idempotent — safe to call again on a row that already parsed; the
// new run just overwrites the parsed fields (handy for "reprocess"
// from the worksheet on parse_failed rows).

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 60  // hard cap; Vision usually finishes in 5-15s

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

const ANTHROPIC_MODEL = 'claude-sonnet-4-20250514'
const ANTHROPIC_VERSION = '2023-06-01'

interface ParsedLicense {
  first_name?: string | null
  middle_name?: string | null
  last_name?: string | null
  date_of_birth?: string | null
  address_line1?: string | null
  address_city?: string | null
  address_state?: string | null
  address_zip?: string | null
  license_number?: string | null
  license_state?: string | null
  license_expiration?: string | null
  sex?: string | null
}
interface ParsedInvoice {
  form_number?: string | null
  check_number?: string | null
  amount?: number | null
}

const LICENSE_PROMPT = `You are a data entry assistant for a licensed estate jewelry buying company. State law requires recording seller ID for every purchase. The seller has voluntarily presented this ID and consented to having information recorded.

This image shows the FRONT of a US driver's license or state ID. Read every visible field and respond with JSON only — no preamble, no markdown fences. Use null for any field you can't confidently read.

Date format: YYYY-MM-DD (convert from MM/DD/YYYY if shown that way).
State: 2-letter US abbreviation.
Sex: 'M' or 'F'.

{"first_name":"Jane","middle_name":"Marie","last_name":"Doe","date_of_birth":"1985-01-15","address_line1":"123 Main St","address_city":"Albany","address_state":"NY","address_zip":"12345","license_number":"123456789","license_state":"NY","license_expiration":"2030-01-15","sex":"F"}`

const INVOICE_PROMPT = `This is a photo of a handwritten jewelry purchase buy form. Read these three fields:

  • form_number — the 5-digit pre-printed number at the top, often in red ink
  • check_number — handwritten, the check the buyer wrote
  • amount — the total dollar amount, handwritten

Respond with JSON only. Use null when not confidently visible. Amount must be a number (no $ sign, no commas).

{"form_number":"48271","check_number":"1047","amount":2450.00}`

async function callVision(prompt: string, imageUrl: string): Promise<any | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey || apiKey === 'your_anthropic_api_key_here') {
    throw new Error('ANTHROPIC_API_KEY not configured')
  }

  // Pull the image, convert to base64.
  const imgRes = await fetch(imageUrl)
  if (!imgRes.ok) throw new Error(`Image fetch failed (${imgRes.status})`)
  const buf = Buffer.from(await imgRes.arrayBuffer())
  const base64 = buf.toString('base64')
  const mediaType = imgRes.headers.get('content-type')?.startsWith('image/')
    ? imgRes.headers.get('content-type')!
    : 'image/jpeg'

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: prompt },
        ],
      }],
    }),
  })
  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Anthropic ${res.status}: ${errText.slice(0, 300)}`)
  }
  const data = await res.json()
  const text = data.content?.[0]?.text || ''
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    return null
  }
}

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const intakeId = params.id
  if (!intakeId) return NextResponse.json({ error: 'Missing intake id' }, { status: 400 })

  const sb = admin()

  // Mark as processing.
  await sb.from('customer_intakes').update({
    processing_state: 'processing',
    processing_started_at: new Date().toISOString(),
    parse_error_message: null,
  }).eq('id', intakeId)

  const { data: intake, error: fetchErr } = await sb
    .from('customer_intakes')
    .select('id, license_photo_url, invoice_photo_url, buy_form_number, check_number, purchase_amount, first_name, last_name')
    .eq('id', intakeId)
    .single()
  if (fetchErr || !intake) {
    return NextResponse.json({ error: fetchErr?.message || 'Intake not found' }, { status: 404 })
  }

  const updates: Record<string, any> = {}
  const errors: string[] = []

  // ── License fields from front photo ──
  if (intake.license_photo_url) {
    try {
      const parsed = (await callVision(LICENSE_PROMPT, intake.license_photo_url)) as ParsedLicense | null
      if (parsed && typeof parsed === 'object') {
        const setIf = (col: string, v: unknown) => {
          if (v != null && v !== '') updates[col] = v
        }
        setIf('first_name', parsed.first_name)
        setIf('middle_name', parsed.middle_name)
        setIf('last_name', parsed.last_name)
        setIf('date_of_birth', parsed.date_of_birth)
        setIf('address_line1', parsed.address_line1)
        setIf('address_city', parsed.address_city)
        setIf('address_state', parsed.address_state)
        setIf('address_zip', parsed.address_zip)
        setIf('license_number', parsed.license_number)
        setIf('license_state', parsed.license_state)
        setIf('license_expiration', parsed.license_expiration)
        setIf('sex', parsed.sex)
      } else {
        errors.push('License OCR returned no data.')
      }
    } catch (e: any) {
      errors.push(`License OCR: ${e?.message || e}`)
    }
  }

  // ── Invoice fields ──
  if (intake.invoice_photo_url) {
    try {
      const parsed = (await callVision(INVOICE_PROMPT, intake.invoice_photo_url)) as ParsedInvoice | null
      if (parsed && typeof parsed === 'object') {
        // Only fill these if the buyer hasn't already typed them in. The
        // buyer's manual entry always wins — OCR is best-effort pre-fill.
        if (!intake.buy_form_number && parsed.form_number) updates.buy_form_number = String(parsed.form_number).replace(/\D/g, '').slice(0, 5)
        if (!intake.check_number    && parsed.check_number) updates.check_number = String(parsed.check_number)
        if (intake.purchase_amount == null && parsed.amount != null) {
          const n = Number(parsed.amount)
          if (Number.isFinite(n) && n >= 0) updates.purchase_amount = n
        }
      } else {
        errors.push('Invoice OCR returned no data.')
      }
    } catch (e: any) {
      errors.push(`Invoice OCR: ${e?.message || e}`)
    }
  }

  // ── Final state write ──
  const finalState = errors.length > 0 && Object.keys(updates).length === 0
    ? 'parse_failed'
    : 'parsed'

  const { error: updErr } = await sb.from('customer_intakes').update({
    ...updates,
    processing_state: finalState,
    processed_at: new Date().toISOString(),
    parse_error_message: errors.length > 0 ? errors.join(' | ').slice(0, 500) : null,
  }).eq('id', intakeId)
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 })
  }

  // Audit row.
  await sb.from('intake_audit_log').insert({
    intake_id: intakeId,
    actor_user_id: null,  // server-driven
    action: 'reprocess',
    changed_fields: { ...updates, processing_state: [null, finalState] },
  }).then(() => null, () => null)

  return NextResponse.json({
    ok: true,
    state: finalState,
    fieldsUpdated: Object.keys(updates),
    errors: errors.length > 0 ? errors : undefined,
  })
}
