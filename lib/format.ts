// Shared formatters. Money formatting was duplicated across 14+ files
// with two consistent shapes: "$1,234" (rounded, dashboards/lists) and
// "$1,234.56" (expense module). Centralized here so they stay in sync.

const USD_NO_CENTS = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', maximumFractionDigits: 0,
})
const USD_CENTS = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
})

/** Format a value as USD. Default: rounded ("$1,234"). `cents: true` for "$1,234.56". */
export function fmtMoney(
  n: number | string | null | undefined,
  opts?: { cents?: boolean },
): string {
  const v = typeof n === 'string' ? parseFloat(n) : (n ?? 0)
  const safe = Number.isFinite(v) ? v : 0
  return (opts?.cents ? USD_CENTS : USD_NO_CENTS).format(safe)
}
