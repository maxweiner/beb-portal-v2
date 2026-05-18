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

/** Per-rep color overrides, keyed by lowercased first name (same
 *  convention as HOME_STATES in TrunkTerritoryMapModal). Wins over
 *  the palette so an operator can lock a specific rep to a specific
 *  hue without disturbing anyone else's assignment. Add an entry
 *  here when a rep needs a hand-picked color. */
const NAME_COLOR_OVERRIDES: Record<string, string> = {
  tanya: '#CA8A04', // yellow (darker — keeps white state labels readable)
}

export interface RepLike {
  id: string
  name?: string | null
}

/** Maps rep id → color. Order is determined by alphabetical name
 *  so a rotation through the rep roster doesn't reshuffle colors
 *  for everyone else. Names matching NAME_COLOR_OVERRIDES skip the
 *  palette and use their override instead. */
export function buildRepColorMap<T extends RepLike>(reps: T[]): Map<string, string> {
  const sorted = [...reps].sort((a, b) =>
    (a.name || '').localeCompare(b.name || ''),
  )
  const out = new Map<string, string>()
  sorted.forEach((rep, i) => {
    const firstName = (rep.name || '').split(' ')[0].toLowerCase()
    const override = NAME_COLOR_OVERRIDES[firstName]
    out.set(rep.id, override || REP_COLOR_PALETTE[i % REP_COLOR_PALETTE.length])
  })
  return out
}
