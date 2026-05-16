// POST /api/trunk-communications/templates/generate
//
// Body: {
//   prompt: string,
//   mode: 'new' | 'refine',
//   existing?: { name, subject_line, body }   // only on refine
// }
// → 200 { name, subject_line, body }
//
// Generates (or refines) a trunk-communications email template via
// Claude Haiku 4.5. Email-only — the communication_templates schema
// doesn't carry SMS bodies. The model is told about the canonical
// merge-field registry (lib/communications/mergeFields.ts) so it
// uses the EXACT placeholder names the send pipeline knows about
// (e.g. {store_name}, {event_dates_range}) — typos here would surface
// as unknown-merge-field warnings at save time.
//
// Cost target: Haiku 4.5 at ~$0.002 per generation (200 in, 300 out
// is typical). Sonnet would be ~3x more expensive without a quality
// gain for this kind of structured-output writing.
//
// Auth: any user with trunk-communications module access. The
// underlying server check is `users.role IN ('admin', 'superadmin')`
// OR `is_partner = true` since template management has always been
// admin-only in this module.

import { NextResponse } from 'next/server'
import { getAuthedUser } from '@/lib/expenses/serverAuth'
import { MERGE_FIELDS } from '@/lib/communications/mergeFields'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Claude Haiku 4.5 — picked over Sonnet because:
//   - template generation is a simple structured-output task
//     (no chain-of-thought needed)
//   - ~3x cheaper input / output
//   - fast: ~2-3 sec per generation feels instant
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
    // 429 = rate limited (org token-per-minute cap). Echo through
    // so the client can show "try again in a minute".
    if (res.status === 429) {
      return NextResponse.json({ error: 'rate_limited', detail: text.slice(0, 300) }, { status: 429 })
    }
    return NextResponse.json({ error: `anthropic_${res.status}`, detail: text.slice(0, 300) }, { status: 502 })
  }

  const json = await res.json() as any
  const textOut: string | undefined = json?.content?.[0]?.text
  if (!textOut) {
    return NextResponse.json({ error: 'Empty response from Claude' }, { status: 502 })
  }

  // Parse the JSON block. We instruct the model to return ONLY a
  // JSON object — but we strip any markdown code fences just in
  // case (Haiku is mostly compliant but occasionally wraps).
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
  const mergeList = MERGE_FIELDS.map(f => `  - {${f.name}} — ${f.label}${f.description ? `: ${f.description}` : ''}`).join('\n')
  return `You write professional email templates for Beneficial Estate Buyers (BEB) — a company that hosts buying / trunk shows at independent jewelry stores. Templates are stored in our system and sent to store contacts (jewelers we partner with), not to end customers.

Tone: warm, professional, concise. American English. No emojis unless the user explicitly asks. Sign off with the rep's name, never with "BEB" alone — the rep's email comes from {rep_name}.

You ONLY return a single JSON object with these three fields:
  - "name": a short internal label for the template (3–6 words, title case, no quotes). Example: "Pre-show Reminder", "Confirmation Letter", "Hours Confirmation".
  - "subject_line": the email subject line (no merge fields are necessary, but allowed). Keep under 80 chars.
  - "body": the full email body. Plain text (no HTML). Use \\n for line breaks. Open with a greeting line. Sign off with the rep's name on its own line, formatted: "Best,\\n{rep_name}".

You MUST use ONLY these merge-field placeholders — they're substituted at send time. Don't invent new ones. Available fields:

${mergeList}

Use placeholders generously where appropriate — e.g. address the contact by {store_contact_name}, mention {store_name}, refer to {event_dates_range}, sign off as {rep_name}.

Return ONLY the JSON object. No markdown code fences, no commentary before or after.`
}

function buildUserPrompt(mode: 'new' | 'refine', prompt: string, existing: any): string {
  if (mode === 'refine' && existing) {
    return `Refine this existing template per the user's instructions.

Current template:
  Name: ${existing.name || '(blank)'}
  Subject: ${existing.subject_line || '(blank)'}
  Body:
${existing.body || '(blank)'}

User's refinement instruction:
${prompt}

Return the revised template as JSON.`
  }
  return `Create a new template per the user's description below.

${prompt}

Return the template as JSON.`
}

function parseTemplate(raw: string): { name: string; subject_line: string; body: string } | null {
  // Strip ```json ... ``` fences if the model included them.
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
      body: obj.body,  // preserve internal newlines / whitespace
    }
  } catch {
    return null
  }
}
