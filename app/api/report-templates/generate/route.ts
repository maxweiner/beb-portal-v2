// POST /api/report-templates/generate
//
// Body: {
//   reportId: string,                  // 'daily-briefing', 'morning-briefing', etc.
//   reportTitle: string,               // for the system prompt context
//   reportDescription: string,
//   varHint: string,                   // e.g. "{{date}}, {{brandLabel}}, {{emoji}}"
//   prompt: string,                    // operator's instruction
//   mode: 'new' | 'refine',
//   existing?: {
//     subject, greeting, header_subtitle, footer, shoutout_fallback
//   }                                  // required on refine
// }
// → 200 { subject, greeting, header_subtitle, footer, shoutout_fallback }
//
// Generates or refines the 5-field report_templates row via Claude
// Haiku 4.5. Parallel to /api/trunk-communications/templates/generate
// — same model, same parsing, same friction-gate flow. The
// substitution variables differ per report so we pass the report's
// varHint into the system prompt and tell the model to use ONLY
// those placeholders.
//
// Reports are typed (transactional vs broadcast vs event-scoped) and
// some fields don't apply for every type — e.g. transactional
// reports use `shoutout_fallback` as the BODY. We pass the report
// description through so the model can pick the right register.

import { NextResponse } from 'next/server'
import { getAuthedUser } from '@/lib/expenses/serverAuth'

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

  const reportId         = String(body?.reportId || '').trim()
  const reportTitle      = String(body?.reportTitle || '').trim()
  const reportDescription = String(body?.reportDescription || '').trim()
  const varHint          = String(body?.varHint || '').trim()
  const prompt           = String(body?.prompt || '').trim()
  if (!reportId || !reportTitle || !prompt) {
    return NextResponse.json({ error: 'reportId, reportTitle, prompt all required' }, { status: 400 })
  }
  if (prompt.length > 2000) return NextResponse.json({ error: 'prompt too long (max 2000 chars)' }, { status: 400 })

  const mode: 'new' | 'refine' = body?.mode === 'refine' ? 'refine' : 'new'
  const existing = mode === 'refine' ? (body?.existing ?? null) : null

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey || apiKey === 'your_anthropic_api_key_here') {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not configured' }, { status: 500 })
  }

  const systemPrompt = buildSystemPrompt(reportTitle, reportDescription, varHint)
  const userPrompt   = buildUserPrompt(mode, prompt, existing)

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
  if (!textOut) {
    return NextResponse.json({ error: 'Empty response from Claude' }, { status: 502 })
  }

  const parsed = parseTemplate(textOut)
  if (!parsed) {
    return NextResponse.json({
      error: 'Could not parse model output as a template',
      raw: textOut.slice(0, 500),
    }, { status: 502 })
  }

  return NextResponse.json(parsed)
}

function buildSystemPrompt(reportTitle: string, reportDescription: string, varHint: string): string {
  return `You write internal-team email templates for Beneficial Estate Buyers (BEB) — a company that hosts buying / trunk shows at independent jewelry stores. The Reports module emails go to OUR OWN team (admins, partners, buyers), not to customers or jewelers.

You are editing the template for ONE specific report:
  Report: ${reportTitle}
  Purpose: ${reportDescription || '(no description)'}

Tone: warm, energizing, concise. Internal team voice — like a sharp morning briefing. American English. Emojis OK in moderation (the existing morning brief uses 🌅 ☕ etc — feel free to keep one in the greeting/subject if it fits the tone). Brief and skimmable — these go out every morning, so we want enough warmth that people actually read them.

You ONLY return a single JSON object with these five fields. Every field is a string (use empty string '' if not applicable):
  - "subject": the email subject line. Keep under 80 chars. May use the variables listed below.
  - "greeting": the big headline at the top of the email (~2-6 words, can include emoji). Example: "🌅 Good morning, team", "☕ Wednesday Recap".
  - "header_subtitle": a smaller second line under the greeting. Typically the date or a quick context line. Often just "{{date}}".
  - "shoutout_fallback": a short prose paragraph (1-3 sentences) that introduces the email — a warm opening line above the per-event table. This is the "shoutout" / opening message. If the user asked for an empty / no-shoutout template, return ''.
  - "footer": single-line footer at the bottom of the email. Brief and brand-consistent. Example: "BEB Portal · Daily Morning Report".

Variables available for THIS report (use ONLY these, never invent new ones — they get substituted at send time with real values):
${varHint || '(no variables for this report)'}

Substitution syntax uses double curly braces: ${'{{date}}'}, ${'{{brandLabel}}'}, etc. Use them where natural — e.g. "Morning briefing — {{date}}" or "Good morning, ${'{{brandLabel}}'} team".

Return ONLY the JSON object. No markdown code fences, no commentary before or after. All five string fields MUST be present.`
}

function buildUserPrompt(mode: 'new' | 'refine', prompt: string, existing: any): string {
  if (mode === 'refine' && existing) {
    return `Refine this existing report template per the user's instructions.

Current template:
  Subject:         ${existing.subject || '(blank)'}
  Greeting:        ${existing.greeting || '(blank)'}
  Header subtitle: ${existing.header_subtitle || '(blank)'}
  Shoutout:        ${existing.shoutout_fallback || '(blank)'}
  Footer:          ${existing.footer || '(blank)'}

User's refinement instruction:
${prompt}

Return the revised template as JSON with all five fields.`
  }
  return `Write a new template for this report per the user's description below.

${prompt}

Return the template as JSON with all five fields.`
}

function parseTemplate(raw: string): {
  subject: string
  greeting: string
  header_subtitle: string
  footer: string
  shoutout_fallback: string
} | null {
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim()
  try {
    const obj = JSON.parse(stripped)
    const keys = ['subject', 'greeting', 'header_subtitle', 'footer', 'shoutout_fallback'] as const
    for (const k of keys) if (typeof obj?.[k] !== 'string') return null
    return {
      subject:           String(obj.subject).trim(),
      greeting:          String(obj.greeting).trim(),
      header_subtitle:   String(obj.header_subtitle).trim(),
      footer:            String(obj.footer).trim(),
      shoutout_fallback: String(obj.shoutout_fallback),  // preserve internal newlines
    }
  } catch {
    return null
  }
}
