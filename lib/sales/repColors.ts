// Stable color assignment for trunk reps. Sorts the rep list
// alphabetically by name and assigns colors from a fixed palette.
// Same input → same output every time so the territory map looks
// identical across reloads + the Settings panel's swatches always
// agree with the modal.
//
// Palette is intentionally 8 entries so we keep working when reps
// rotate (a 5th or 6th active rep doesn't fall off the end). The
// first 4 match the proposal mockup (red / blue / green / purple)
// so muscle memory holds.

export const REP_COLOR_PALETTE = [
  '#DC2626', // red
  '#2563EB', // blue
  '#16A34A', // green
  '#7C3AED', // purple
  '#EA580C', // orange
  '#0891B2', // cyan
  '#DB2777', // pink
  '#65A30D', // lime
] as const

export interface RepLike {
  id: string
  name?: string | null
}

/** Maps rep id → color. Order is determined by alphabetical name
 *  so a rotation through the rep roster doesn't reshuffle colors
 *  for everyone else. */
export function buildRepColorMap<T extends RepLike>(reps: T[]): Map<string, string> {
  const sorted = [...reps].sort((a, b) =>
    (a.name || '').localeCompare(b.name || ''),
  )
  const out = new Map<string, string>()
  sorted.forEach((rep, i) => {
    out.set(rep.id, REP_COLOR_PALETTE[i % REP_COLOR_PALETTE.length])
  })
  return out
}
