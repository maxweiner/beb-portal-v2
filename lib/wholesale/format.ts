// Money + general formatting helpers for the wholesale module.
// All money is stored as integer cents.

export function fmtMoneyCents(cents: number | null | undefined): string {
  if (cents == null) return '—'
  const dollars = cents / 100
  return '$' + dollars.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function dollarsToCents(input: string | number | null | undefined): number | null {
  if (input == null || input === '') return null
  const n = typeof input === 'number' ? input : Number.parseFloat(String(input).replace(/[$,\s]/g, ''))
  if (!Number.isFinite(n)) return null
  return Math.round(n * 100)
}

/** Whole-dollar variant of dollarsToCents — rounds to the nearest
 *  whole DOLLAR before converting to cents, so the resulting value
 *  is always a multiple of 100. Use for inventory_items.cost_cents
 *  (per-spec, cost is tracked in whole dollars — no cents). */
export function dollarsToWholeCents(input: string | number | null | undefined): number | null {
  if (input == null || input === '') return null
  const n = typeof input === 'number' ? input : Number.parseFloat(String(input).replace(/[$,\s]/g, ''))
  if (!Number.isFinite(n)) return null
  return Math.round(n) * 100
}

export function centsToDollarsString(cents: number | null | undefined): string {
  if (cents == null) return ''
  return (cents / 100).toFixed(2)
}

/** Whole-dollar variant of centsToDollarsString — emits the
 *  integer dollar count with no decimal point. Pairs with
 *  dollarsToWholeCents for cost inputs. */
export function centsToWholeDollarsString(cents: number | null | undefined): string {
  if (cents == null) return ''
  return String(Math.round(cents / 100))
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso.length <= 10 ? iso + 'T12:00:00' : iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Date + time formatter for audit timeline rows. We want to know not
 *  just the day something happened on a busy item but the order /
 *  exact minute — e.g. "memo line created at 2:14 PM, sold at 2:31 PM".
 *  Bare YYYY-MM-DD strings get noon UTC so the local day doesn't drift. */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso.length <= 10 ? iso + 'T12:00:00' : iso)
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

/** Margin percent given cost & sale (in cents). Null if either missing or cost is 0. */
export function marginPct(costCents: number | null | undefined, salePriceCents: number | null | undefined): number | null {
  if (!costCents || costCents <= 0 || !salePriceCents) return null
  return ((salePriceCents - costCents) / salePriceCents) * 100
}
