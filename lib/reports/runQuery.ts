// Translates a saved ReportConfig + the active brand into a single
// Supabase query, runs it with a 10k LIMIT and a 30s timeout, and
// returns flat row objects keyed by the column keys from the config.
//
// Joined columns (eg 'stores(name)') get flattened back to dotted-style
// in the result rows ('stores.name') so the result table renders cleanly
// regardless of join depth.

import { supabase } from '@/lib/supabase'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  SOURCES, aggregateKey, computedKey, allColumns, aggregateLabel,
  type ReportConfig, type ReportFilter, type AggregateColumn,
} from './schema'
import { compile as compileFormula } from './formula'

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

/** Translate a filter to a PostgREST `.or()`-eligible predicate string.
 *  Returns null when the filter can't be expressed in that syntax
 *  (joined columns, unsupported ops, empty value lists). For date_preset
 *  the two date bounds get wrapped in an inner `and(...)` group so the
 *  preset still matches as a single predicate inside the outer OR. */
function filterToOrPredicate(f: ReportFilter): string | null {
  if (f.field.includes('(')) return null
  const v = f.value
  switch (f.op) {
    case 'eq':       return `${f.field}.eq.${encodeOrValue(v)}`
    case 'neq':      return `${f.field}.neq.${encodeOrValue(v)}`
    case 'gt':       return `${f.field}.gt.${encodeOrValue(v)}`
    case 'gte':      return `${f.field}.gte.${encodeOrValue(v)}`
    case 'lt':       return `${f.field}.lt.${encodeOrValue(v)}`
    case 'lte':      return `${f.field}.lte.${encodeOrValue(v)}`
    case 'contains':    return `${f.field}.ilike.*${encodeOrValue(v)}*`
    case 'starts_with': return `${f.field}.ilike.${encodeOrValue(v)}*`
    case 'in': {
      const list = String(v).split(',').map(s => s.trim()).filter(Boolean)
      if (list.length === 0) return null
      return `${f.field}.in.(${list.map(encodeOrValue).join(',')})`
    }
    case 'is_null':  return `${f.field}.is.null`
    case 'not_null': return `${f.field}.not.is.null`
    case 'date_preset': {
      const r = f.preset ? presetRange(f.preset) : null
      if (!r) return null
      return `and(${f.field}.gte.${r.start},${f.field}.lte.${r.end})`
    }
    default: return null
  }
}

/** Quote values that contain PostgREST-meaningful chars so they don't
 *  break the .or() parser. Doubles internal quotes (the escape rule). */
