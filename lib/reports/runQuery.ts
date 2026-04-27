// Translates a saved ReportConfig + the active brand into a single
// Supabase query, runs it with a 10k LIMIT and a 30s timeout, and
// returns flat row objects keyed by the column keys from the config.
//
// Joined columns (eg 'stores(name)') get flattened back to dotted-style
// in the result rows ('stores.name') so the result table renders cleanly
// regardless of join depth.

import { supabase } from '@/lib/supabase'
import { SOURCES, type ReportConfig, type ReportFilter } from './schema'

const HARD_LIMIT = 10000
const TIMEOUT_MS = 30_000

export interface RunResult {
  rows: Record<string, any>[]
  truncated: boolean
  durationMs: number
  error?: string
}

function presetRange(preset: string): { start: string; end: string } | null {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  switch (preset) {
    case 'today':
      return { start: fmt(today), end: fmt(today) }
    case 'yesterday': {
      const y = new Date(today); y.setDate(y.getDate() - 1)
      return { start: fmt(y), end: fmt(y) }
    }
    case 'last_7_days': {
      const s = new Date(today); s.setDate(s.getDate() - 6)
      return { start: fmt(s), end: fmt(today) }
    }
    case 'last_30_days': {
      const s = new Date(today); s.setDate(s.getDate() - 29)
      return { start: fmt(s), end: fmt(today) }
    }
    case 'last_90_days': {
      const s = new Date(today); s.setDate(s.getDate() - 89)
      return { start: fmt(s), end: fmt(today) }
    }
    case 'year_to_date': {
      const s = new Date(today.getFullYear(), 0, 1)
      return { start: fmt(s), end: fmt(today) }
    }
    default: return null
  }
}

function applyFilter(query: any, f: ReportFilter): any {
  // Joined columns can't go through Supabase's standard .eq() etc. — we
  // skip those at the SQL layer and filter client-side later. v1.
  if (f.field.includes('(')) return query
  const v = f.value
  switch (f.op) {
    case 'eq':       return query.eq(f.field, v)
    case 'neq':      return query.neq(f.field, v)
    case 'gt':       return query.gt(f.field, v)
    case 'gte':      return query.gte(f.field, v)
    case 'lt':       return query.lt(f.field, v)
    case 'lte':      return query.lte(f.field, v)
    case 'contains': return query.ilike(f.field, `%${v}%`)
    case 'starts_with': return query.ilike(f.field, `${v}%`)
    case 'in': {
      const list = String(v).split(',').map(s => s.trim()).filter(Boolean)
      return list.length ? query.in(f.field, list) : query
    }
    case 'is_null':   return query.is(f.field, null)
    case 'not_null':  return query.not(f.field, 'is', null)
    case 'date_preset': {
      const r = f.preset ? presetRange(f.preset) : null
      if (!r) return query
      return query.gte(f.field, r.start).lte(f.field, r.end)
    }
    default: return query
  }
}

/** Flatten 'stores(name)' style column key into 'stores.name' for display. */
export function displayKey(key: string): string {
  return key.replace(/\(([^)]+)\)/g, '.$1')
}

/** Pull a value from a row given a possibly-nested column key. */
export function getValue(row: Record<string, any>, key: string): any {
  if (!key.includes('(')) return row[key]
  // 'stores(name)' -> ['stores', 'name']
  const m = key.match(/^([^()]+)\(([^)]+)\)$/)
  if (!m) return undefined
  const embedded = row[m[1]]
  if (embedded == null) return undefined
  if (Array.isArray(embedded)) return embedded.map(x => x?.[m[2]]).join(', ')
  return embedded[m[2]]
}

export async function runReport(
  source: string,
  config: ReportConfig,
  brand: 'beb' | 'liberty',
): Promise<RunResult> {
  const def = SOURCES[source]
  if (!def) return { rows: [], truncated: false, durationMs: 0, error: `Unknown source: ${source}` }

  // Build select string: own columns + grouped related embeds.
  const ownCols = new Set<string>()
  const embedCols = new Map<string, Set<string>>()  // 'stores' -> {'name','city'}
  for (const k of config.columns) {
    const m = k.match(/^([^()]+)\(([^)]+)\)$/)
    if (m) {
      const arr = embedCols.get(m[1]) || new Set<string>()
      arr.add(m[2])
      embedCols.set(m[1], arr)
    } else {
      ownCols.add(k)
    }
  }
  const ownPart = Array.from(ownCols).join(', ')
  const embedPart = Array.from(embedCols.entries())
    .map(([rel, fields]) => `${rel}(${Array.from(fields).join(', ')})`)
    .join(', ')
  const selectStr = [ownPart, embedPart].filter(Boolean).join(', ') || '*'

  let query: any = supabase.from(def.table).select(selectStr).limit(HARD_LIMIT + 1)

  // Brand scoping at run time (the spec's section 6).
  if (def.brandScoped) {
    query = query.eq('brand', brand)
  }

  // Filters
  for (const f of config.filters || []) {
    query = applyFilter(query, f)
  }

  // Sort — joined columns can't be sorted server-side; defer to client.
  for (const s of config.sort || []) {
    if (!s.field.includes('(')) {
      query = query.order(s.field, { ascending: s.direction === 'asc' })
    }
  }

  const started = Date.now()
  const queryPromise = query as Promise<{ data: any[] | null; error: any }>
  const timeoutPromise = new Promise<{ data: null; error: { message: string } }>(resolve =>
    setTimeout(() => resolve({ data: null, error: { message: 'Report timed out after 30s. Try adding filters or reducing columns.' } }), TIMEOUT_MS)
  )
  const { data, error } = await Promise.race([queryPromise, timeoutPromise])
  const durationMs = Date.now() - started

  if (error) return { rows: [], truncated: false, durationMs, error: error.message }

  let rows = (data || []) as any[]
  const truncated = rows.length > HARD_LIMIT
  if (truncated) rows = rows.slice(0, HARD_LIMIT)

  // Client-side sort fallback for joined-column sorts (server skipped them).
  for (const s of (config.sort || []).slice().reverse()) {
    if (!s.field.includes('(')) continue
    rows = [...rows].sort((a, b) => {
      const av = getValue(a, s.field)
      const bv = getValue(b, s.field)
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true })
      return s.direction === 'asc' ? cmp : -cmp
    })
  }

  return { rows, truncated, durationMs }
}
