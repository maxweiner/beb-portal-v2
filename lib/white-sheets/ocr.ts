// Claude vision OCR for a single white sheet page.
//
// Mirrors the lib/expenses/extractReceipt.ts pattern: raw fetch to
// api.anthropic.com (no @anthropic-ai/sdk dependency at the call
// site — the SDK is in package.json for typing only).
//
// Architecture: the source-PDF splitter (Phase 2) wrote a
// single-page PDF per row to white-sheets/{brand}/{event_id}/
// {upload_id}/page-NNNN.pdf. We download that, base64-encode it,
// send to Claude Sonnet 4.6 as a `document` content block, and
// parse a strict-JSON response.
//
// PDF-as-document (not PNG-rasterized) is deliberate: Claude
// accepts PDF document blocks natively, which means we never need
// node-canvas / pdfjs-dist server-side (painful on Vercel). The
// vision model handles the rendering internally and treats the
// page as visual context the same way an image block would. See
// docs/white-sheet-ocr-spec.md "Architectural pivot" note in PR
// #658.
//
// Cost: ~$0.005-$0.01 per page at Sonnet 4.6 pricing on a single
// scanned page. 1500 pages/month → ~$10-15/month total. We log
// per-page cost into white_sheet_uploads.estimated_cost_cents for
// monitoring.

import { createClient, SupabaseClient } from '@supabase/supabase-js'

const ANTHROPIC_MODEL = 'claude-sonnet-4-20250514'
const BUCKET = 'white-sheets'

/** Module-scoped service-role client. Lazy-initialized so we don't
 *  blow up on import in environments that lack env vars (tests). */
let _admin: SupabaseClient | null = null
function admin(): SupabaseClient {
  if (_admin) return _admin
  _admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
  return _admin
}

const PROMPT = `You are extracting structured customer + transaction data from a single dealer-copy white sheet (a pre-printed paper bill-of-sale invoice from a jewelry buying event). The form is hand-filled by a buyer at the time of the transaction. You will see a single PDF page.

The form layout (top to bottom, left to right):

- TOP-RIGHT (pre-printed, in red): the BUY FORM NUMBER. Looks like a 6-digit sequence (e.g. "104562"). Sometimes shown alongside a small prefix or store code — extract the digits only.
- CUSTOMER BLOCK (top-left area, hand-written): name, address, city, state, zip, phone, email, date of birth, driver's license number.
- LEAD SOURCE checkboxes (mid-form, hand-checked): "How did you hear about us" — newspaper / postcard / direct mail / social media / referral / other. Sometimes there's a write-in "Other ___" line.
- ITEMS DESCRIPTION (mid-form, hand-written free text): what was purchased (e.g. "14kt yellow gold ring 4.2g, sterling chain"). Free-form, often abbreviated. Capture verbatim.
- TOTAL $ (bottom-right, hand-written, often boxed): the total amount paid to the customer, in US dollars. May include "$" prefix or "and 00/100" longhand.
- CHECK # (bottom area, hand-written): the check number used to pay the customer. Usually 3-5 digits.
- DATE (bottom): transaction date.
- BOTTOM-LEFT box: AUTHORIZED BUYER initials (hand-written) — IGNORE for this call; a separate vision step classifies these.
- BOTTOM-RIGHT line: customer's signature — IGNORE; not OCR'd.

Return ONLY a JSON object in this exact shape (no markdown fences, no commentary, no trailing prose). Use null for any field you cannot extract with high confidence. Include a per-field confidence value between 0 and 1.

{
  "buy_form_number": { "value": "104562", "confidence": 0.98 },
  "check_number":    { "value": "1847",   "confidence": 0.92 },
  "amount":          { "value": 1250.00,  "confidence": 0.95 },
  "transaction_date": { "value": "2026-05-08", "confidence": 0.7 },
  "first_name":      { "value": "Jane",      "confidence": 0.9 },
  "last_name":       { "value": "Smith",     "confidence": 0.9 },
  "address_line_1":  { "value": "123 Main St", "confidence": 0.85 },
  "city":            { "value": "Akron",     "confidence": 0.9 },
  "state":           { "value": "OH",        "confidence": 0.95 },
  "zip":             { "value": "44312",     "confidence": 0.9 },
  "phone":           { "value": "3305551234", "confidence": 0.8 },
  "email":           { "value": "jsmith@example.com", "confidence": 0.6 },
  "date_of_birth":   { "value": "1962-03-15", "confidence": 0.7 },
  "id_number":       { "value": "TC123456",  "confidence": 0.8 },
  "lead_source":     { "value": "newspaper", "confidence": 0.9 },
  "lead_source_other_text": { "value": null, "confidence": 0 },
  "items_description": { "value": "14kt yellow gold ring 4.2g, sterling chain", "confidence": 0.7 }
}

Field rules:
- buy_form_number: digits only. Strip any dashes / spaces / prefix letters.
- check_number: digits only.
- amount: number (no currency symbol, no commas). Use the grand total / boxed amount, NOT a per-item subtotal. If the form has both digits and longhand ("twelve hundred fifty"), trust the digits.
- transaction_date / date_of_birth: YYYY-MM-DD format.
- phone: digits only. US phones are 10 digits (no country code).
- state: 2-letter postal code, uppercase.
- zip: 5-digit zip OR zip+4 in "12345" or "12345-6789" form.
- email: lowercased. If illegible, prefer null over a guess.
- id_number: the driver's license / state ID number, alphanumeric, as printed.
- lead_source: one of newspaper / large_postcard / small_postcard / direct_mail / social_media / referral / the_store_told_me / email / text / other. Pick the closest match for what's checked. If multiple checked, pick the topmost.
- lead_source_other_text: free-text fill-in next to "Other ___" if there is one; otherwise null.
- items_description: verbatim handwritten description, cleaned up only for legibility.

If the form is largely illegible / blank / not actually a white sheet (e.g., a scanner-inserted separator page), return:
{ "_unparseable": true, "reason": "blank_page" | "wrong_form" | "illegible" }

Respond with the JSON object only.`