function encodeOrValue(v: any): string {
  const s = String(v ?? '')
  if (/[,()"\s]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
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
  client: SupabaseClient = supabase,
): Promise<RunResult> {
  const def = SOURCES[source]
  if (!def) return { rows: [], truncated: false, durationMs: 0, error: `Unknown source: ${source}` }

  const isGrouped = (config.groupBy?.length ?? 0) > 0

  // Build select string. In grouping mode, ignore `columns` and select
  // the union of groupBy keys + aggregate-source fields instead — those
  // are the only fields the aggregator needs to read. `count` doesn't
  // need a field (it counts rows).
  const aggFields = (config.aggregates ?? [])
    .filter(a => a.op !== 'count' && !!a.field)
    .map(a => a.field!) as string[]
  const fetchKeys = isGrouped
    ? Array.from(new Set([...(config.groupBy ?? []), ...aggFields]))
    : config.columns

  // Build select string: own columns + grouped related embeds.
  const ownCols = new Set<string>()
  const embedCols = new Map<string, Set<string>>()  // 'stores' -> {'name','city'}
  for (const k of fetchKeys) {
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

  let query: any = client.from(def.table).select(selectStr).limit(HARD_LIMIT + 1)

  // Brand scoping at run time (the spec's section 6).
  if (def.brandScoped) {
    query = query.eq('brand', brand)
  }

  // Filters. AND mode chains .eq()/.gt()/etc per filter. OR mode builds a
  // single PostgREST .or() string from those predicates the operator
  // supports; joined-column filters and any unsupported op are silently
  // skipped (same as the AND path treats joined columns).
  const allFilters = config.filters || []
  if (config.filterCombinator === 'or' && allFilters.length > 0) {
    const parts: string[] = []
    for (const f of allFilters) {
      const part = filterToOrPredicate(f)
      if (part) parts.push(part)
    }
    if (parts.length > 0) query = query.or(parts.join(','))
  } else {
    for (const f of allFilters) {
      query = applyFilter(query, f)
    }
  }

  // Sort — joined columns can't be sorted server-side; defer to client.
  // Grouped reports skip server-side sort entirely (the sort fields may be
  // synthetic aggregate keys that don't exist on the table); a full
  // client-side sort runs after aggregation.
  if (!isGrouped) {
    for (const s of config.sort || []) {
      if (!s.field.includes('(')) {
        query = query.order(s.field, { ascending: s.direction === 'asc' })
      }
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

  // Group + aggregate client-side when grouping is configured. We keep this
  // in JS rather than pushing to PostgREST aggregate syntax because
  // groupBy can target joined columns (eg group by `stores(name)`) which
  // PostgREST aggregates don't cleanly support, and the input is already
  // capped at 10k rows so the JS-side cost is bounded.
  if (isGrouped) {
    rows = aggregateRows(rows, config.groupBy ?? [], config.aggregates ?? [])
  }

  // Computed columns evaluate AFTER aggregation. The label→value resolver
  // checks aggregate labels + groupBy column labels (when grouped) or the
  // source column labels (when ungrouped). Each formula gets compiled once
  // up front so the per-row loop stays a tight inner loop.
  if ((config.computed?.length ?? 0) > 0) {
    rows = applyComputed(source, config, rows, isGrouped)
  }

  // Client-side sort fallback for joined-column sorts (server skipped them).
  // In grouped mode, the server-side sort was for ungrouped rows and is
  // moot — re-sort everything client-side using the configured sort, which
  // can now reference groupBy columns, aggregate keys (__agg_N), or
  // computed-column keys (__calc_N). Computed keys are own properties on
  // the row in either grouped or ungrouped mode, so they read directly.
  const isSyntheticKey = (k: string) => k.startsWith('__agg_') || k.startsWith('__calc_')
  const sortRules = isGrouped
    ? (config.sort || [])
    : (config.sort || []).filter(s => s.field.includes('(') || isSyntheticKey(s.field))
  for (const s of sortRules.slice().reverse()) {
    rows = [...rows].sort((a, b) => {
      const useDirectKey = isGrouped || isSyntheticKey(s.field)
      const av = useDirectKey ? a[s.field] : getValue(a, s.field)
      const bv = useDirectKey ? b[s.field] : getValue(b, s.field)
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      // Numeric compare for numbers; lexicographic-with-numeric for strings.
      if (typeof av === 'number' && typeof bv === 'number') {
        return s.direction === 'asc' ? av - bv : bv - av
      }
      const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true })
      return s.direction === 'asc' ? cmp : -cmp
    })
  }

  return { rows, truncated, durationMs }
}

/** Group `rows` by the tuple of `groupBy` keys, then compute each aggregate
 *  against the rows in each group. Returns one flat row per group with
 *  the groupBy keys as own properties + aggregate values keyed by
 *  `aggregateKey(i)`. */
function aggregateRows(
  rows: any[],
  groupBy: string[],
  aggregates: AggregateColumn[],
): any[] {
  const groups = new Map<string, { keyVals: any[]; rows: any[] }>()
  for (const r of rows) {
    const keyVals = groupBy.map(k => normalizeGroupValue(getValue(r, k)))
    // JSON.stringify is fine for v1 — group cardinality is bounded by 10k.
    const gk = JSON.stringify(keyVals)
    let g = groups.get(gk)
    if (!g) { g = { keyVals, rows: [] }; groups.set(gk, g) }
    g.rows.push(r)
  }
  const out: any[] = []
  for (const g of groups.values()) {
    const o: Record<string, any> = {}
    groupBy.forEach((k, i) => { o[k] = g.keyVals[i] })
    aggregates.forEach((agg, i) => {
      o[aggregateKey(i)] = computeAggregate(g.rows, agg)
    })
    out.push(o)
  }
  return out
}

/** Build a label-keyed value resolver per row, then evaluate each
 *  computed formula. Mutates rows in place by attaching `__calc_N`
 *  values; safe because rows is already a fresh array at this point. */
function applyComputed(
  source: string,
  config: ReportConfig,
  rows: any[],
  isGrouped: boolean,
): any[] {
  const computed = config.computed ?? []
  if (computed.length === 0) return rows

  // Compile all formulas up front. Bad formulas just produce NaN at
  // runtime (compile failure is reported in the builder before save).
  const evaluators = computed.map(c => {
    try { return compileFormula(c.formula) }
    catch { return () => NaN }
  })

  // Build a label→key resolver tailored to grouped vs ungrouped output.
  // Grouped output rows have own keys for groupBy cols and __agg_N for
  // aggregates; ungrouped rows are raw fetch rows accessed via getValue.
  const catalog = allColumns(source)
  const labelToKey = new Map<string, string>()
  const aggLabelByIndex: { label: string; key: string }[] = []

  if (isGrouped) {
    for (const gk of config.groupBy ?? []) {
      const cd = catalog.find(c => c.column.key === gk)?.column
      labelToKey.set((cd?.label || gk).toLowerCase(), gk)
    }
    ;(config.aggregates ?? []).forEach((a, i) => {
      const fl = a.field ? catalog.find(c => c.column.key === a.field)?.column.label : undefined
      const label = aggregateLabel(a, fl).toLowerCase()
      labelToKey.set(label, aggregateKey(i))
      aggLabelByIndex.push({ label, key: aggregateKey(i) })
    })
  } else {
    for (const c of catalog) labelToKey.set(c.column.label.toLowerCase(), c.column.key)
  }

  for (const row of rows) {
    const resolve = (label: string) => {
      const k = labelToKey.get(label.toLowerCase())
      if (!k) return NaN
      return isGrouped ? row[k] : getValue(row, k)
    }
    evaluators.forEach((ev, i) => {
      const v = ev(resolve)
      row[computedKey(i)] = Number.isFinite(v) ? v : null
    })
  }
  return rows
}

/** null/undefined collapse to a single bucket so groups don't fragment. */
function normalizeGroupValue(v: any): any {
  if (v === undefined) return null
  return v
}

function computeAggregate(rows: any[], agg: AggregateColumn): number | null {
  if (agg.op === 'count') return rows.length
  const field = agg.field
  if (!field) return null
  const vals = rows.map(r => getValue(r, field))
  if (agg.op === 'count_distinct') {
    const seen = new Set<string>()
    for (const v of vals) {
      if (v == null) continue
      seen.add(typeof v === 'object' ? JSON.stringify(v) : String(v))
    }
    return seen.size
  }
  // Numeric ops — coerce + drop non-numeric/null.
  const nums: number[] = []
  for (const v of vals) {
    if (v == null) continue
    const n = typeof v === 'number' ? v : Number(v)
    if (Number.isFinite(n)) nums.push(n)
  }
  if (nums.length === 0) return null
  switch (agg.op) {
    case 'sum': return nums.reduce((s, n) => s + n, 0)
    case 'avg': return nums.reduce((s, n) => s + n, 0) / nums.length
    case 'min': return Math.min(...nums)
    case 'max': return Math.max(...nums)
  }
  return null
}
