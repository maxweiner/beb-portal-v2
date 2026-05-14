// Closed-set buyer-initials classifier.
//
// Phase 5 of the white-sheet OCR pipeline. Treats "whose initials
// are on this page?" as a constrained visual-classification
// problem (pick one of the event's assigned workers) rather than
// free-form OCR of two handwritten letters.
//
// Architecture:
//   1. Pull the event's assigned workers (one to ~3 typical).
//   2. For each candidate, fetch up to N active signature samples
//      from user_signature_samples (cap to keep token cost bounded;
//      defaults to 3 per worker → ~9 reference docs + 1 target).
//   3. Build a single Claude Sonnet 4.6 vision call with:
//        - The new page as a `document` block
//        - Each reference sample as another `document` block,
//          labeled "<candidate_label>: sample N"
//        - A structured-output prompt asking for per-candidate
//          scores 0-1.
//   4. Parse, pick the best score, evaluate the spec's auto-link
//      threshold (best ≥ 0.75 AND second-best ≤ 0.5).
//
// Cold-start handling: if no candidate has any active samples,
// the function returns { skipped_reason: 'cold_start_no_samples',
// confident: false }. The orchestrator falls back to the Phase 4
// behavior (page lands in review with `initials_pending`,
// operator manually picks the buyer, the confirm route inserts
// the bootstrap sample for next time).
//
// Cost: ~3-4× a plain OCR call (target page + ~9 reference pages
// as document blocks). Spec budget allows for this; the auto-commit
// rate it enables more than pays back the per-page cost.

import { createClient, SupabaseClient } from '@supabase/supabase-js'

const ANTHROPIC_MODEL = 'claude-sonnet-4-20250514'
const BUCKET = 'white-sheets'

/** Max active samples per candidate to include in the prompt.
 *  Three gives us decent variance coverage of a buyer's scribble
 *  drift without pushing the call into expensive multi-doc
 *  territory. */
const MAX_SAMPLES_PER_CANDIDATE = 3

/** Spec auto-link threshold: best ≥ 0.75 AND second-best ≤ 0.5.
 *  Tuned for "I'm willing to skip the review pile on this." */
const CONFIDENCE_THRESHOLD = 0.75
const SECOND_BEST_CEILING  = 0.5

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

export interface ClassifierCandidate {
  user_id: string
  display_label: string
  sample_paths: string[]
}

export interface ClassifierResult {
  /** True when the model produced a confident pick that passes
   *  the auto-link threshold. False when no candidate cleared the
   *  bar OR the classifier was skipped (cold start, no workers, etc.). */
  confident: boolean
  /** The user_id of the picked candidate. Always set on confident=true.
   *  May also be set on confident=false when we have a best guess
   *  but it didn't clear the threshold — the UI can pre-select that
   *  buyer pill in the review pile to save a click. */
  best_user_id: string | null
  /** 0..1 score for the best candidate. */
  best_score: number | null
  /** 0..1 score for the runner-up — what gates the second-best
   *  threshold. Null when only one candidate had samples. */
  second_best_score: number | null
  /** Why we skipped, when confident=false and best_user_id is null.
   *  Useful for telemetry / debugging. */
  skipped_reason?:
    | 'no_assigned_workers'
    | 'cold_start_no_samples'
    | 'classifier_error'
    | 'unparseable_response'
    | 'below_threshold'
  /** Raw Claude response text. Stored on the page row's ocr_raw
   *  blob under .initials_classifier_raw for audit. */
  raw_text?: string
  /** Per-candidate scores, for surfacing in the review pile when
   *  the classifier wasn't confident enough. */
  scores?: Record<string, number>
}

/** Pull the assigned workers + each worker's active signature
 *  samples in a single round-trip pair. Returns the candidate
 *  list ready to feed into the classifier prompt. */
export async function buildCandidateSet(eventId: string): Promise<ClassifierCandidate[]> {
  const sb = admin()

  // 1. Workers assigned to this event. events.workers is a JSONB
  //    array of { id, name, deleted? } objects — same shape the
  //    GCal dispatcher reads. We filter out soft-deleted entries.
  const { data: ev } = await sb
    .from('events')
    .select('workers')
    .eq('id', eventId)
    .maybeSingle()
  const rawWorkers = (ev as any)?.workers as Array<{ id: string; name?: string; deleted?: boolean }> | undefined
  const workers = (rawWorkers || [])
    .filter(w => w && !w.deleted && w.id)
    .map(w => ({ user_id: w.id, name: w.name || 'Unknown' }))

  if (workers.length === 0) return []

  // 2. Active signature samples per worker. We pull more rows than
  //    we need and pick the most recent N in JS — keeps the SQL
  //    simple, the dataset is small.
  const userIds = workers.map(w => w.user_id)
  const { data: samples } = await sb
    .from('user_signature_samples')
    .select('user_id, image_path, created_at')
    .in('user_id', userIds)
    .eq('is_active', true)
    .order('created_at', { ascending: false })  // newest first; recency = fresher style

  const byUser = new Map<string, string[]>()
  for (const s of (samples || []) as any[]) {
    const list = byUser.get(s.user_id) || []
    if (list.length < MAX_SAMPLES_PER_CANDIDATE) {
      list.push(s.image_path)
      byUser.set(s.user_id, list)
    }
  }

  return workers.map(w => ({
    user_id: w.user_id,
    display_label: w.name,
    sample_paths: byUser.get(w.user_id) || [],
  }))
}

/** Download a PDF from the white-sheets bucket → base64.
 *  Mirrors the helper in ocr.ts; kept inline here to keep this
 *  module self-contained. */
