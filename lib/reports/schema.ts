// Static schema for the custom report builder. Defines the sources
// the user can pick from, the columns each source exposes, and the
// 1-level relationships that can be embedded.
//
// v1: 4 sources (appointments / events / qr_scans / stores) with
// hand-curated column lists. Adding sources or new joins is a code
// edit here — never user-driven.

export type ColumnType = 'text' | 'number' | 'date' | 'datetime' | 'bool' | 'json'

export interface ColumnDef {
  /** Database column name as Supabase will see it (incl. join path, eg 'stores(name)'). */
  key: string
  /** Human-readable label shown in the builder + result table header. */
  label: string
  type: ColumnType
  /** Operator menu shown in the filter row for this type. */
  operators?: Operator[]
}

export type Operator =
  | 'eq' | 'neq'
  | 'gt' | 'gte' | 'lt' | 'lte'
  | 'contains' | 'starts_with'
  | 'in' | 'not_in'
  | 'is_null' | 'not_null'
  | 'date_preset'

export const TYPE_OPERATORS: Record<ColumnType, Operator[]> = {
  text:     ['eq', 'neq', 'contains', 'starts_with', 'in', 'is_null', 'not_null'],
  number:   ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_null', 'not_null'],
  date:     ['date_preset', 'eq', 'gt', 'gte', 'lt', 'lte'],
  datetime: ['date_preset', 'eq', 'gt', 'gte', 'lt', 'lte'],
  bool:     ['eq', 'neq', 'is_null', 'not_null'],
  json:     ['is_null', 'not_null'],
}

export const OPERATOR_LABELS: Record<Operator, string> = {
  eq: 'is', neq: 'is not',
  gt: '>', gte: '>=', lt: '<', lte: '<=',
  contains: 'contains', starts_with: 'starts with',
  in: 'is one of', not_in: 'is not one of',
  is_null: 'is empty', not_null: 'is not empty',
  date_preset: 'preset',
}

export const DATE_PRESETS: { value: string; label: string }[] = [
  { value: 'today',         label: 'Today' },
  { value: 'yesterday',     label: 'Yesterday' },
  { value: 'last_7_days',   label: 'Last 7 days' },
  { value: 'last_30_days',  label: 'Last 30 days' },
  { value: 'last_90_days',  label: 'Last 90 days' },
  { value: 'year_to_date',  label: 'Year to date' },
  { value: 'custom',        label: 'Custom range' },
]

export interface SourceDef {
  /** Supabase table name. */
  table: string
  /** UI label. */
  label: string
  /** Columns directly on the source table. */
  columns: ColumnDef[]
  /** 1-level joins (Supabase foreign-key embed syntax). */
  related?: RelatedDef[]
  /** True if rows on this source carry a `brand` column (used for active-brand scoping at run time). */
  brandScoped?: boolean
}

export interface RelatedDef {
  /** Embed key, eg 'stores' or 'events'. */
  key: string
  label: string
  columns: ColumnDef[]
}

