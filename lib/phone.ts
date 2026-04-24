// Phone-number formatting for the whole app.
//
// - DB stores RAW digits (e.g. "9176690535"). Strip leading "1" if present.
// - Inputs use <PhoneInput>, which formats as the user types and calls
//   onChange with the raw digits.
// - Anywhere phones are displayed, run through formatPhoneDisplay() so
//   the user sees "917-669-0535" regardless of what's stored.

/** Strip everything except digits, then drop a leading US country code "1". */
export function rawDigits(input: string | null | undefined): string {
  if (!input) return ''
  let d = String(input).replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1)
  return d.slice(0, 10)
}

/**
 * Format an arbitrary phone string for display as XXX-XXX-XXXX.
 * Returns the input unchanged if it has the wrong length (so weird DB
 * values still render rather than disappearing).
 */
export function formatPhoneDisplay(input: string | null | undefined): string {
  if (!input) return ''
  const d = rawDigits(input)
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`
  return String(input)
}

/**
 * Format the user's keystroke-by-keystroke input. Accepts whatever
 * the user types, strips to digits, and renders the partial format:
 *   1 digit   → "1"
 *   2 digits  → "12"
 *   3 digits  → "123"
 *   4 digits  → "123-4"
 *   …
 *   10 digits → "123-456-7890"
 */
export function formatPhonePartial(input: string): string {
  const d = rawDigits(input)
  if (d.length <= 3) return d
  if (d.length <= 6) return `${d.slice(0, 3)}-${d.slice(3)}`
  return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`
}
