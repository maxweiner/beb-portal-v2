// Dedup matcher for the import + (later) appointment auto-create
// flows. Per spec:
//   - Definite match (auto-merge): exact email match OR exact phone
//     match → update existing record
//   - Possible match (review queue): name similarity + address
//     similarity above threshold → push to dedup_review_queue
//   - No match: create new
//
// Matching is per-store; cross-store dedup is explicitly out of scope
// per the "one customer = one store" decision.

export interface DedupCandidate {
  first_name: string
  last_name: string
  address_line_1: string | null
  city: string | null
  zip: string | null
  phone_normalized: string | null
  email_normalized: string | null
}

export interface DedupExisting extends DedupCandidate {
  id: string
}

export type DedupVerdict =
  | { kind: 'auto_merge'; existing: DedupExisting; reasons: string[] }
  | { kind: 'review';     existing: DedupExisting; confidence: number; reasons: string[] }
  | { kind: 'create' }

const NAME_THRESHOLD    = 0.80
const ADDRESS_THRESHOLD = 0.80

/** Levenshtein distance — small custom impl, no dep. */
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

/** Strip punctuation + collapse whitespace for fair address compare. */
function normalizeAddress(s: string | null | undefined): string {
  if (!s) return ''
  return s.toLowerCase()
    .replace(/[.,#]/g, ' ')
    .replace(/\bstreet\b/g, 'st')
    .replace(/\bavenue\b/g, 'ave')
    .replace(/\bboulevard\b/g, 'blvd')
    .replace(/\broad\b/g, 'rd')
    .replace(/\bdrive\b/g, 'dr')
    .replace(/\blane\b/g, 'ln')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Decide what to do with an incoming candidate against the in-store
 * universe of existing customers.
 *
 * Caller provides only the candidate set — typically all customers
 * for the same store. This function does no I/O.
 */
export function matchDedup(
  incoming: DedupCandidate,
  existing: DedupExisting[],
): DedupVerdict {
  // 1. Exact email — definite match (per spec)
  if (incoming.email_normalized) {
    const hit = existing.find(e => e.email_normalized && e.email_normalized === incoming.email_normalized)
    if (hit) return { kind: 'auto_merge', existing: hit, reasons: ['email_match'] }
  }
  // 2. Exact phone — definite match
  if (incoming.phone_normalized) {
    const hit = existing.find(e => e.phone_normalized && e.phone_normalized === incoming.phone_normalized)
    if (hit) return { kind: 'auto_merge', existing: hit, reasons: ['phone_match'] }
  }

  // 3. Fuzzy: name similarity + address similarity. We compute
  //    against every existing row in the store; takes top scorer
  //    above the threshold. Per spec: name ≥80% AND (addr+zip exact
  //    OR addr+city fuzzy ≥80%).
  let best: { row: DedupExisting; nameSim: number; addrSim: number; reasons: string[] } | null = null
  const incomingFull = `${incoming.first_name} ${incoming.last_name}`.trim()
  const incomingAddr = normalizeAddress(incoming.address_line_1)
  for (const e of existing) {
    const candFull = `${e.first_name} ${e.last_name}`.trim()
    const nameSim = similarity(incomingFull, candFull)
    if (nameSim < NAME_THRESHOLD) continue
    const candAddr = normalizeAddress(e.address_line_1)
    let addrSim = 0
    const reasons: string[] = ['name_fuzzy']
    if (incoming.zip && e.zip && incoming.zip.trim() === e.zip.trim() && incomingAddr && incomingAddr === candAddr) {
      addrSim = 1
      reasons.push('address_zip_exact')
    } else if (incoming.city && e.city && incoming.city.trim().toLowerCase() === e.city.trim().toLowerCase()) {
      const sim = similarity(incomingAddr, candAddr)
      if (sim >= ADDRESS_THRESHOLD) {
        addrSim = sim
        reasons.push('address_city_fuzzy')
      }
    }
    if (addrSim === 0) continue
    if (!best || (nameSim + addrSim) > (best.nameSim + best.addrSim)) {
      best = { row: e, nameSim, addrSim, reasons }
    }
  }
  if (best) {
    const confidence = (best.nameSim + best.addrSim) / 2
    return { kind: 'review', existing: best.row, confidence: Number(confidence.toFixed(3)), reasons: best.reasons }
  }
  return { kind: 'create' }
}