export const SOURCES: Record<string, SourceDef> = {
  appointments: {
    table: 'appointments',
    label: 'Appointments',
    brandScoped: true,
    columns: [
      { key: 'id', label: 'ID', type: 'text' },
      { key: 'appointment_date', label: 'Date', type: 'date' },
      { key: 'appointment_time', label: 'Time', type: 'text' },
      { key: 'customer_name', label: 'Customer name', type: 'text' },
      { key: 'customer_phone', label: 'Customer phone', type: 'text' },
      { key: 'customer_email', label: 'Customer email', type: 'text' },
      { key: 'status', label: 'Status', type: 'text' },
      { key: 'how_heard', label: 'How heard', type: 'text' },
      { key: 'is_walkin', label: 'Walk-in', type: 'bool' },
      { key: 'booked_by', label: 'Booked by', type: 'text' },
      { key: 'created_at', label: 'Created at', type: 'datetime' },
    ],
    related: [
      {
        key: 'events', label: 'Event',
        columns: [
          { key: 'events(store_name)', label: 'Event store', type: 'text' },
          { key: 'events(start_date)', label: 'Event start', type: 'date' },
        ],
      },
      {
        key: 'stores', label: 'Store',
        columns: [
          { key: 'stores(name)', label: 'Store name', type: 'text' },
          { key: 'stores(city)', label: 'Store city', type: 'text' },
          { key: 'stores(state)', label: 'Store state', type: 'text' },
        ],
      },
    ],
  },
  events: {
    table: 'events',
    label: 'Events',
    brandScoped: true,
    columns: [
      { key: 'id', label: 'ID', type: 'text' },
      { key: 'store_name', label: 'Store name', type: 'text' },
      { key: 'start_date', label: 'Start date', type: 'date' },
      { key: 'spend_vdp', label: 'Spend VDP', type: 'number' },
      { key: 'spend_newspaper', label: 'Spend newspaper', type: 'number' },
      { key: 'spend_postcard', label: 'Spend postcard', type: 'number' },
      { key: 'spend_spiffs', label: 'Spend spiffs', type: 'number' },
      { key: 'created_at', label: 'Created at', type: 'datetime' },
    ],
    related: [
      {
        key: 'stores', label: 'Store',
        columns: [
          { key: 'stores(name)', label: 'Store name', type: 'text' },
          { key: 'stores(city)', label: 'Store city', type: 'text' },
          { key: 'stores(state)', label: 'Store state', type: 'text' },
        ],
      },
    ],
  },
  qr_scans: {
    table: 'qr_scans',
    label: 'QR scans',
    columns: [
      { key: 'id', label: 'ID', type: 'text' },
      { key: 'scanned_at', label: 'Scanned at', type: 'datetime' },
      { key: 'device_type', label: 'Device', type: 'text' },
      { key: 'geo_city', label: 'City', type: 'text' },
      { key: 'geo_region', label: 'Region', type: 'text' },
      { key: 'geo_country', label: 'Country', type: 'text' },
      { key: 'is_repeat', label: 'Repeat', type: 'bool' },
      { key: 'converted', label: 'Converted', type: 'bool' },
    ],
    related: [
      {
        key: 'qr_codes', label: 'QR code',
        columns: [
          { key: 'qr_codes(label)', label: 'QR label', type: 'text' },
          { key: 'qr_codes(type)', label: 'QR type', type: 'text' },
          { key: 'qr_codes(lead_source)', label: 'QR source', type: 'text' },
        ],
      },
    ],
  },
  stores: {
    table: 'stores',
    label: 'Stores',
    brandScoped: true,
    columns: [
      { key: 'id', label: 'ID', type: 'text' },
      { key: 'name', label: 'Name', type: 'text' },
      { key: 'city', label: 'City', type: 'text' },
      { key: 'state', label: 'State', type: 'text' },
      { key: 'address', label: 'Address', type: 'text' },
      { key: 'owner_name', label: 'Owner', type: 'text' },
      { key: 'owner_email', label: 'Owner email', type: 'text' },
      { key: 'owner_phone', label: 'Owner phone', type: 'text' },
    ],
  },
}

/** All columns (own + related) for a given source, flattened for the column picker. */
export function allColumns(source: string): { groupLabel: string; column: ColumnDef }[] {
  const def = SOURCES[source]
  if (!def) return []
  const out: { groupLabel: string; column: ColumnDef }[] = []
  for (const c of def.columns) out.push({ groupLabel: def.label, column: c })
  for (const r of def.related || []) {
    for (const c of r.columns) out.push({ groupLabel: r.label, column: c })
  }
  return out
}

// ── Saved-config shape (lives in custom_reports.config jsonb) ──

export interface ReportFilter {
  field: string
  op: Operator
  value: any
  /** When op = 'date_preset' on a date column. */
  preset?: string
}

export interface ReportSort {
  field: string
  direction: 'asc' | 'desc'
}

export type AggregateOp = 'count' | 'count_distinct' | 'sum' | 'avg' | 'min' | 'max'

export interface AggregateColumn {
  /** Source column key. Ignored when op='count' (which counts rows). */
  field?: string
  op: AggregateOp
  /** Optional display label override. Auto-generated if missing. */
  label?: string
}

export const AGG_LABELS: Record<AggregateOp, string> = {
  count: 'Count', count_distinct: 'Count distinct',
  sum: 'Sum', avg: 'Avg', min: 'Min', max: 'Max',
}

/** Synthetic key the runner emits for the i-th aggregate column. */
export function aggregateKey(i: number): string {
  return `__agg_${i}`
}

/** Default human label like "Count" / "Sum of amount". */
export function aggregateLabel(agg: AggregateColumn, fieldLabel?: string): string {
  if (agg.label) return agg.label
  if (agg.op === 'count') return 'Count'
  return `${AGG_LABELS[agg.op]} of ${fieldLabel || agg.field || ''}`.trim()
}

export type FilterCombinator = 'and' | 'or'

export interface ReportConfig {
  columns: string[]               // column keys from the source/related set
  filters: ReportFilter[]
  sort: ReportSort[]
  limit?: number                  // capped at 10000 by the runner
  /** How filters combine. 'and' (default, legacy) requires every filter
   *  to match. 'or' matches if any filter matches. */
  filterCombinator?: FilterCombinator
  /** When non-empty, the runner groups input rows by these keys and emits
   *  one row per group with the aggregate columns. `columns` is ignored
   *  in grouping mode — output cols are `[...groupBy, aggregate_keys]`. */
  groupBy?: string[]
  aggregates?: AggregateColumn[]
}
