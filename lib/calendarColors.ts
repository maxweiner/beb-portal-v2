// Centralized palette for calendar event rendering. Three families,
// each with two states (confirmed = solid; save-the-date = dashed
// outline / lighter fill). Established 2026-05-06 to replace the
// per-store random color rotation that was making the schedule busy.
//
// Mapping (per team review of palette D, with custom colors):
//   Buying buying-events   → BLUE   (#1E3A8A) — was per-store random
//   Trunk shows / Selling  → GREEN  (#1D6B44)
//   Trade shows            → YELLOW (#D4A017)
//
// "Save the Date" (events with status='reserved' / pre-confirmation
// trade & trunk shows) renders as a dashed outline of the same hue
// against a lighter fill — strongest visual difference between
// confirmed and tentative.

export type CalendarFamily = 'buying' | 'trunk' | 'trade'

export interface CalendarColor {
  /** Solid fill for confirmed events. White text on top. */
  main: string
  /** Pale fill for STD / reserved variants. Dark text on top. */
  light: string
  /** Dark text color used for labels on light fills + dashed outlines. */
  text: string
}

export const CALENDAR_COLORS: Record<CalendarFamily, CalendarColor> = {
  buying: { main: '#1E3A8A', light: '#DBE6F4', text: '#1E3A8A' },
  trunk:  { main: '#1D6B44', light: '#E6F4EC', text: '#11432B' },
  trade:  { main: '#D4A017', light: '#FBF1D5', text: '#7A5B00' },
}

export const CALENDAR_LABELS: Record<CalendarFamily, string> = {
  buying: 'Buying',
  trunk:  'Trunk Show',
  trade:  'Trade Show',
}

/** Build the inline-style props for a single calendar event chip.
 *  When `reserved` is true, returns a dashed outline (transparent fill,
 *  family-colored text + border). When false, returns a solid fill in
 *  the family's main color with white text. */
export function eventChipStyle(family: CalendarFamily, reserved: boolean): {
  background: string
  color: string
  border: string
} {
  const c = CALENDAR_COLORS[family]
  if (reserved) {
    return {
      background: c.light,
      color: c.text,
      border: `1.5px dashed ${c.main}`,
    }
  }
  return {
    background: c.main,
    color: '#fff',
    border: 'none',
  }
}

/** Filter-toggle "on" state styling — used at the top of the calendar
 *  page where the user toggles event-family visibility. Uses a low-
 *  opacity tint of the family color. */
export function familyToggleOn(family: CalendarFamily): {
  background: string
  color: string
} {
  const c = CALENDAR_COLORS[family]
  return {
    // Re-create the tint by mixing 12% of `main` with white — close
    // enough match for the on-state highlight.
    background: c.light,
    color: c.text,
  }
}
