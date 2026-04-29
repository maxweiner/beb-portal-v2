// Fractional position math for drag-reorder. New rows append at MAX+1;
// inserting between two rows uses the average of their positions. This
// avoids renumbering on every move. We only rebalance if neighbors get
// pathologically close.

const REBALANCE_EPSILON = 1e-9

export function nextPosition(existing: { position: number }[]): number {
  if (existing.length === 0) return 0
  return Math.max(...existing.map(t => t.position)) + 1
}

/**
 * Position to use when dropping between (or at the edge of) a sorted list.
 * Pass the position immediately above and below the target slot. Either
 * may be null/undefined to indicate "edge".
 */
export function positionBetween(
  before: number | null | undefined,
  after: number | null | undefined,
): number {
  if (before == null && after == null) return 0
  if (before == null) return (after as number) - 1
  if (after == null) return (before as number) + 1
  const mid = (before + after) / 2
  // If neighbors collapsed (shouldn't normally happen with doubles but
  // possible after many bisections), nudge slightly. Caller can re-sort
  // and rebalance the whole list if this becomes a real problem.
  if (after - before < REBALANCE_EPSILON) return before + REBALANCE_EPSILON
  return mid
}
