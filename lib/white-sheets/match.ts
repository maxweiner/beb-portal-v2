// Match-back + 5-check auto-commit logic for the white-sheet OCR
// worker.
//
// Inputs: the structured OCR result for a single page, plus the
// page's event_id. The function:
//
//   1. Looks up the buyer_checks row for (event_id, buy_form_number).
//      Hit → records buyer_check_id and runs the 3 verification
//      checks (amount, check_number, buy_form# — the form# IS the
//      match key, so that one's free once we have a hit).
//      Miss → 'unmatched_form' review reason.
//
//   2. Validates the OCR'd phone parses to a clean 10-digit US
//      number.
//
//   3. In Phase 3 the buyer-initials classifier doesn't exist yet,
//      so EVERY page gets 'initials_pending' added — which means
//      every page in Phase 3 routes to 'needs_review' regardless
//      of the other checks. Phase 5 will replace the
//      'initials_pending' add with a real classifier call.
//
// Output: a MatchResult bundle the orchestrator uses to set the
// page row's terminal status + review_reasons.
//
// This file is pure logic + DB reads — no writes. The orchestrator
// (lib/white-sheets/process.ts) owns the write side.

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import type { WhiteSheetOcrResult } from './ocr'
import type { ClassifierResult } from './classifyInitials'
import type { WhiteSheetReviewReason } from '@/types'

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

export interface MatchResult {
  /** The buyer_checks row id we matched against, or null on miss. */
  buyer_check_id: string | null
  /** Soft flags. Empty array = obviously clean (would auto-commit
   *  if not for Phase 3's hard-coded 'initials_pending' add). */
  review_reasons: WhiteSheetReviewReason[]
  /** Convenience pre-computed: needs_review if any review_reasons
   *  are present, auto_committed otherwise. The orchestrator may
   *  override this for the unparseable-page case. */
  recommended_status: 'auto_committed' | 'needs_review'
}

/** Money equality within a cent — the OCR is parsed to numeric(12,2)
 *  on insert anyway, but we tolerate the half-cent floating point. */
function moneysClose(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a == null || b == null) return false
  return Math.abs(Number(a) - Number(b)) < 0.005
}

/** Phone parses to a clean 10-digit US number. We accept 11-digit
 *  E.164-ish "1NXXXXXXXXX" by stripping the leading 1. */
function isCleanUsPhone(raw: string | null | undefined): boolean {
  if (!raw) return false
  const digits = String(raw).replace(/\D/g, '')
  if (digits.length === 10) return true
  if (digits.length === 11 && digits.startsWith('1')) return true
  return false
}

/** Normalize the OCR'd form# / check# for comparison against the
 *  operator-typed value: lowercase, strip whitespace/dashes. */
function normalizeFormish(s: string | null | undefined): string {
  if (!s) return ''
  return String(s).toLowerCase().replace(/[\s\-_/]/g, '')
}

/** Run the match-back + 5-check filter.
 *
 *  `classifierVerdict` is the result of the Phase 5 closed-set
 *  buyer-initials classifier — pass null to fall back to the
 *  Phase 3 behavior of always flagging `initials_pending`. */
export async function applyAutoCommitChecks(
  ocr: WhiteSheetOcrResult,
  eventId: string,
  classifierVerdict: ClassifierResult | null = null,
): Promise<MatchResult> {
  const sb = admin()
  const reasons: WhiteSheetReviewReason[] = []

  // ── 1. Form-number match-back ─────────────────────────────────
  // The buy form # is the primary join key per spec decision #3.
  // Scoped to the event so the same form# in two events doesn't
  // cross-link.
  const formNumber = ocr.buy_form_number?.value ?? null
  let buyer_check_id: string | null = null
  let entered_amount: number | null = null
  let entered_check_number: string | null = null

  if (formNumber) {
    const { data: check } = await sb
      .from('buyer_checks')
      .select('id, amount, check_number, buy_form_number')
      .eq('event_id', eventId)
      .eq('buy_form_number', formNumber)
      // entry_id IS NULL filter matches what Day Entry writes; the
      // intake → purchase flow ALSO writes buyer_checks rows but
      // with entry_id populated. White sheets pair with Day-Entry
      // rows (the buyer typed them on the laptop after the show),
      // so we prefer the Day-Entry row when both exist.
      .is('entry_id', null)
      .limit(1)
      .maybeSingle()
    if (check?.id) {
      buyer_check_id = (check as any).id
      entered_amount = Number((check as any).amount)
      entered_check_number = (check as any).check_number || null
    }
  }

  if (!buyer_check_id) {
    reasons.push('unmatched_form')
  } else {
    // ── 2. Amount verify ─────────────────────────────────────
    const ocrAmount = ocr.amount?.value ?? null
    if (!moneysClose(ocrAmount, entered_amount)) {
      reasons.push('amount_mismatch')
    }

    // ── 3. Check-number verify ───────────────────────────────
    const ocrCheck = ocr.check_number?.value ?? null
    if (normalizeFormish(ocrCheck) !== normalizeFormish(entered_check_number)) {
      reasons.push('check_mismatch')
    }
  }

  // ── 4. Phone confidence ──────────────────────────────────────
  if (!isCleanUsPhone(ocr.phone?.value ?? null)) {
    reasons.push('low_confidence_phone')
  }

  // ── 5. Buyer initials ────────────────────────────────────────
  // Phase 5 introduces a verdict from the closed-set classifier
  // (lib/white-sheets/classifyInitials.ts). We translate it into
  // a review reason here so the auto-commit decision stays
  // centralized:
  //
  //   confident=true                       → no flag (clean)
  //   not confident, cold start / no workers → 'initials_pending'
  //   not confident, below threshold       → 'initials_ambiguous'
  //
  // The orchestrator passes verdict=null when the classifier was
  // skipped entirely (e.g., during Phase 5's rollout window where
  // we want to gate on a env flag). In that case we fall back to
  // the Phase-3 behavior of always flagging 'initials_pending'.
  if (!classifierVerdict) {
    reasons.push('initials_pending')
  } else if (!classifierVerdict.confident) {
    const skipReason = classifierVerdict.skipped_reason
    if (skipReason === 'no_assigned_workers' || skipReason === 'cold_start_no_samples') {
      reasons.push('initials_pending')
    } else {
      reasons.push('initials_ambiguous')
    }
  }
  // else: classifier confident → no flag added.

  return {
    buyer_check_id,
    review_reasons: reasons,
    recommended_status: reasons.length > 0 ? 'needs_review' : 'auto_committed',
  }
}