/** Per-field confidence wrapper Claude returns. */
export interface OcrField<T> {
  value: T | null
  confidence: number
}

/** Structured extraction result from a single white sheet page.
 *  Matches the shape Claude is asked to produce — kept verbatim
 *  for downstream consumption + ocr_raw audit trail. */
export interface WhiteSheetOcrResult {
  /** True when Claude flagged the page as not-a-white-sheet. The
   *  worker treats this as 'errored' rather than 'needs_review'
   *  so the operator can re-scan or drop the page. */
  unparseable?: boolean
  unparseable_reason?: 'blank_page' | 'wrong_form' | 'illegible' | string

  buy_form_number?:    OcrField<string>
  check_number?:       OcrField<string>
  amount?:             OcrField<number>
  transaction_date?:   OcrField<string>

  first_name?:         OcrField<string>
  last_name?:          OcrField<string>
  address_line_1?:     OcrField<string>
  city?:               OcrField<string>
  state?:              OcrField<string>
  zip?:                OcrField<string>
  phone?:              OcrField<string>
  email?:              OcrField<string>
  date_of_birth?:      OcrField<string>
  id_number?:          OcrField<string>

  lead_source?:        OcrField<string>
  lead_source_other_text?: OcrField<string>
  items_description?:  OcrField<string>

  /** Estimated API cost in cents. Computed from the response's
   *  input/output token counts × Sonnet 4.6 pricing. */
  cost_cents: number

  /** The verbatim Claude content block text. Stored on
   *  white_sheet_pages.ocr_raw for debugging + reprocessing
   *  after a model upgrade. */
  raw_text: string
}

/** Sonnet 4.6 pricing (USD per million tokens), as of 2026-05.
 *  Rough; refresh if Anthropic updates rates. */
const PRICE_PER_M_INPUT_USD  = 3.0
const PRICE_PER_M_OUTPUT_USD = 15.0

function estimateCostCents(inputTokens: number, outputTokens: number): number {
  const inputUsd  = (inputTokens  / 1_000_000) * PRICE_PER_M_INPUT_USD
  const outputUsd = (outputTokens / 1_000_000) * PRICE_PER_M_OUTPUT_USD
  return Math.round((inputUsd + outputUsd) * 100)
}

/** Download a per-page PDF from the white-sheets bucket and
 *  base64-encode it for the Anthropic API. The bucket is private;
 *  service-role bypasses RLS so no signed URL needed. */
async function downloadPageBase64(pagePdfPath: string): Promise<string> {
  const sb = admin()
  const { data: blob, error } = await sb.storage.from(BUCKET).download(pagePdfPath)
  if (error || !blob) {
    throw new Error(`page_pdf_download_failed: ${error?.message || 'no body'} (${pagePdfPath})`)
  }
  const bytes = new Uint8Array(await blob.arrayBuffer())
  // Buffer → base64 in chunks to avoid the call-stack overflow on
  // larger pages (a 200KB page is ~270K chars; safe but fragile).
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length))
    binary += String.fromCharCode.apply(null, chunk as unknown as number[])
  }
  // btoa is global in Node 18+ runtime. For server-only callers
  // we'd use Buffer.from(bytes).toString('base64') — both work
  // on Vercel's Node runtime, but btoa keeps the helper isomorphic.
  if (typeof btoa === 'function') return btoa(binary)
  // Fallback for unusual runtimes.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return (globalThis as any).Buffer.from(bytes).toString('base64')
}

/** OCR a single white sheet page. Throws on network / parse
 *  failures; the worker turns those into page.status='errored'
 *  with last_error populated. Returns the structured result on
 *  success. */
export async function ocrWhiteSheetPage(pagePdfPath: string): Promise<WhiteSheetOcrResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey || apiKey === 'your_anthropic_api_key_here') {
    throw new Error('ANTHROPIC_API_KEY is not configured')
  }

  const pdfB64 = await downloadPageBase64(pagePdfPath)

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1500,  // generous — the JSON is ~400 tokens, but items_description can be free-form
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: pdfB64 },
          },
          { type: 'text', text: PROMPT },
        ],
      }],
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`claude_vision_failed (${res.status}): ${text.slice(0, 500)}`)
  }

  const json = await res.json() as any
  const textOut: string | undefined = json?.content?.[0]?.text
  if (!textOut) throw new Error('claude_vision_empty_response')

  const inputTokens  = json?.usage?.input_tokens  || 0
  const outputTokens = json?.usage?.output_tokens || 0
  const cost_cents   = estimateCostCents(inputTokens, outputTokens)

  // Strip any accidental markdown fences before parsing.
  const cleaned = textOut.trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/, '')
    .trim()

  let parsed: any
  try {
    parsed = JSON.parse(cleaned)
  } catch (e) {
    throw new Error(`claude_vision_non_json: ${cleaned.slice(0, 300)}`)
  }

  // Unparseable short-circuit — the page isn't a white sheet at
  // all (e.g., scanner separator page). Worker routes to 'errored'.
  if (parsed && parsed._unparseable === true) {
    return {
      unparseable: true,
      unparseable_reason: parsed.reason || 'illegible',
      cost_cents,
      raw_text: textOut,
    }
  }

  return {
    ...parsed,
    cost_cents,
    raw_text: textOut,
  } as WhiteSheetOcrResult
}
