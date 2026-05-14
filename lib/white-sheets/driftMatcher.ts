// OCR-drift duplicate matcher for the Phase 8 dedup sweep.
//
// The customer-import dedup matcher (lib/customers/dedup.ts) is
// tuned for definite-match (exact email/phone) + name+address
// fuzzy. It misses the OCR-drift failure modes:
//
//   - Same person, phone OCR off by ONE digit       ("0" vs "8" handwriting)
//   - Same exact phone, name OCR off by one letter  ("Schmidt" vs "Schmitt")
//   - Same name + DOB, but phone OCR misread an area code
//
// This file implements those checks against a candidate set
// (typically all the store's customers). The sweep cron at
// /api/cron/white-sheets-dedup-sweep walks customers that were
// touched by a white-sheet upload in the last N days and asks
// for each: "does any other customer in this store look like a
// drift dupe of me?" — feeding hits into customer_dedup_review_queue.
//
// Confidence calibration is conservative — the queue costs the
// operator a click per row, so we'd rather under-surface than
// drown them.

export interface DriftCustomer {
  id: string
  first_name: string
  last_name: string
  phone_normalized: string | null
  email_normalized: string | null
  date_of_birth: string | null
  zip: string | null
  /** Indicates whether THIS customer was created from a white-sheet
   *  upload. Used by the cron to avoid pairing two import-path rows
   *  (the import dedup matcher would have already caught those). */
  created_via_white_sheet: boolean
}

export interface DriftMatch {
  /** Which candidate matched. */
  candidate_id: string
  /** 0..1 confidence the two are the same person. Calibrated:
   *  0.85 = phone-Lev1, 0.75 = same-phone-name-typo, 0.7 = name+dob. */
  confidence: number
  reasons: string[]
}

// ─────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────

/** Levenshtein distance — small custom impl, no dep. Same
 *  implementation as lib/customers/dedup.ts; duplicated rather
 *  than imported to keep this module standalone. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  const v0: number[] = new Array(b.length + 1)
  const v1: number[] = new Array(b.length + 1)
  for (let j = 0; j <= b.length; j++) v0[j] = j
  for (let i = 0; i < a.length; i++) {
    v1[0] = i + 1
    for (let j = 0; j < b.length; j++) {
      const cost = a[i] === b[j] ? 0 : 1
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost)
    }
    for (let j = 0; j <= b.length; j++) v0[j] = v1[j]
  }
  return v0[b.length]
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0
  const A = a.toLowerCase().trim()
  const B = b.toLowerCase().trim()
  const longer = Math.max(A.length, B.length)
  if (longer === 0) return 1
  return (longer - levenshtein(A, B)) / longer
}

/** Phone-digits Levenshtein-1: same length (10 digits) but one
 *  position differs. Returns false for length mismatches so a
 *  trailing-zero-eaten OCR doesn't trigger. */
function phonesAreLev1(a: string, b: string): boolean {
  if (a.length !== 10 || b.length !== 10) return false
  return levenshtein(a, b) === 1
}

/** Names are "same person" if last names match exactly AND first
 *  names share at least the first letter. (Or first names fuzzy
 *  ≥80%.) We use this as a TIEBREAKER alongside another signal —
 *  never alone, since same-last-name is too common. */
function namesAreCompatible(a: DriftCustomer, b: DriftCustomer): boolean {
  const aLast = (a.last_name || '').trim().toLowerCase()
  const bLast = (b.last_name || '').trim().toLowerCase()
  if (!aLast || !bLast) return false
  if (aLast !== bLast) return false
  const aFirst = (a.first_name || '').trim().toLowerCase()
  const bFirst = (b.first_name || '').trim().toLowerCase()
  if (!aFirst || !bFirst) return true  // missing first name → permissive
  if (aFirst[0] === bFirst[0]) return true
  return similarity(aFirst, bFirst) >= 0.80
}

