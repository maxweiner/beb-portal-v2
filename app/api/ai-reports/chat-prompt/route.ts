// Chat endpoint used by the AI Reports editor's Claude sidebar.
//
// The user iterates with Claude to articulate WHAT they want each
// scheduled report to say. This is NOT the same as runReport — that
// one runs at fire time against live data. This endpoint is purely
// for drafting the prompt itself.

import { NextRequest, NextResponse } from 'next/server'

const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

const SYSTEM_PROMPT = [
  `You help an admin draft a great PROMPT for an automatically-scheduled business report at a jewelry-buying / wholesale operation.`,
  ``,
  `Context: the report fires on a schedule (daily/weekly/monthly). At fire time, the system queries current data (events, event-day rollups, customers, lead sources, top stores, top buyers) for the report's brand and a time window (last 7d / 30d / 90d / current month) and hands that data to Claude with the user's prompt. Claude then writes a fresh narrative email each time.`,
  ``,
  `Your job: help the user articulate WHAT they want each scheduled report to focus on. Examples of good prompts:`,
  ` - "Summarize last week's events. Lead with total spend, then call out the top 3 stores by performance. End with anything unusual."`,
  ` - "Monthly partner update — focus on financial performance, customer engagement, and any operational risks. Keep it under 300 words."`,
  ` - "Weekly buyer recap. Celebrate top performers by name. Note any events with zero purchases as concerns."`,
  ``,
  `Style: be concise (2-4 sentences per reply). Ask clarifying questions when the user is vague. Offer concrete prompt drafts proactively.`,
  ``,
  `When you draft a candidate prompt, format it on its own line prefixed exactly with "DRAFT:" so the UI can extract it as a one-click option. Example:`,
  `DRAFT: Summarize last week's events. Lead with total spend ...`,
  ``,
  `Don't draft a prompt on every reply — only when the user signals they're ready or has given enough detail.`,
].join('\n')

export async function POST(req: NextRequest) {
  let body: { messages?: ChatMessage[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }

  const messages = (body.messages || []).filter(m =>
    (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string',
  )
  if (messages.length === 0) {
    return NextResponse.json({ error: 'no_messages' }, { status: 400 })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'no_api_key' }, { status: 500 })
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 800,
      system: SYSTEM_PROMPT,
      messages,
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    return NextResponse.json({ error: `anthropic_${res.status}`, detail: text.slice(0, 300) }, { status: 502 })
  }
  const json = await res.json()
  const reply = (json?.content?.[0]?.text || '').trim()
  return NextResponse.json({ reply })
}
