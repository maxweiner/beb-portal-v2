// POST /api/buying-communications/templates/generate
//
// Parallel to /api/trunk-communications/templates/generate but
// tuned for messages targeting store owners about a BUYING event.
// Uses the BUYING_MERGE_FIELDS registry so the AI is told about
// {buyer_names} / {event_dates_range} etc., not the trunk-side
// {rep_name}.
//
// Auth: superadmin / admin / partner (matches the RLS on
// buying_communication_templates). Body shape, model choice, and
// JSON-parsing identical to the trunk route.

import { NextResponse } from 'next/server'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { BUYING_MERGE_FIELDS } from '@/lib/communications/buyingMergeFields'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001'

function hasAccess(me: any): boolean {
  if (!me) return false
  if (me.role === 'superadmin' || me.role === 'admin') return true
  if (me.is_partner === true) return true
  return false
}

export async function POST(req: Request) {
  const me = await getAuthedUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasAccess(me)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: any
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const prompt = String(body?.prompt || '').trim()
  if (!prompt) return NextResponse.json({ error: 'prompt is required' }, { status: 400 })
  if (prompt.length > 2000) return NextResponse.json({ error: 'prompt too long (max 2000 chars)' }, { status: 400 })

  const mode: 'new' | 'refine' = body?.mode === 'refine' ? 'refine' : 'new'
  const existing = mode === 'refine' ? (body?.existing ?? null) : null

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey || apiKey === 'your_anthropic_api_key_here') {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not configured' }, { status: 500 })
  }

  const systemPrompt = buildSystemPrompt()
  const userPrompt = buildUserPrompt(mode, prompt, existing)

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    if (res.status === 429) {
      return NextResponse.json({ error: 'rate_limited', detail: text.slice(0, 300) }, { status: 429 })
    }
    return NextResponse.json({ error: `anthropic_${res.status}`, detail: text.slice(0, 300) }, { status: 502 })
  }

  const json = await res.json() as any
  const textOut: string | undefined = json?.content?.[0]?.text
  if (!textOut) return NextResponse.json({ error: 'Empty response from Claude' }, { status: 502 })

  const parsed = parseTemplate(textOut)
  if (!parsed) {
    return NextResponse.json({
      error: 'Could not parse model output as a template',
      raw: textOut.slice(0, 500),
    }, { status: 502 })
  }

  return NextResponse.json({
    name: parsed.name,
    subject_line: parsed.subject_line,
    body: parsed.body,
  })
}

function buildSystemPrompt(): string {
  const mergeList = BUYING_MERGE_FIELDS.map(f => `  - {${f.name}} — ${f.label}${f.description ? `: ${f.description}` : ''}`).join('\n')
  return `You write professional email templates for Beneficial Estate Buyers (BEB) — a company that runs BUYING events (estate-buying / appraisal drives) at independent jewelry stores. Templates here go to the store contact (the jeweler we partner with), about an upcoming or just-completed buying event at their store.

Tone: warm, professional, concise. American English. No emojis unless the user explicitly asks. When signing off, address from the BUYERS attending the event (use the {buyer_names} placeholder where appropriate) — not a single rep, because buying events run with 2-4 buyers.

You ONLY return a single JSON object with these three fields:
  - "name": a short internal label for the template (3–6 words, title case, no quotes). Examples: "Pre-event Confirmation", "Day-Before Reminder", "Post-event Thank You", "Hours Confirmation".
  - "subject_line": the email subject line. Keep under 80 chars. Merge fields allowed but not required.
  - "body": the full email body. Plain text (no HTML). Use \\n for line breaks. Open with a greeting line (often {store_contact_name}). Sign off with the buyer roster when appropriate, e.g. "Best,\\n{buyer_names}\\nBeneficial Estate Buyers".

You MUST use ONLY these merge-field placeholders — they're substituted at send time. Don't invent new ones. Available fields:

${mergeList}

Use placeholders generously where appropriate — e.g. greet {store_contact_name}, mention {store_name}, refer to {event_dates_range}, sign off with {buyer_names}.

Return ONLY the JSON object. No markdown code fences, no commentary before or after.`
}

function buildUserPrompt(mode: 'new' | 'refine', prompt: string, existing: any): string {
  if (mode === 'refine' && existing) {
    return `Refine this existing buying-communication template per the user's instructions.

Current template:
  Name: ${existing.name || '(blank)'}
  Subject: ${existing.subject_line || '(blank)'}
  Body:
${existing.body || '(blank)'}

User's refinement instruction:
${prompt}

Return the revised template as JSON.`
  }
  return `Create a new buying-communication template per the user's description below.

${prompt}

Return the template as JSON.`
}

function parseTemplate(raw: string): { name: string; subject_line: string; body: string } | null {
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim()
  try {
    const obj = JSON.parse(stripped)
    if (typeof obj?.name !== 'string') return null
    if (typeof obj?.subject_line !== 'string') return null
    if (typeof obj?.body !== 'string') return null
    return {
      name: obj.name.trim(),
      subject_line: obj.subject_line.trim(),
      body: obj.body,
    }
  } catch {
    return null
  }
}
