// Sends a receipt image to Claude vision and returns normalized fields.
// Mirrors the existing `app/api/scan-document/route.ts` pattern: raw
// fetch to api.anthropic.com (no SDK needed).

import type { ExpenseCategory } from '@/types'

const ANTHROPIC_MODEL = 'claude-sonnet-4-20250514'

const PROMPT = `You are extracting expense data from a receipt photo for an estate jewelry buying business's reimbursement system. The buyer takes the photo, then submits it to the company's accountant for reimbursement.

Extract the following from this receipt image:
- vendor: the business name as it appears on the receipt (e.g. "Delta Air Lines", "Hampton Inn", "Starbucks"). If unclear, use null.
- amount: the total amount paid as a number in USD (no currency symbol, no commas, no quotes). Use the grand total / amount due, NOT the subtotal. If unclear, use null.
- date: the transaction date in YYYY-MM-DD format. Use the date the purchase was made. If unclear, use null.
- suggestedCategory: pick the single best match from this exact list:
  - flight (airline tickets, baggage fees)
  - rental_car (Hertz, Avis, Enterprise, etc.)
  - rideshare (Uber, Lyft, taxi)
  - hotel (any lodging)
  - meals (restaurants, food, groceries-on-the-road)
  - shipping_supplies (FedEx, UPS Store, packaging materials)
  - jewelry_lots_cash (only if explicitly a jewelry-purchase payout receipt — rare)
  - mileage (only if it's an explicit mileage log — very rare for an actual receipt)
  - custom (none of the above is a clean fit)

If a field can't be confidently extracted, use null for that field.

Respond ONLY with valid JSON in this exact format, no other text, no markdown code fences:
{"vendor": "Delta Air Lines", "amount": 234.56, "date": "2026-04-12", "suggestedCategory": "flight"}`

export interface ReceiptExtraction {
  vendor: string | null
  amount: number | null
  date: string | null
  suggestedCategory: ExpenseCategory | null
  raw: unknown
}

const VALID_CATEGORIES = new Set<ExpenseCategory>([
  'flight','rental_car','rideshare','hotel','meals',
  'shipping_supplies','jewelry_lots_cash','mileage','custom',
])

export async function extractReceiptData(
  imageBase64: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | string,
): Promise<ReceiptExtraction> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey || apiKey === 'your_anthropic_api_key_here') {
    throw new Error('ANTHROPIC_API_KEY is not configured')
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
          { type: 'text', text: PROMPT },
        ],
      }],
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Claude vision failed (${res.status}): ${text.slice(0, 300)}`)
  }
  const json = await res.json() as any
  const textOut: string | undefined = json?.content?.[0]?.text
  if (!textOut) throw new Error('Claude vision: empty response')

  // Strip any accidental markdown fences before parsing.
  const cleaned = textOut.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/, '').trim()
  let parsed: any
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error(`Claude vision returned non-JSON: ${cleaned.slice(0, 200)}`)
  }

  const vendor = (typeof parsed.vendor === 'string' && parsed.vendor.trim()) ? parsed.vendor.trim() : null
  const amountRaw = parsed.amount
  const amount = typeof amountRaw === 'number' && Number.isFinite(amountRaw) && amountRaw >= 0
    ? Math.round(amountRaw * 100) / 100
    : null
  const date = typeof parsed.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : null
  const suggestedCategory: ExpenseCategory | null = typeof parsed.suggestedCategory === 'string'
    && VALID_CATEGORIES.has(parsed.suggestedCategory as ExpenseCategory)
    ? (parsed.suggestedCategory as ExpenseCategory) : null

  return { vendor, amount, date, suggestedCategory, raw: parsed }
}