async function downloadPdfBase64(storagePath: string): Promise<string> {
  const sb = admin()
  const { data: blob, error } = await sb.storage.from(BUCKET).download(storagePath)
  if (error || !blob) {
    throw new Error(`sample_download_failed: ${error?.message || 'no body'} (${storagePath})`)
  }
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length))
    binary += String.fromCharCode.apply(null, chunk as unknown as number[])
  }
  if (typeof btoa === 'function') return btoa(binary)
  return (globalThis as any).Buffer.from(bytes).toString('base64')
}

function buildPrompt(candidates: ClassifierCandidate[]): string {
  const candidateLines = candidates.map((c, i) =>
    `  - candidate_${i + 1} (user_id: ${c.user_id}, label: ${c.display_label}) — ${c.sample_paths.length} reference page${c.sample_paths.length === 1 ? '' : 's'}`
  ).join('\n')

  return `You will see a series of single-page PDFs from jewelry-buying white sheets. The FIRST document is a NEW page; the rest are REFERENCE pages from previously confirmed buys. Each reference page's known author is given below.

Your task: look at the AUTHORIZED BUYER initials box at the bottom-left of the new page (a small box containing handwritten initials — usually 2-3 letters). Compare that handwriting to the AUTHORIZED BUYER box on each reference page. Score how likely each candidate is to have written the new page's initials.

The candidates and the order their reference pages appear in:

${candidateLines}

Reference pages appear in the message in the same order as the candidate list — candidate_1's references first, then candidate_2's, etc.

IMPORTANT:
- Ignore every other handwritten field. Compare only the initials box.
- Each candidate has the SAME label for all their reference pages.
- Score independently per candidate; scores need not sum to 1.
- If the new page's initials box is illegible, return scores near 0 for everyone.
- If the initials clearly don't match any candidate, return scores near 0 for everyone.

Return ONLY a JSON object in this exact shape (no markdown fences, no commentary):

{
  "scores": {
    "<user_id_1>": 0.95,
    "<user_id_2>": 0.10,
    "<user_id_3>": 0.05
  },
  "reasoning": "very short one-line justification"
}

Use the user_id values exactly as given above. Score values must be numbers between 0 and 1.`
}

/** Classify the buyer-initials on a single page. Throws on
 *  unrecoverable errors (bad API key, network); returns a
 *  skipped result on graceful cases (cold start, no workers). */
export async function classifyBuyerInitials(
  pagePdfPath: string,
  eventId: string,
): Promise<ClassifierResult> {
  const candidates = await buildCandidateSet(eventId)

  if (candidates.length === 0) {
    return {
      confident: false,
      best_user_id: null,
      best_score: null,
      second_best_score: null,
      skipped_reason: 'no_assigned_workers',
    }
  }

  // Cold-start: nobody has any samples yet. The library will
  // start filling once operators confirm pages in the review pile
  // (Phase 4 + Phase 5's bootstrap-on-confirm in confirm/route.ts).
  const hasAnySamples = candidates.some(c => c.sample_paths.length > 0)
  if (!hasAnySamples) {
    return {
      confident: false,
      best_user_id: null,
      best_score: null,
      second_best_score: null,
      skipped_reason: 'cold_start_no_samples',
    }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey || apiKey === 'your_anthropic_api_key_here') {
    throw new Error('ANTHROPIC_API_KEY is not configured')
  }

  // Build the content blocks: new page first, then every
  // reference sample in candidate order.
  const newPageB64 = await downloadPdfBase64(pagePdfPath)
  const content: any[] = [
    {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: newPageB64 },
    },
  ]
  for (const c of candidates) {
    for (const path of c.sample_paths) {
      try {
        const b64 = await downloadPdfBase64(path)
        content.push({
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: b64 },
        })
      } catch (e) {
        // Missing sample file (perhaps deleted by the 90-day
        // cleanup cron in Phase 9). Skip rather than abort —
        // we still classify with whatever samples remain.
        console.warn('[classifyInitials] sample missing, skipping', path, e)
      }
    }
  }
  content.push({ type: 'text', text: buildPrompt(candidates) })

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
      messages: [{ role: 'user', content }],
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return {
      confident: false,
      best_user_id: null,
      best_score: null,
      second_best_score: null,
      skipped_reason: 'classifier_error',
      raw_text: `${res.status}: ${text.slice(0, 200)}`,
    }
  }
  const json = await res.json() as any
  const textOut: string | undefined = json?.content?.[0]?.text
  if (!textOut) {
    return {
      confident: false,
      best_user_id: null,
      best_score: null,
      second_best_score: null,
      skipped_reason: 'unparseable_response',
    }
  }

  const cleaned = textOut.trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/, '')
    .trim()

  let parsed: any
  try { parsed = JSON.parse(cleaned) } catch {
    return {
      confident: false,
      best_user_id: null,
      best_score: null,
      second_best_score: null,
      skipped_reason: 'unparseable_response',
      raw_text: textOut,
    }
  }

  const rawScores = (parsed?.scores || {}) as Record<string, unknown>
  const scores: Record<string, number> = {}
  for (const c of candidates) {
    const v = rawScores[c.user_id]
    scores[c.user_id] = (typeof v === 'number' && v >= 0 && v <= 1) ? v : 0
  }

  // Sort descending — pick the winner.
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1])
  const best         = ranked[0]
  const secondBest   = ranked[1]
  const bestUser     = best?.[0] || null
  const bestScore    = best?.[1] ?? null
  const secondScore  = secondBest?.[1] ?? null

  const confident =
    bestScore !== null &&
    bestScore >= CONFIDENCE_THRESHOLD &&
    (secondScore === null || secondScore <= SECOND_BEST_CEILING)

  return {
    confident,
    best_user_id: bestUser,
    best_score: bestScore,
    second_best_score: secondScore,
    raw_text: textOut,
    scores,
    skipped_reason: confident ? undefined : 'below_threshold',
  }
}
