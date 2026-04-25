// Pure helpers for resolving the {{merge_vars}} that appear in notification
// template bodies. Used at *enqueue* time to snapshot a fallback into
// scheduled_notifications.merge_data, and at *send* time to re-render
// against live data so any last-minute change (a new co-buyer added,
// an event renamed, etc.) is reflected.
//
// Keep this file pure / dependency-free so it can run in any runtime.

export interface MergeVarsContext {
  buyer: { id: string; name: string; email: string; phone: string }
  event: {
    id: string
    name: string                 // e.g. store_name + " (Day 1)" or whatever the spec wants
    start_date: string           // YYYY-MM-DD (Day 1)
    end_date?: string            // YYYY-MM-DD (Day N) — falls back to start_date + 2
    city?: string
    address?: string
    travel_share_url?: string
  }
  store: { id: string; name: string; timezone?: string | null }
  brand: 'beb' | 'liberty'
  otherBuyers: { id: string; name: string }[]
  portalUrl: string
  adminContact?: string
}

export type MergeVarMap = Record<string, string>

export function buildMergeVars(ctx: MergeVarsContext): MergeVarMap {
  const fullName = ctx.buyer.name || ''
  const [firstName, ...rest] = fullName.split(/\s+/)
  const lastName = rest.join(' ')

  return {
    first_name: firstName || fullName,
    last_name: lastName,
    full_name: fullName,
    event_name: ctx.event.name,
    event_dates: formatDateRange(ctx.event.start_date, ctx.event.end_date),
    event_city: ctx.event.city || '',
    event_address: ctx.event.address || '',
    store_name: ctx.store.name,
    other_buyers: formatBuyerList(ctx.otherBuyers.map(b => b.name)),
    travel_share_link: ctx.event.travel_share_url || ctx.portalUrl,
    admin_contact: ctx.adminContact || '',
    portal_url: ctx.portalUrl,
  }
}

/**
 * Substitute {{key}} placeholders. Unknown keys are left in place so a
 * typo is visible in the rendered output rather than silently dropped.
 */
export function substitute(template: string, vars: MergeVarMap): string {
  return template.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (m, key) => {
    return key in vars ? vars[key] : m
  })
}

// ── Formatters ────────────────────────────────────────────────────

export function ordinal(n: number): string {
  const v = n % 100
  if (v >= 11 && v <= 13) return `${n}th`
  switch (n % 10) {
    case 1: return `${n}st`
    case 2: return `${n}nd`
    case 3: return `${n}rd`
    default: return `${n}th`
  }
}

const WEEKDAY_OVERRIDES: Record<string, string> = { Tue: 'Tues', Thu: 'Thurs' }

function fmtSingle(iso: string): string {
  const d = new Date(iso + 'T12:00:00')
  const wRaw = d.toLocaleDateString('en-US', { weekday: 'short' })
  const weekday = WEEKDAY_OVERRIDES[wRaw] || wRaw
  const month = d.toLocaleDateString('en-US', { month: 'short' })
  return `${weekday} ${month} ${ordinal(d.getDate())}`
}

/**
 * "Tues Dec 29th – Thurs Dec 31st" for a multi-day event. If end_date
 * is missing, defaults to start_date + 2 days (the typical 3-day event).
 * Single-day collapses to one date.
 */
export function formatDateRange(startIso: string, endIso?: string): string {
  if (!startIso) return ''
  const end = endIso || addDays(startIso, 2)
  if (end === startIso) return fmtSingle(startIso)
  return `${fmtSingle(startIso)} – ${fmtSingle(end)}`
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * "John, Jane, and Mike" / "John and Jane" / "John" / "our team" (empty).
 * Used so the body reads naturally regardless of how many co-buyers exist.
 */
export function formatBuyerList(names: string[]): string {
  const cleaned = names.filter(Boolean)
  if (cleaned.length === 0) return 'our team'
  if (cleaned.length === 1) return cleaned[0]
  if (cleaned.length === 2) return `${cleaned[0]} and ${cleaned[1]}`
  return `${cleaned.slice(0, -1).join(', ')}, and ${cleaned[cleaned.length - 1]}`
}