/** Names are CLOSE but not identical — same-phone-name-typo case.
 *  Returns true when names look like one another (Levenshtein on
 *  the full name >= 80% similarity) but are NOT exactly equal. */
function namesAreCloseButDifferent(a: DriftCustomer, b: DriftCustomer): boolean {
  const aFull = `${a.first_name || ''} ${a.last_name || ''}`.trim().toLowerCase()
  const bFull = `${b.first_name || ''} ${b.last_name || ''}`.trim().toLowerCase()
  if (!aFull || !bFull) return false
  if (aFull === bFull) return false
  return similarity(aFull, bFull) >= 0.80
}

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

/** Find OCR-drift candidates for `target` against the `pool`.
 *  `pool` should be the same-store customers (Customers module is
 *  per-store scoped; cross-store dedup is out of scope).
 *
 *  Returns at most ONE match — the highest-confidence hit. The
 *  sweep cron writes one queue row per match, so capping to the
 *  single best avoids flooding the operator with overlapping pairs
 *  (e.g., A pairs with B AND A pairs with B-prime — the operator
 *  resolves A↔B first and the next sweep can catch A↔B-prime). */
export function findOcrDriftMatch(
  target: DriftCustomer,
  pool: DriftCustomer[],
): DriftMatch | null {
  // Filter out self, soft-deletes (caller should have already done
  // this, but defensive), and rows missing every signal.
  const candidates = pool.filter(c => c.id !== target.id)

  let best: DriftMatch | null = null
  const bumpBest = (m: DriftMatch) => {
    if (!best || m.confidence > best.confidence) best = m
  }

  for (const c of candidates) {
    // ── 1. Phone Lev-1 + compatible names ─────────────────────
    // Same person, one digit misread. Most common OCR drift mode.
    if (target.phone_normalized && c.phone_normalized &&
        phonesAreLev1(target.phone_normalized, c.phone_normalized) &&
        namesAreCompatible(target, c)) {
      bumpBest({
        candidate_id: c.id,
        confidence: 0.85,
        reasons: ['phone_off_by_one_digit', 'name_match'],
      })
      continue
    }

    // ── 2. Same exact phone + close-but-different name ─────────
    // Operator entered Schmidt; OCR read Schmitt; same phone.
    if (target.phone_normalized && c.phone_normalized &&
        target.phone_normalized === c.phone_normalized &&
        namesAreCloseButDifferent(target, c)) {
      bumpBest({
        candidate_id: c.id,
        confidence: 0.75,
        reasons: ['exact_phone_match', 'name_typo'],
      })
      continue
    }

    // ── 3. Exact name + DOB, different phone ──────────────────
    // Customer kept the same name + DOB, but OCR misread the area
    // code or a non-Lev1 phone (consumer scribble can land anywhere).
    if (target.date_of_birth && c.date_of_birth &&
        target.date_of_birth === c.date_of_birth &&
        target.first_name && c.first_name &&
        target.last_name  && c.last_name &&
        target.first_name.trim().toLowerCase() === c.first_name.trim().toLowerCase() &&
        target.last_name.trim().toLowerCase()  === c.last_name.trim().toLowerCase()) {
      // Lower confidence — DOB collisions DO happen with common
      // names, and an exact name+DOB doesn't guarantee identity.
      bumpBest({
        candidate_id: c.id,
        confidence: 0.70,
        reasons: ['exact_name', 'exact_dob'],
      })
      continue
    }

    // ── 4. Email match with name mismatch ─────────────────────
    // Two different rows with the SAME email but different names.
    // (Unusual but happens — operator typed one customer's email
    // for two different transactions.) Lower confidence than the
    // phone-based signals because handwritten emails are unreliable.
    if (target.email_normalized && c.email_normalized &&
        target.email_normalized === c.email_normalized &&
        namesAreCloseButDifferent(target, c)) {
      bumpBest({
        candidate_id: c.id,
        confidence: 0.65,
        reasons: ['exact_email_match', 'name_typo'],
      })
      continue
    }
  }

  return best
}
