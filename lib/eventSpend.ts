// Per-day and per-event money math for purchases. Buyers enter spend in
// two buckets — `dollars10` (10% commission) and `dollars5` (5%) — and
// every dashboard / event card / report sums them the same way.

export const COMMISSION_RATE_10 = 0.10
export const COMMISSION_RATE_5 = 0.05

interface DayLike {
  dollars10?: number | string | null
  dollars5?: number | string | null
  purchases?: number | string | null
}

const num = (n: unknown) => Number(n || 0)

/** Total dollars for one day (both commission buckets summed). */
export function daySpend(d: DayLike): number {
  return num(d.dollars10) + num(d.dollars5)
}

/** Commission earned on one day. */
export function dayCommission(d: DayLike): number {
  return num(d.dollars10) * COMMISSION_RATE_10 + num(d.dollars5) * COMMISSION_RATE_5
}

/** True if anything was entered on this day (purchases or any spend). */
export function dayHasData(d: DayLike | null | undefined): boolean {
  if (!d) return false
  return num(d.purchases) > 0 || num(d.dollars10) > 0 || num(d.dollars5) > 0
}

/** Sum of `daySpend` across all of an event's days. */
export function eventSpend(ev: { days?: DayLike[] | null }): number {
  return (ev.days ?? []).reduce((s, d) => s + daySpend(d), 0)
}

/** Sum of `dayCommission` across all of an event's days. */
export function eventCommission(ev: { days?: DayLike[] | null }): number {
  return (ev.days ?? []).reduce((s, d) => s + dayCommission(d), 0)
}
